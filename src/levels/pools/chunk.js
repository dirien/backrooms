import * as THREE from 'three';
import { createFixtureBakeContext, sampleFixtureFill, sampleFixtureIrradiance } from '../../lighting.js';
import { isPhoneChunk } from '../../world-layout.js';
import { CHUNK_SIZE } from '../../constants.js';
import {
    addDebugHelpers,
    addMergedMesh,
    addStaticMesh,
    createChunkState,
    createFixtureRecord,
    createWallRecord,
    registerPhone,
} from '../../chunk-kit.js';
import {
    COIL,
    GRID,
    SLIDE_RADIUS,
    STAIR,
    WATER_LEVEL,
    cellIndex,
    getChunkPlan,
    getCollisionBlocks,
    getLightBlocks,
    getLadderSpots,
    getPhoneSpots,
    getSignSpots,
    getSlide,
    greedyRects,
    isOpenCell,
    isWaterCell,
    nudgeOutOfCurve,
    poolNoise,
} from './layout.js';
import { SIGN_COLUMNS, SIGN_ROWS, SIGN_TEXTS, TILES_PER_METRE, getPoolResources } from './resources.js';

// Light wells are recessed: they light what is below them, and almost nothing above.
export const POOL_LIGHT = { range: 15, intensity: 11.5, drop: 1.2, upward: 0.12 };
// White tile throws light around the room. Ceilings and walls are lit by what
// the floor and the water in front of them throw back; every surface also gets
// a share of the unoriented light at its position.
const CEILING_BOUNCE = 0.85;
const WALL_BOUNCE = 0.42;
const FILL_SHARE = 0.08;
const UP = { x: 0, y: 1, z: 0 };
// Walls reach from below the deepest pool to above the tallest hall, so light never leaks over them.
const WALL_BOTTOM = -1.5;
const WALL_TOP = 16;
const HALF = CHUNK_SIZE / 2;
const FIELD_PAD = 7;
const FIELD_SIZE = GRID + FIELD_PAD * 2;
const COLUMN_SEGMENTS = 20;
const ARCH_SEGMENTS = 16;
const FILLET_SEGMENTS = 18;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const tempMatrix = new THREE.Matrix4();
const tempScale = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const identityRotation = new THREE.Quaternion();
const waterSample = { x: 0, z: 0 };
const poweredPanelColor = new THREE.Color(1.95, 1.82, 1.5);
const failedPanelColor = new THREE.Color(0.05, 0.05, 0.04);

// Maps (along-wall metres, height, depth from the border) to chunk-local space for each ring side.
const SIDE_FRAMES = {
    north: { point: (a, y, depth) => [a, y, -HALF + depth], inward: [0, 0, 1], along: [1, 0, 0] },
    south: { point: (a, y, depth) => [a, y, HALF - depth], inward: [0, 0, -1], along: [1, 0, 0] },
    west: { point: (a, y, depth) => [-HALF + depth, y, a], inward: [1, 0, 0], along: [0, 0, 1] },
    east: { point: (a, y, depth) => [HALF - depth, y, a], inward: [-1, 0, 0], along: [0, 0, 1] },
};

/**
 * Distance from every cell to the nearest water, in metres, including water in
 * the neighbouring halls. It drives the light that pools throw onto walls and
 * ceilings, so that light agrees on both sides of a chunk border.
 */
function createWaterField(cx, cz) {
    const field = new Float32Array(FIELD_SIZE * FIELD_SIZE).fill(1e6);
    for (let fj = 0; fj < FIELD_SIZE; fj++) {
        for (let fi = 0; fi < FIELD_SIZE; fi++) {
            const i = fi - FIELD_PAD;
            const j = fj - FIELD_PAD;
            const plan = getChunkPlan(cx + Math.floor(i / GRID), cz + Math.floor(j / GRID));
            if (isWaterCell(plan, ((i % GRID) + GRID) % GRID, ((j % GRID) + GRID) % GRID)) field[fj * FIELD_SIZE + fi] = 0;
        }
    }

    // Two-pass chamfer distance transform.
    const relax = (index, fi, fj, di, dj, cost) => {
        const ni = fi + di;
        const nj = fj + dj;
        if (ni < 0 || nj < 0 || ni >= FIELD_SIZE || nj >= FIELD_SIZE) return;
        field[index] = Math.min(field[index], field[nj * FIELD_SIZE + ni] + cost);
    };
    for (let fj = 0; fj < FIELD_SIZE; fj++) {
        for (let fi = 0; fi < FIELD_SIZE; fi++) {
            const index = fj * FIELD_SIZE + fi;
            relax(index, fi, fj, -1, 0, 1);
            relax(index, fi, fj, 0, -1, 1);
            relax(index, fi, fj, -1, -1, 1.414);
            relax(index, fi, fj, 1, -1, 1.414);
        }
    }
    for (let fj = FIELD_SIZE - 1; fj >= 0; fj--) {
        for (let fi = FIELD_SIZE - 1; fi >= 0; fi--) {
            const index = fj * FIELD_SIZE + fi;
            relax(index, fi, fj, 1, 0, 1);
            relax(index, fi, fj, 0, 1, 1);
            relax(index, fi, fj, 1, 1, 1.414);
            relax(index, fi, fj, -1, 1, 1.414);
        }
    }
    return field;
}

function waterDistance(field, x, z) {
    let nearest = 1e6;
    for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        const fi = Math.min(FIELD_SIZE - 1, Math.max(0, Math.floor(x + ox + HALF) + FIELD_PAD));
        const fj = Math.min(FIELD_SIZE - 1, Math.max(0, Math.floor(z + oz + HALF) + FIELD_PAD));
        nearest = Math.min(nearest, field[fj * FIELD_SIZE + fi]);
    }
    return nearest;
}

/**
 * Accumulates tile surfaces for one chunk into a single indexed geometry.
 * Besides position, normal, and uv (in metres), every vertex carries
 * `fixtureIrradiance` (direct light from the wells, baked here rather than by
 * the engine so that vertices hidden inside curved walls can borrow their
 * light from in front of the curve), `poolFill` (bounced light), and
 * `poolAqua` (how strongly nearby water lights it).
 */
class TileBuilder {
    constructor(plan, field, lighting) {
        this.plan = plan;
        this.originX = plan.cx * CHUNK_SIZE;
        this.originZ = plan.cz * CHUNK_SIZE;
        this.field = field;
        this.lighting = lighting;
        this.positions = [];
        this.normals = [];
        this.uvs = [];
        this.aqua = [];
        this.fill = [];
        this.plain = [];
        this.irradiance = [];
        this.indices = [];
        this.sample = { x: 0, y: 0, z: 0 };
        this.normal = { x: 0, y: 0, z: 0 };
        this.lit = { x: 0, z: 0 };
    }

    get count() {
        return this.positions.length / 3;
    }

    aquaAt(x, y, z, ny) {
        if (y < WATER_LEVEL) return 1;
        if (ny > 0.5) return 0;
        const reach = Math.max(0, 1 - waterDistance(this.field, x, z) / 7);
        return reach * Math.sqrt(reach) * (1 - 0.55 * Math.min(1, y / 8));
    }

    vertex(x, y, z, nx, ny, nz, u, v, plain) {
        this.plain.push(plain);
        this.positions.push(x, y, z);
        this.normals.push(nx, ny, nz);
        this.uvs.push(u, v);
        this.aqua.push(this.aquaAt(x, y, z, ny));
        // Light is sampled in front of any curved wall this vertex is hidden behind.
        const lit = ny === 0 ? this.lit : nudgeOutOfCurve(this.plan, x, z, this.lit);
        if (ny === 0) {
            lit.x = x;
            lit.z = z;
        }
        const worldX = this.originX + lit.x;
        const worldZ = this.originZ + lit.z;
        this.sample.x = worldX;
        this.sample.y = y;
        this.sample.z = worldZ;
        this.normal.x = nx;
        this.normal.y = ny;
        this.normal.z = nz;
        this.irradiance.push(sampleFixtureIrradiance(this.sample, this.normal, this.lighting));
        this.fill.push(this.fillAt(worldX, y, worldZ, nx, ny, nz));
    }

    fillAt(x, y, z, nx, ny, nz) {
        if (ny < -0.5) return this.floorLight(x, z) * CEILING_BOUNCE;
        const fill = sampleFixtureFill(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02, this.lighting) * FILL_SHARE;
        if (ny > 0.5) return fill;
        // Walls see less of the floor the higher up they are.
        return fill + this.floorLight(x + nx * 1.2, z + nz * 1.2) * WALL_BOUNCE * (1 - 0.4 * Math.min(1, Math.max(0, y) / 8));
    }

    // Fixture light arriving on the floor (or the water) at a world position.
    floorLight(x, z) {
        this.sample.x = x;
        this.sample.y = 0.02;
        this.sample.z = z;
        return sampleFixtureIrradiance(this.sample, UP, this.lighting);
    }

    /**
     * Adds a patch tessellated along the coordinate lines `as` × `bs`.
     * `point(a, b)` gives the position, `normal` a constant or per-vertex
     * normal, and `uv(a, b)` the texture coordinates in metres. `plain`
     * surfaces are smooth plaster instead of tile.
     */
    patch(as, bs, point, normal, uv, plain = 0) {
        const base = this.count;
        for (const b of bs) {
            for (const a of as) {
                const [x, y, z] = point(a, b);
                const [nx, ny, nz] = typeof normal === 'function' ? normal(a, b) : normal;
                const [u, v] = uv(a, b);
                this.vertex(x, y, z, nx, ny, nz, u, v, plain);
            }
        }

        const flipped = this.windsAgainstNormal(base, as.length);
        for (let row = 0; row < bs.length - 1; row++) {
            for (let column = 0; column < as.length - 1; column++) {
                const i00 = base + row * as.length + column;
                const i10 = i00 + 1;
                const i01 = i00 + as.length;
                const i11 = i01 + 1;
                if (flipped) this.indices.push(i00, i01, i10, i10, i01, i11);
                else this.indices.push(i00, i10, i01, i10, i11, i01);
            }
        }
    }

    // Compares the patch's geometric normal at its first corner with the shading normal.
    windsAgainstNormal(base, stride) {
        const p = this.positions;
        const o = base * 3;
        const a = (base + 1) * 3;
        const b = (base + stride) * 3;
        const ax = p[a] - p[o];
        const ay = p[a + 1] - p[o + 1];
        const az = p[a + 2] - p[o + 2];
        const bx = p[b] - p[o];
        const by = p[b + 1] - p[o + 1];
        const bz = p[b + 2] - p[o + 2];
        const n = this.normals;
        return (ay * bz - az * by) * n[o] + (az * bx - ax * bz) * n[o + 1] + (ax * by - ay * bx) * n[o + 2] < 0;
    }

    toGeometry() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
        geometry.setAttribute('poolAqua', new THREE.Float32BufferAttribute(this.aqua, 1));
        geometry.setAttribute('poolFill', new THREE.Float32BufferAttribute(this.fill, 1));
        geometry.setAttribute('poolPlain', new THREE.Float32BufferAttribute(this.plain, 1));
        geometry.setAttribute('fixtureIrradiance', new THREE.Float32BufferAttribute(this.irradiance, 1));
        geometry.setIndex(this.indices);
        return geometry;
    }
}

function range(from, to) {
    const values = [];
    for (let value = from; value <= to; value++) values.push(value);
    return values;
}

// Height lines for a vertical face: both ends plus every whole metre between,
// so neighbouring faces of different heights still share their vertices.
function heightLines(bottom, top) {
    const lines = [bottom];
    for (let y = Math.floor(bottom) + 1; y < top; y++) lines.push(y);
    lines.push(top);
    return lines;
}

function addFloorsAndCeilings(builder, plan) {
    const floors = greedyRects((i, j) => (isOpenCell(plan, i, j) ? plan.floor[cellIndex(i, j)] : null));
    for (const rect of floors) {
        builder.patch(range(rect.i - HALF, rect.i + rect.w - HALF), range(rect.j - HALF, rect.j + rect.h - HALF),
            (a, b) => [a, rect.key, b], [0, 1, 0], (a, b) => [a, b]);
    }

    // Arched openings are closed overhead by their arch, and working light wells are open to the sun.
    const covered = (i, j) => isOpenCell(plan, i, j) && !plan.arched[cellIndex(i, j)] && !plan.skylight[cellIndex(i, j)] && !plan.hole[cellIndex(i, j)];
    const ceilings = greedyRects((i, j) => (covered(i, j) ? plan.ceil[cellIndex(i, j)] : null));
    for (const rect of ceilings) {
        builder.patch(range(rect.i - HALF, rect.i + rect.w - HALF), range(rect.j - HALF, rect.j + rect.h - HALF),
            (a, b) => [a, rect.key, b], [0, -1, 0], (a, b) => [a, b], 1);
    }
}

// Vertical spans a cell shows towards one neighbour: a wall, a pool side or step, a drop in the ceiling.
function faceSpans(plan, i, j, di, dj) {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) return [];
    const index = cellIndex(i, j);
    const floor = plan.floor[index];
    const ceil = plan.ceil[index];
    const neighbour = cellIndex(ni, nj);
    if (plan.solid[neighbour]) return [[floor, ceil]];
    const spans = [];
    if (plan.floor[neighbour] > floor) spans.push([floor, Math.min(plan.floor[neighbour], ceil)]);
    if (plan.ceil[neighbour] < ceil) spans.push([Math.max(plan.ceil[neighbour], floor), ceil]);
    return spans;
}

// `line` is the wall plane between a cell and its neighbour, `along` the cell's position on it.
function facePlane(i, j, di, dj) {
    return di === 0 ? { line: j + Math.max(0, dj), along: i } : { line: i + Math.max(0, di), along: j };
}

function forEachOpenCell(plan, visit) {
    for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
            if (isOpenCell(plan, i, j)) visit(i, j);
        }
    }
}

function collectFaces(plan) {
    const faces = [];
    DIRECTIONS.forEach(([di, dj], direction) => {
        forEachOpenCell(plan, (i, j) => {
            const { line, along } = facePlane(i, j, di, dj);
            for (const [bottom, top] of faceSpans(plan, i, j, di, dj)) faces.push({ direction, line, along, bottom, top });
        });
    });
    return faces.sort((a, b) => a.direction - b.direction || a.line - b.line || a.bottom - b.bottom || a.top - b.top || a.along - b.along);
}

function addVerticalFaces(builder, plan) {
    const faces = collectFaces(plan);
    let start = 0;
    while (start < faces.length) {
        const first = faces[start];
        let end = start;
        while (end + 1 < faces.length && continuesRun(faces[end], faces[end + 1])) end++;
        const [di, dj] = DIRECTIONS[first.direction];
        const plane = first.line - HALF;
        const as = range(first.along - HALF, faces[end].along + 1 - HALF);
        const point = di === 0 ? (a, b) => [a, b, plane] : (a, b) => [plane, b, a];
        // The shallow reveal around a light well is plaster, like the ceiling it cuts through.
        const reveal = first.bottom >= plan.height && first.top - first.bottom <= 0.75 ? 1 : 0;
        builder.patch(as, heightLines(first.bottom, first.top), point, [-di, 0, -dj], (a, b) => [a, b], reveal);
        start = end + 1;
    }
}

function continuesRun(face, next) {
    return next.direction === face.direction && next.line === face.line && next.bottom === face.bottom
        && next.top === face.top && next.along === face.along + 1;
}

// Lowest floor under a round shaft, so it reaches the bottom of any pool it stands in.
function lowestFloor(plan, x, z, radius) {
    let bottom = 0;
    for (let j = Math.floor(z - radius + HALF); j <= Math.floor(z + radius + HALF); j++) {
        for (let i = Math.floor(x - radius + HALF); i <= Math.floor(x + radius + HALF); i++) {
            if (isOpenCell(plan, i, j)) bottom = Math.min(bottom, plan.floor[cellIndex(i, j)]);
        }
    }
    return bottom;
}

// Columns and drums: round tiled shafts from the pool floor to the ceiling.
function addShafts(builder, plan) {
    for (const shaft of [...plan.columns, ...plan.drums]) {
        const segments = Math.max(COLUMN_SEGMENTS, Math.round(shaft.radius * 14));
        const angles = range(0, segments).map((step) => step / segments * Math.PI * 2);
        // A whole number of tiles wraps the shaft.
        const wrap = Math.round(Math.PI * 2 * shaft.radius * TILES_PER_METRE) / TILES_PER_METRE;
        // Most shafts stop at the ceiling; some rise on through a light shaft above it.
        const top = shaft.top ?? (shaft.tall ? plan.ceil[cellIndex(Math.floor(shaft.x + HALF), Math.floor(shaft.z + HALF))] : plan.height + 0.02);
        builder.patch(angles, heightLines(lowestFloor(plan, shaft.x, shaft.z, shaft.radius), top),
            (angle, y) => [shaft.x + Math.cos(angle) * shaft.radius, y, shaft.z + Math.sin(angle) * shaft.radius],
            (angle) => [Math.cos(angle), 0, Math.sin(angle)],
            (angle, y) => [angle / (Math.PI * 2) * wrap, y]);
    }
}

// A rounded hall corner: a quarter cylinder that flows out of one wall and into the next.
function addFillets(builder, plan) {
    const wall = HALF - 1;
    const steps = range(0, FILLET_SEGMENTS).map((step) => step / FILLET_SEGMENTS * Math.PI / 2);
    for (const fillet of plan.fillets) {
        const centreX = fillet.sx * (wall - fillet.radius);
        const centreZ = fillet.sz * (wall - fillet.radius);
        const bottom = lowestFloor(plan, fillet.sx * (wall - 1), fillet.sz * (wall - 1), fillet.radius);
        builder.patch(steps, heightLines(bottom, plan.height + 0.02),
            (angle, y) => [centreX + fillet.sx * Math.cos(angle) * fillet.radius, y, centreZ + fillet.sz * Math.sin(angle) * fillet.radius],
            (angle) => [-fillet.sx * Math.cos(angle), 0, -fillet.sz * Math.sin(angle)],
            (angle, y) => [angle * fillet.radius, y]);
    }
}

const STAIR_RING = [];
for (let step = -STAIR.block; step < STAIR.block; step++) STAIR_RING.push([step, -STAIR.block]);
for (let step = -STAIR.block; step < STAIR.block; step++) STAIR_RING.push([STAIR.block, step]);
for (let step = STAIR.block; step > -STAIR.block; step--) STAIR_RING.push([step, STAIR.block]);
for (let step = STAIR.block; step > -STAIR.block; step--) STAIR_RING.push([-STAIR.block, step]);
STAIR_RING.push(STAIR_RING[0]);

// The slab steps of a spiral stair, each cantilevered from the column.
function addStairSteps(builder, stair) {
    const at = (angle, distance, y) => [stair.x + Math.cos(angle) * distance, y, stair.z + Math.sin(angle) * distance];
    const flat = (angle, distance) => [stair.x + Math.cos(angle) * distance, stair.z + Math.sin(angle) * distance];
    const radii = [STAIR.column, (STAIR.column + STAIR.radius) / 2, STAIR.radius];
    for (let step = 0; step < stair.steps; step++) {
        const from = stair.start + step * stair.angle;
        const to = from + stair.angle * (step === stair.steps - 1 ? 2 : 1);
        const top = stair.base + (step + 1) * STAIR.riser;
        const angles = [from, (from + to) / 2, to];
        const heights = [top - STAIR.slab, top];
        builder.patch(angles, radii, (angle, distance) => at(angle, distance, top), [0, 1, 0], flat);
        builder.patch(angles, radii, (angle, distance) => at(angle, distance, top - STAIR.slab), [0, -1, 0], flat, 1);
        builder.patch(radii, heights, (distance, y) => at(from, distance, y), [Math.sin(from), 0, -Math.cos(from)], (distance, y) => [distance, y]);
        builder.patch(radii, heights, (distance, y) => at(to, distance, y), [-Math.sin(to), 0, Math.cos(to)], (distance, y) => [distance, y]);
        builder.patch(angles, heights, (angle, y) => at(angle, STAIR.radius, y), (angle) => [Math.cos(angle), 0, Math.sin(angle)], (angle, y) => [angle * STAIR.radius, y]);
    }
}

// The ceiling around the stair's round hole, and the tiled shaft above it.
function addStairShaft(builder, plan, stair) {
    const angles = range(0, 36).map((step) => step / 36 * Math.PI * 2);
    builder.patch(range(0, STAIR_RING.length - 1), [0, 1],
        (corner, inner) => {
            const [x, z] = STAIR_RING[corner];
            const scale = inner ? STAIR.hole / Math.hypot(x, z) : 1;
            return [stair.x + x * scale, plan.height, stair.z + z * scale];
        },
        [0, -1, 0],
        (corner, inner) => {
            const [x, z] = STAIR_RING[corner];
            const scale = inner ? STAIR.hole / Math.hypot(x, z) : 1;
            return [stair.x + x * scale, stair.z + z * scale];
        }, 1);
    builder.patch(angles, heightLines(plan.height, plan.height + STAIR.rise),
        (angle, y) => [stair.x + Math.cos(angle) * STAIR.hole, y, stair.z + Math.sin(angle) * STAIR.hole],
        (angle) => [-Math.cos(angle), 0, -Math.sin(angle)],
        (angle, y) => [angle * STAIR.hole, y]);
}

// A steel rail along the stair's outer edge from the third step up, and across the end of the landing.
function addStairRail(steel, stair) {
    const edge = STAIR.radius - 0.06;
    const height = (angle) => stair.base + ((angle - stair.start) / stair.angle + 1) * STAIR.riser + 0.95;
    const end = stair.start + STAIR.turn;
    const top = stair.base + stair.steps * STAIR.riser + 0.95;
    const points = [];
    for (let step = 2; step <= stair.steps + 1; step += 0.5) {
        const angle = stair.start + step * stair.angle;
        const y = Math.min(height(angle), top);
        points.push(new THREE.Vector3(stair.x + Math.cos(angle) * edge, y, stair.z + Math.sin(angle) * edge));
        if (step % 1 !== 0) continue;
        steel.push(new THREE.CylinderGeometry(0.012, 0.012, 0.95, 6).translate(points.at(-1).x, y - 0.475, points.at(-1).z));
    }
    points.push(new THREE.Vector3(stair.x + Math.cos(end) * STAIR.column, top, stair.z + Math.sin(end) * STAIR.column));
    steel.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.2), points.length * 4, 0.02, 6));
}

function addStair(builder, plan, steel) {
    if (!plan.stair) return;
    addStairSteps(builder, plan.stair);
    addStairShaft(builder, plan, plan.stair);
    addStairRail(steel, plan.stair);
}

/**
 * A tube slide coiled around a column: it spirals out of the column near the
 * ceiling, winds down turn on turn, and runs out to an open mouth at the
 * water. Returns its red shell and its black lining.
 */
function createCoil(plan) {
    const coil = plan.coil;
    if (!coil) return null;
    const top = Math.min(plan.height - 1, 4.5);
    const turns = Math.max(1, Math.floor((top - 0.7) / COIL.pitch));
    const steps = turns * 24;
    const points = [];
    for (let step = 0; step <= steps; step++) {
        const angle = coil.start + step / 24 * Math.PI * 2;
        // The first quarter turn eases out of the column.
        const distance = COIL.radius - Math.max(0, 1 - step / 6) * (COIL.radius - COIL.column + 0.3);
        points.push(new THREE.Vector3(coil.x + Math.cos(angle) * distance, top - step / 24 * COIL.pitch, coil.z + Math.sin(angle) * distance));
    }
    // The run-out leaves the last coil along its tangent and settles onto the water.
    const last = points.at(-1);
    const angle = coil.start + turns * Math.PI * 2;
    const mouthHeight = WATER_LEVEL + COIL.tube - 0.04;
    for (const [along, drop] of [[0.9, 0.45], [1.8, 0.85], [2.6, 1]]) {
        points.push(new THREE.Vector3(last.x - Math.sin(angle) * along, last.y + (mouthHeight - last.y) * drop, last.z + Math.cos(angle) * along));
    }
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    return {
        shell: new THREE.TubeGeometry(curve, steps * 2 + 24, COIL.tube, 14),
        lining: new THREE.TubeGeometry(curve, steps * 2 + 24, COIL.tube - 0.035, 14),
        mouth: points.at(-1),
    };
}

// Fills the corners above a round arch: its face towards the hall and its curved underside.
function addArches(builder, plan) {
    for (const arch of plan.arches) {
        const frame = SIDE_FRAMES[arch.side];
        const radius = (arch.to + 1 - arch.from) / 2;
        const centre = arch.from + radius - HALF;
        const spring = arch.top - radius;
        const angles = range(0, ARCH_SEGMENTS).map((step) => step / ARCH_SEGMENTS * Math.PI);
        const across = (angle) => centre - Math.cos(angle) * radius;
        const rise = (angle) => spring + Math.sin(angle) * radius;

        builder.patch(angles, [0, 1],
            (angle, upper) => frame.point(across(angle), upper ? arch.top : rise(angle), 1),
            frame.inward,
            (angle, upper) => [across(angle), upper ? arch.top : rise(angle)]);
        builder.patch(angles, [0, 1],
            (angle, depth) => frame.point(across(angle), rise(angle), depth),
            (angle) => [frame.along[0] * Math.cos(angle), -Math.sin(angle), frame.along[2] * Math.cos(angle)],
            (angle, depth) => [angle * radius, depth]);
    }
}

function addWater(group, plan, cx, cz, lighting, material) {
    const rects = greedyRects((i, j) => (isWaterCell(plan, i, j) ? 1 : null));
    if (rects.length === 0) return;
    const positions = [];
    const light = [];
    const indices = [];
    for (const rect of rects) {
        const base = positions.length / 3;
        const stride = rect.w + 1;
        for (let b = 0; b <= rect.h; b++) {
            for (let a = 0; a <= rect.w; a++) {
                const x = rect.i + a - HALF;
                const z = rect.j + b - HALF;
                positions.push(x, WATER_LEVEL, z);
                const lit = nudgeOutOfCurve(plan, x, z, waterSample);
                light.push(sampleFixtureFill(cx * CHUNK_SIZE + lit.x, WATER_LEVEL + 0.05, cz * CHUNK_SIZE + lit.z, lighting));
            }
        }
        for (let b = 0; b < rect.h; b++) {
            for (let a = 0; a < rect.w; a++) {
                const corner = base + b * stride + a;
                indices.push(corner, corner + stride, corner + 1, corner + 1, corner + stride, corner + stride + 1);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('poolLight', new THREE.Float32BufferAttribute(light, 1));
    geometry.setIndex(indices);
    const water = new THREE.Mesh(geometry, material);
    water.userData.ownsGeometry = true;
    addStaticMesh(group, water);
}

// Solid tile has no top face, so from the sun's point of view the gaps above
// the walls are open sky. A lid over every solid or arched cell closes them.
// It is drawn only into the sun's depth image (see sun.js).
function addRoof(group, plan, material) {
    // A stair shaft whose skylight has failed is closed to the sun as well.
    const closed = (index) => plan.solid[index] || plan.arched[index] || (plan.hole[index] && !plan.stair.powered);
    const lids = greedyRects((i, j) => (closed(cellIndex(i, j)) ? 1 : null))
        .map((rect) => new THREE.PlaneGeometry(rect.w, rect.h).rotateX(Math.PI / 2).translate(rect.i + rect.w / 2 - HALF, WALL_TOP, rect.j + rect.h / 2 - HALF));
    addMergedMesh(group, lids, material);
}

// One bright panel closes the top of every light well: the sky, or what stands in for it.
function addLightPanels(group, state, plan, cx, cz, resources) {
    if (plan.wells.length === 0) return;
    const panels = new THREE.InstancedMesh(resources.geometry.panel, resources.materials.panel, plan.wells.length);
    panels.matrixAutoUpdate = false;
    panels.frustumCulled = false;
    plan.wells.forEach((well, index) => {
        tempMatrix.compose(tempPosition.set(well.x, well.y, well.z), identityRotation, tempScale.set(well.sx, 1, well.sz));
        panels.setMatrixAt(index, tempMatrix);
        panels.setColorAt(index, well.powered ? poweredPanelColor : failedPanelColor);
    });
    panels.instanceMatrix.needsUpdate = true;
    group.add(panels);
    for (const fixture of plan.fixtures) state.lightPanels.push(createPoolFixture(cx, cz, fixture));
}

function createPoolFixture(cx, cz, fixture) {
    const record = createFixtureRecord(cx * CHUNK_SIZE + fixture.x, fixture.y, cz * CHUNK_SIZE + fixture.z, fixture.powered);
    record.userData.intensity = fixture.light;
    return record;
}

function addCollision(state, plan, cx, cz) {
    for (const wall of getCollisionBlocks(plan)) {
        state.walls.push(createWallRecord(cx, cz, wall.x, (WALL_TOP + WALL_BOTTOM) / 2, wall.z, wall.sx, WALL_TOP - WALL_BOTTOM, wall.sz));
    }
    for (const column of plan.columns) {
        const side = column.radius * 1.75;
        state.walls.push(createWallRecord(cx, cz, column.x, 1.5, column.z, side, 3, side));
    }
}

function facePhone(phone, nx, nz) {
    phone.rotation.z = -Math.PI / 2;
    if (nx > 0.5) phone.rotation.y = 0;
    else if (nx < -0.5) phone.rotation.y = Math.PI;
    else phone.rotation.y = nz > 0.5 ? -Math.PI / 2 : Math.PI / 2;
}

// A steel pool ladder: two rails arching from the deck over the edge, treads under water.
const LADDER_RAIL = [[-0.42, 0], [-0.42, 0.35], [-0.42, 0.62], [-0.347, 0.797], [-0.17, 0.87], [0.007, 0.797], [0.08, 0.62], [0.08, 0.2]];

function createLadders(plan) {
    const parts = [];
    for (const spot of getLadderSpots(plan)) {
        // Ladder space: `side` along the pool edge, `out` towards the water.
        const place = (side, y, out) => new THREE.Vector3(spot.x - spot.dz * side + spot.dx * out, y, spot.z + spot.dx * side + spot.dz * out);
        const foot = Math.max(0.3, spot.depth - 0.12);
        for (const side of [-0.26, 0.26]) {
            const points = [...LADDER_RAIL, [0.08, -foot]].map(([out, y]) => place(side, y, out));
            parts.push(
                new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), 30, 0.022, 8),
                new THREE.CylinderGeometry(0.05, 0.05, 0.014, 12).translate(points[0].x, 0.007, points[0].z),
            );
        }
        for (let y = -0.2; y > -foot + 0.05; y -= 0.25) {
            const centre = place(0, y, 0.1);
            parts.push(new THREE.BoxGeometry(spot.dx === 0 ? 0.52 : 0.1, 0.025, spot.dx === 0 ? 0.1 : 0.52).translate(centre.x, centre.y, centre.z));
        }
    }
    return parts;
}

const SLIDE_SEGMENTS = 22;
const SLIDE_SIDES = 18;

/**
 * A tube slide: glazed tile outside, nothing at all inside. It leaves the wall
 * high up, curves down over the deck, and ends just above the water. Adds the
 * tube to the tile builder, its steel rim to `steel`, and returns the black
 * lining plus the stretch that is low enough to walk into.
 */
function addSlide(builder, plan, steel, state, cx, cz) {
    const slide = getSlide(plan);
    if (!slide) return [];
    const frame = SIDE_FRAMES[slide.side];
    const along = slide.t + 1 - HALF;
    const end = slide.run + 0.75;
    const drop = slide.top - 0.78;
    const length = end - 1;
    const profile = [[0.5, slide.top], [1, slide.top], [1 + length * 0.3, slide.top - drop * 0.16], [1 + length * 0.72, slide.top - drop * 0.82], [end - 0.25, 0.8], [end, 0.78]];
    const curve = new THREE.CatmullRomCurve3(profile.map(([depth, y]) => new THREE.Vector3(...frame.point(along, y, depth))), false, 'centripetal');
    const points = curve.getSpacedPoints(SLIDE_SEGMENTS);
    const frames = curve.computeFrenetFrames(SLIDE_SEGMENTS, false);
    const span = curve.getLength();
    const wrap = Math.round(Math.PI * 2 * SLIDE_RADIUS * TILES_PER_METRE) / TILES_PER_METRE;
    const angles = range(0, SLIDE_SIDES).map((step) => step / SLIDE_SIDES * Math.PI * 2);
    const radial = (step, angle) => frames.normals[step].clone().multiplyScalar(Math.cos(angle)).addScaledVector(frames.binormals[step], Math.sin(angle));

    builder.patch(range(0, SLIDE_SEGMENTS), angles,
        (step, angle) => points[step].clone().addScaledVector(radial(step, angle), SLIDE_RADIUS).toArray(),
        (step, angle) => radial(step, angle).toArray(),
        (step, angle) => [Math.round(step / SLIDE_SEGMENTS * span * TILES_PER_METRE) / TILES_PER_METRE, angle / (Math.PI * 2) * wrap]);

    // A steel rim around the mouth, facing along the tube.
    const mouth = points.at(-1);
    const rim = new THREE.TorusGeometry(SLIDE_RADIUS - 0.01, 0.035, 8, 28);
    rim.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), frames.tangents.at(-1)));
    steel.push(rim.translate(mouth.x, mouth.y, mouth.z));

    // Where the tube hangs lower than head height it blocks the way.
    const low = points.filter((point) => point.y - SLIDE_RADIUS < 1.95);
    const box = new THREE.Box3().setFromPoints(low).expandByVector(new THREE.Vector3(SLIDE_RADIUS, 0, SLIDE_RADIUS));
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    state.walls.push(createWallRecord(cx, cz, centre.x, 1.5, centre.z, size.x, 3, size.z));

    return [new THREE.TubeGeometry(curve, SLIDE_SEGMENTS, SLIDE_RADIUS - 0.035, SLIDE_SIDES)];
}

function addSigns(group, plan, phoneSpot, material) {
    const parts = [];
    for (const spot of getSignSpots(plan, SIGN_TEXTS.length)) {
        if (phoneSpot && Math.hypot(phoneSpot.x - spot.x, phoneSpot.z - spot.z) < 2) continue;
        const plate = new THREE.BoxGeometry(0.84, 0.21, 0.012);
        const column = spot.text % SIGN_COLUMNS;
        const row = Math.floor(spot.text / SIGN_COLUMNS);
        const uvs = plate.attributes.uv;
        for (let index = 0; index < uvs.count; index++) {
            uvs.setXY(index, (column + uvs.getX(index)) / SIGN_COLUMNS, 1 - (row + 1 - uvs.getY(index)) / SIGN_ROWS);
        }
        plate.rotateY(Math.atan2(spot.nx, spot.nz)).translate(spot.x + spot.nx * 0.007, 1.72, spot.z + spot.nz * 0.007);
        parts.push(plate);
    }
    addMergedMesh(group, parts, material);
}

function addLaneLines(group, plan, material) {
    const parts = plan.lines.map((line) => {
        const strip = new THREE.PlaneGeometry(line.sx, line.sz, Math.ceil(line.sx), Math.ceil(line.sz));
        strip.rotateX(-Math.PI / 2).translate(line.x, line.y + 0.004, line.z);
        const positions = strip.attributes.position;
        for (let index = 0; index < positions.count; index++) strip.attributes.uv.setXY(index, positions.getX(index), positions.getZ(index));
        return strip;
    });
    addMergedMesh(group, parts, material);
}

function choosePhoneSpot(plan, cx, cz, phoneSeed) {
    if (!isPhoneChunk(cx, cz, phoneSeed)) return null;
    const spots = getPhoneSpots(plan);
    return spots.length > 0 ? spots[Math.floor(poolNoise(cx, cz, phoneSeed) * spots.length)] : null;
}

function addPhone(group, state, spot, context, resources) {
    const { cx, cz, debugNormals, debugMode } = context;
    const model = resources.models.phone;
    if (!model || !spot) return;
    const phone = model.clone();
    const x = spot.x + spot.nx * 0.08;
    const z = spot.z + spot.nz * 0.08;
    phone.position.set(x, 1.6, z);
    facePhone(phone, spot.nx, spot.nz);
    registerPhone(group, state, phone, cx, cz, x, z, 1.6);
    addDebugHelpers(phone, group, debugNormals, debugMode, 0x00ffff, 0.5);
}

export function buildPoolChunk({ cx, cz, group, state, debugMode, debugNormals, phoneSeed }) {
    const resources = getPoolResources();
    const plan = getChunkPlan(cx, cz);
    const lighting = createPoolLightingContext(cx, cz);
    const builder = new TileBuilder(plan, createWaterField(cx, cz), lighting);

    addFloorsAndCeilings(builder, plan);
    addVerticalFaces(builder, plan);
    addShafts(builder, plan);
    addFillets(builder, plan);
    addArches(builder, plan);
    const steel = createLadders(plan);
    const lining = addSlide(builder, plan, steel, state, cx, cz);
    addStair(builder, plan, steel);
    const coil = createCoil(plan);
    if (coil) {
        lining.push(coil.lining);
        addMergedMesh(group, [coil.shell], resources.materials.slide, { castShadow: true });
        state.walls.push(createWallRecord(cx, cz, coil.mouth.x, 1.5, coil.mouth.z, 1.3, 3, 1.3));
    }

    const tiles = new THREE.Mesh(builder.toGeometry(), resources.materials.tile);
    tiles.userData.ownsGeometry = true;
    tiles.userData.ownsFixtureLighting = true;
    addStaticMesh(group, tiles, { castShadow: true, receiveShadow: true });

    const phoneSpot = choosePhoneSpot(plan, cx, cz, phoneSeed);
    addLaneLines(group, plan, resources.materials.line);
    addMergedMesh(group, steel, resources.materials.steel, { castShadow: true });
    addMergedMesh(group, lining, resources.materials.hollow);
    addSigns(group, plan, phoneSpot, resources.materials.sign);
    addRoof(group, plan, resources.materials.roof);
    addWater(group, plan, cx, cz, lighting, resources.materials.water);
    addLightPanels(group, state, plan, cx, cz, resources);
    addCollision(state, plan, cx, cz);
    addPhone(group, state, phoneSpot, { cx, cz, debugNormals, debugMode }, resources);
}

let cachedLighting = null;

// Walls and fixtures from the neighbouring halls too, so light agrees across
// borders. The chunk builder and the fixture bake share one context per chunk.
export function createPoolLightingContext(cx, cz) {
    if (cachedLighting?.cx === cx && cachedLighting.cz === cz) return cachedLighting.context;
    const lightingState = createChunkState();
    const reach = HALF + POOL_LIGHT.range;
    for (let nx = cx - 1; nx <= cx + 1; nx++) {
        for (let nz = cz - 1; nz <= cz + 1; nz++) {
            const plan = getChunkPlan(nx, nz);
            for (const wall of getLightBlocks(plan)) {
                lightingState.walls.push(createWallRecord(nx, nz, wall.x, (WALL_TOP + WALL_BOTTOM) / 2, wall.z, wall.sx, WALL_TOP - WALL_BOTTOM, wall.sz));
            }
            for (const fixture of plan.fixtures) {
                const dx = Math.abs(nx * CHUNK_SIZE + fixture.x - cx * CHUNK_SIZE);
                const dz = Math.abs(nz * CHUNK_SIZE + fixture.z - cz * CHUNK_SIZE);
                if (dx <= reach && dz <= reach) lightingState.lightPanels.push(createPoolFixture(nx, nz, fixture));
            }
        }
    }
    const context = createFixtureBakeContext(lightingState.lightPanels, lightingState.walls, POOL_LIGHT);
    cachedLighting = { cx, cz, context };
    return context;
}
