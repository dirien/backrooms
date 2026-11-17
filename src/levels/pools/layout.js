import { CHUNK_SIZE } from '../../constants.js';

/**
 * Level 37 layout rules, as plain chunk-local data (no Three.js), so tests,
 * lighting contexts, and the ground sampler can use them without building meshes.
 *
 * Every chunk is one tiled hall on a 1 m cell grid. Each cell is either solid
 * tile or open with a floor height and a ceiling height; floors below
 * WATER_LEVEL are under water. The outer ring of cells is the wall between
 * halls: neighbouring chunks own half of it each and read its openings from a
 * shared edge function, so walls, arches, and canals agree across borders.
 * Every edge has at least one opening, so the whole level is connected.
 */

export const GRID = CHUNK_SIZE;
export const WATER_LEVEL = -0.06;
export const RECESS = 0.6;
export const CANAL_FLOOR = -0.6;
export const COLUMN_RADIUS = 0.42;

const LAST = GRID - 1;
const HALF = CHUNK_SIZE / 2;
const CELLS = GRID * GRID;
const PLAN_CACHE_LIMIT = 512;
export const FILLET_RADIUS = 4;
// A spiral stair: steps wind three quarters of a turn around a column and up
// through a round hole in the ceiling into a shaft of light.
export const STAIR = { column: 0.9, radius: 2.8, riser: 0.2, slab: 0.32, turn: Math.PI * 1.5, hole: 3.3, rise: 3.5, block: 4 };
// A tube slide coiled around a column: the tube's centre line runs `radius`
// from the column's axis and drops `pitch` per turn.
export const COIL = { column: 1.3, radius: 1.85, tube: 0.5, pitch: 1.08, reach: 2.45 };
const STAIR_GROUP = 30;
// Light wells as [west cell, north cell, width = 2, depth = 2, brightness = 1].
const DEFAULT_LIGHTS = [[3, 3], [11, 3], [19, 3], [3, 11], [11, 11], [19, 11], [3, 19], [11, 19], [19, 19]];
// Long skylights beside the west and north walls: the low sun rakes those walls through them.
const SLOT_WEST = [3, 7, 2, 12];
const SLOT_NORTH = [7, 3, 12, 2];
const SUN_LIGHTS = [SLOT_WEST, SLOT_NORTH, [19, 3], [11, 11], [19, 11], [3, 19], [11, 19], [19, 19]];

// Integer hash: identical on every engine, unlike Math.sin-based noise.
export function poolNoise(x, z, salt = 0) {
    let hash = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
    hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

export function cellIndex(i, j) {
    return j * GRID + i;
}

function span(from, to, top, extra = {}) {
    return { from, to, top, arch: false, floor: 0, ledge: 0, ...extra };
}

const ARCADE = [
    span(1, 3, 3.3, { arch: true }),
    span(5, 8, 3.8, { arch: true }),
    span(10, 13, 3.8, { arch: true }),
    span(15, 18, 3.8, { arch: true }),
    span(20, 22, 3.3, { arch: true }),
];
const COLONNADE = [span(1, 3, 3.4), span(5, 8, 3.4), span(10, 13, 3.4), span(15, 18, 3.4), span(20, 22, 3.4)];

function edgeOpenings(roll, variant) {
    if (roll < 0.16) return { type: 'arcade', openings: ARCADE };
    if (roll < 0.25) return { type: 'colonnade', openings: COLONNADE };
    if (roll < 0.4) return { type: 'twin', openings: [span(5, 8, 3.8, { arch: true }), span(15, 18, 3.8, { arch: true })] };
    if (roll < 0.53) return { type: 'portal', openings: [span(10, 13, 3.8, { arch: true })] };
    if (roll < 0.61) return { type: 'gate', openings: [span(8, 15, 4.4)] };
    if (roll < 0.76) {
        let from = 11;
        if (variant < 0.3) from = 4;
        else if (variant > 0.7) from = 18;
        return { type: 'door', openings: [span(from, from + 1, 2.6)] };
    }
    if (variant < 0.6) return { type: 'canal', openings: [span(9, 14, 4, { arch: true, floor: CANAL_FLOOR, ledge: 1 })] };
    return { type: 'canal', openings: [span(10, 13, 3.4, { arch: true, floor: CANAL_FLOOR })] };
}

/**
 * The wall between two halls. Axis 'x' is the border between (cx, cz) and
 * (cx + 1, cz); axis 'z' between (cx, cz) and (cx, cz + 1). Openings list the
 * open cells along the border (index 0…23, west→east or north→south).
 */
export function getEdge(cx, cz, axis) {
    // The arrival hall looks north through an arcade; twin arches open to either side.
    if (axis === 'z' && cx === 0 && cz === -1) return { type: 'arcade', openings: ARCADE };
    if (axis === 'x' && cz === 0 && (cx === 0 || cx === -1)) return edgeOpenings(0.3, 0);
    const salt = axis === 'x' ? 11 : 29;
    return edgeOpenings(poolNoise(cx, cz, salt), poolNoise(cx, cz, salt + 1));
}

function openingFloor(opening, t) {
    if (opening.floor >= 0) return opening.floor;
    return t < opening.from + opening.ledge || t > opening.to - opening.ledge ? 0 : opening.floor;
}

// The four ring sides. `cell(t, depth)` maps an along-border index and a depth
// from the border (0 = ring) to chunk cell coordinates.
export const SIDES = [
    { name: 'north', edge: (cx, cz) => getEdge(cx, cz - 1, 'z'), cell: (t, depth) => [t, depth] },
    { name: 'south', edge: (cx, cz) => getEdge(cx, cz, 'z'), cell: (t, depth) => [t, LAST - depth] },
    { name: 'west', edge: (cx, cz) => getEdge(cx - 1, cz, 'x'), cell: (t, depth) => [depth, t] },
    { name: 'east', edge: (cx, cz) => getEdge(cx, cz, 'x'), cell: (t, depth) => [LAST - depth, t] },
];

function fill(plan, i0, j0, i1, j1, apply) {
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) apply(cellIndex(i, j), i, j);
    }
}

// A pool whose floor steps down one terrace per cell ring.
function basin(plan, i0, j0, i1, j1, depths) {
    fill(plan, i0, j0, i1, j1, (index, i, j) => {
        const ring = Math.min(i - i0, i1 - i, j - j0, j1 - j);
        plan.floor[index] = Math.min(plan.floor[index], -depths[Math.min(ring, depths.length - 1)]);
    });
}

function block(plan, i0, j0, i1, j1) {
    fill(plan, i0, j0, i1, j1, (index) => { plan.solid[index] = 1; });
}

function deck(plan, i0, j0, i1, j1) {
    fill(plan, i0, j0, i1, j1, (index) => { plan.floor[index] = 0; });
}

// A dark line of tiles along the floor of a lap pool, with a bar across each end.
function laneLine(plan, centre, alongZ) {
    const y = -0.9;
    for (const [across, along, width, length] of [[centre, 0, 0.25, 12.5], [centre, -6.25, 1, 0.25], [centre, 6.25, 1, 0.25]]) {
        plan.lines.push(alongZ ? { x: across, z: along, sx: width, sz: length, y } : { x: along, z: across, sx: length, sz: width, y });
    }
}

// Columns stand on lattice points (whole metres), so they stay symmetric about the hall axes.
function columns(plan, points) {
    for (const [x, z] of points) plan.columns.push({ x, z, radius: COLUMN_RADIUS });
}

// A drum is a column metres across: a curved wall you walk around.
function drums(plan, list) {
    for (const [x, z, radius] of list) plan.drums.push({ x, z, radius });
}

// The stair's steps climb from the hall floor to just under the ceiling.
function spiralStair(plan, x, z, quarter) {
    const base = plan.floor[cellIndex(x + HALF, z + HALF)];
    const steps = Math.ceil((plan.height - 0.8 - base) / STAIR.riser);
    // The top step is a landing two steps wide.
    plan.stair = { x, z, start: quarter * Math.PI / 2, steps, base, angle: STAIR.turn / (steps + 1), powered: false };
    plan.drums.push({ x, z, radius: STAIR.column, top: plan.height + STAIR.rise });
}

function coilSlide(plan, x, z, quarter) {
    plan.coil = { x, z, start: quarter * Math.PI / 2 };
    plan.drums.push({ x, z, radius: COIL.column, tall: true });
}

function lattice(values) {
    const points = [];
    for (const x of values) {
        for (const z of values) points.push([x, z]);
    }
    return points;
}

/**
 * Hall archetypes. `height` is the ceiling height, `canal` how many cells a
 * canal entering through a wall runs on into the hall, `light` scales every
 * fixture in the hall, and `lights` lists the light wells (see DEFAULT_LIGHTS).
 * `shaft` raises the ceiling over a block of cells into a tall tiled light shaft.
 */
const ARCHETYPES = {
    // The hall you wake in: dry tile underfoot, a terraced pool ahead, an arcade beyond it.
    arrival: {
        height: 6,
        canal: 6,
        light: 1.25,
        lights: SUN_LIGHTS,
        build(plan) {
            basin(plan, 5, 2, 18, 9, [0.2, 0.4, 0.6, 0.8]);
            // Two curved walls rise out of the pool and frame the arcade.
            drums(plan, [[-5, -4.6, 1.7], [5, -4.6, 1.7]]);
        },
    },
    // One great square pool stepping down in concentric terraces.
    grand: {
        height: 7,
        canal: 3,
        light: 1.6,
        shaft: { from: 8, to: 15, rise: 7 },
        lights: [SLOT_WEST, SLOT_NORTH, [19, 3], [19, 11], [3, 19], [11, 19], [19, 19], [10, 10, 4, 4, 2.6]],
        build(plan, roll) {
            basin(plan, 4, 4, 19, 19, [0.2, 0.4, 0.6, 0.8, 1, 1.1]);
            columns(plan, [[-10, -10], [10, -10], [-10, 10], [10, 10]]);
            if (roll < 0.4) columns(plan, [[-5, -5], [5, -5], [-5, 5], [5, 5]]);
            // Most great pools have a slide coiled around a column under the light shaft.
            if (roll > 0.25) coilSlide(plan, 0, 0, Math.floor(roll * 40) % 4);
        },
    },
    // Three lap pools side by side.
    lanes: {
        height: 4.6,
        canal: 2,
        light: 0.85,
        lights: SUN_LIGHTS,
        build(plan, roll) {
            for (const from of [3, 10, 17]) {
                if (roll < 0.5) basin(plan, from, 3, from + 3, 20, [0.5, 0.9]);
                else basin(plan, 3, from, 20, from + 3, [0.5, 0.9]);
                laneLine(plan, from + 2 - HALF, roll < 0.5);
            }
        },
    },
    // A low pillar hall standing in shin-deep water.
    flooded: {
        height: 3.3,
        canal: 11,
        light: 0.42,
        lights: [[3, 3], [19, 3], [11, 11], [3, 19], [19, 19]],
        build(plan) {
            fill(plan, 1, 1, 22, 22, (index) => { plan.floor[index] = -0.3; });
            columns(plan, lattice([-10, -6, -2, 2, 6, 10]));
        },
    },
    // A lake of a pool with a tiled island and a lone pier at its centre.
    island: {
        height: 5.6,
        canal: 7,
        light: 1.1,
        shaft: { from: 8, to: 15, rise: 6 },
        lights: [SLOT_WEST, SLOT_NORTH, [19, 3], [19, 11], [3, 19], [11, 19], [19, 19], [8, 8, 2, 2, 2.4], [14, 8, 2, 2, 2.4], [8, 14, 2, 2, 2.4], [14, 14, 2, 2, 2.4]],
        build(plan) {
            basin(plan, 2, 2, 21, 21, [0.4, 0.8]);
            deck(plan, 8, 8, 15, 15);
            deck(plan, 11, 2, 12, 7);
            deck(plan, 11, 16, 12, 21);
            deck(plan, 2, 11, 7, 12);
            deck(plan, 16, 11, 21, 12);
            block(plan, 11, 11, 12, 12);
        },
    },
    // Four dry quarters cut apart by channels that meet in a deep centre pool.
    cross: {
        height: 4.2,
        canal: 11,
        light: 0.75,
        build(plan, roll) {
            fill(plan, 10, 1, 13, 22, (index) => { plan.floor[index] = CANAL_FLOOR; });
            fill(plan, 1, 10, 22, 13, (index) => { plan.floor[index] = CANAL_FLOOR; });
            basin(plan, 7, 7, 16, 16, [0.6, 0.9, 1.1]);
            if (roll < 0.5) {
                for (const [i, j] of [[4, 4], [17, 4], [4, 17], [17, 17]]) block(plan, i, j, i + 2, j + 2);
            } else {
                columns(plan, [[-7, -7], [7, -7], [-7, 7], [7, 7]]);
            }
        },
    },
    // Four massive tiled blocks with narrow passages between them.
    piers: {
        height: 3.4,
        canal: 9,
        light: 0.45,
        lights: [[11, 11], [11, 1], [11, 21], [1, 11], [21, 11]],
        build(plan, roll) {
            if (roll < 0.5) drums(plan, [[-5.5, -5.5, 2.7], [5.5, -5.5, 2.7], [-5.5, 5.5, 2.7], [5.5, 5.5, 2.7]]);
            else for (const [i, j] of [[4, 4], [15, 4], [4, 15], [15, 15]]) block(plan, i, j, i + 4, j + 4);
            basin(plan, 10, 10, 13, 13, [0.4, 0.8]);
        },
    },
    // A dry hall of columns around one small, deep plunge pool.
    plunge: {
        height: 5,
        canal: 7,
        light: 1,
        lights: [SLOT_WEST, SLOT_NORTH, [19, 3], [19, 11], [3, 19], [11, 19], [19, 19]],
        build(plan, roll) {
            basin(plan, 8, 8, 15, 15, [0.3, 0.6, 0.9]);
            columns(plan, [[-6, -6], [0, -6], [6, -6], [-6, 0], [6, 0], [-6, 6], [0, 6], [6, 6]]);
            if (roll < 0.6) coilSlide(plan, 0, 0, Math.floor(roll * 40) % 4);
        },
    },
    // Ankle-deep water around a spiral stair that climbs into a round shaft of light.
    spiral: {
        height: 4.4,
        canal: 5,
        light: 1,
        lights: [SLOT_WEST, SLOT_NORTH, [19, 3], [3, 19], [19, 19], [19, 11], [11, 19]],
        build(plan, roll) {
            fill(plan, 1, 1, 22, 22, (index) => { plan.floor[index] = -0.25; });
            spiralStair(plan, 0, 0, Math.floor(roll * 4));
        },
    },
    // Knee-deep water winding between great curved walls.
    bends: {
        height: 4.4,
        canal: 3,
        light: 0.7,
        lights: [[11, 11], [1, 11], [21, 11], [11, 1], [11, 21], [1, 1, 3, 3], [20, 20, 3, 3]],
        build(plan) {
            fill(plan, 1, 1, 22, 22, (index) => { plan.floor[index] = -0.35; });
            drums(plan, [[-5, -5, 4.2], [5, 5, 4.2], [7, -7, 2.4], [-7, 7, 2.4]]);
        },
    },
};

const ARCHETYPE_WEIGHTS = [['grand', 15], ['lanes', 13], ['flooded', 11], ['island', 11], ['cross', 10], ['piers', 10], ['plunge', 10], ['bends', 13], ['spiral', 9]];
const TOTAL_WEIGHT = ARCHETYPE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);

export function getArchetype(cx, cz) {
    if (cx === 0 && cz === 0) return 'arrival';
    let roll = poolNoise(cx, cz, 101) * TOTAL_WEIGHT;
    for (const [name, weight] of ARCHETYPE_WEIGHTS) {
        roll -= weight;
        if (roll < 0) return name;
    }
    return ARCHETYPE_WEIGHTS[0][0];
}

function buildRing(plan, canalReach) {
    fill(plan, 0, 0, LAST, LAST, (index, i, j) => {
        if (i === 0 || j === 0 || i === LAST || j === LAST) plan.solid[index] = 1;
    });

    for (const side of SIDES) {
        const edge = side.edge(plan.cx, plan.cz);
        for (const opening of edge.openings) openRing(plan, side, opening, canalReach);
    }
}

function openRing(plan, side, opening, canalReach) {
    for (let t = opening.from; t <= opening.to; t++) {
        const [i, j] = side.cell(t, 0);
        const index = cellIndex(i, j);
        plan.solid[index] = 0;
        plan.floor[index] = openingFloor(opening, t);
        plan.ceil[index] = opening.top;
        plan.arched[index] = opening.arch ? 1 : 0;

        // Nothing may stand in the two cells in front of an opening.
        for (let depth = 1; depth <= 2; depth++) {
            const [fi, fj] = side.cell(t, depth);
            plan.solid[cellIndex(fi, fj)] = 0;
            plan.clear[cellIndex(fi, fj)] = 1;
        }
    }

    if (opening.arch) {
        plan.arches.push({ side: side.name, from: opening.from, to: opening.to, top: opening.top });
    }
    if (opening.floor < 0) carveCanal(plan, side, opening, canalReach);
}

// A canal crossing the border runs on into the hall until it meets the hall's own water.
function carveCanal(plan, side, opening, reach) {
    for (let depth = 1; depth <= reach; depth++) {
        for (let t = opening.from + opening.ledge; t <= opening.to - opening.ledge; t++) {
            const [i, j] = side.cell(t, depth);
            const index = cellIndex(i, j);
            plan.solid[index] = 0;
            plan.clear[index] = 1;
            plan.floor[index] = Math.min(plan.floor[index], opening.floor);
        }
    }
}

function lineFits(plan, line) {
    for (let x = line.x - line.sx / 2 + 0.01; x < line.x + line.sx / 2; x += 0.5) {
        for (let z = line.z - line.sz / 2 + 0.01; z < line.z + line.sz / 2; z += 0.5) {
            if (plan.floor[cellIndex(Math.floor(x + HALF), Math.floor(z + HALF))] !== line.y) return false;
        }
    }
    return true;
}

function isColumnFree(plan, column) {
    const i = column.x + HALF;
    const j = column.z + HALF;
    for (const [ci, cj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
        const index = cellIndex(ci, cj);
        if (plan.solid[index] || plan.clear[index]) return false;
    }
    return true;
}

// Opens the light wells. A working well is a skylight: its recess has no
// ceiling, so sunlight falls through it. A well that has failed is closed and dark.
function addWells(plan, cells, light) {
    cells.forEach(([i, j, w = 2, h = 2, boost = 1], group) => {
        let open = true;
        fill(plan, i, j, i + w - 1, j + h - 1, (index) => { if (plan.solid[index]) open = false; });
        if (!open) return;
        const powered = isPoolFixturePowered(plan.cx, plan.cz, group);
        let top = 0;
        fill(plan, i, j, i + w - 1, j + h - 1, (index) => {
            plan.ceil[index] += RECESS;
            plan.skylight[index] = powered ? 1 : 0;
            top = Math.max(top, plan.ceil[index]);
        });
        const well = { x: i + w / 2 - HALF, z: j + h / 2 - HALF, y: top - 0.02, sx: w, sz: h, group, powered };
        plan.wells.push(well);

        // A long skylight lights the hall like a row of square ones.
        const count = Math.max(1, Math.round(Math.max(w, h) / 3.5));
        for (let step = 0; step < count; step++) {
            const along = (step + 0.5) / count - 0.5;
            plan.fixtures.push({
                x: well.x + (w > h ? along * w : 0),
                z: well.z + (h > w ? along * h : 0),
                y: well.y,
                light: light * boost * (count > 1 ? 0.62 : 1),
                group,
                powered,
            });
        }
    });
}

// The round hole over a spiral stair, its shaft, and the skylight that closes the shaft.
function openStairShaft(plan, light) {
    const stair = plan.stair;
    const i = stair.x + HALF;
    const j = stair.z + HALF;
    fill(plan, i - STAIR.block, j - STAIR.block, i + STAIR.block - 1, j + STAIR.block - 1, (index) => { plan.hole[index] = 1; });
    stair.powered = isPoolFixturePowered(plan.cx, plan.cz, STAIR_GROUP);
    const y = plan.height + STAIR.rise - 0.02;
    plan.wells.push({ x: stair.x, z: stair.z, y, sx: STAIR.hole * 2, sz: STAIR.hole * 2, group: STAIR_GROUP, powered: stair.powered });
    plan.fixtures.push({ x: stair.x, z: stair.z, y, light: light * 2.6, group: STAIR_GROUP, powered: stair.powered });
}

/**
 * Height of the spiral stair's step under a chunk-local point, or null away
 * from the stair. Less than a full turn, so every point has one step.
 */
export function stairHeightAt(plan, x, z) {
    const stair = plan.stair;
    const dx = x - stair.x;
    const dz = z - stair.z;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared > STAIR.radius ** 2 || distanceSquared < (STAIR.column - 0.1) ** 2) return null;
    const around = ((Math.atan2(dz, dx) - stair.start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (around >= STAIR.turn) return null;
    return stair.base + (Math.min(stair.steps - 1, Math.floor(around / stair.angle)) + 1) * STAIR.riser;
}

// The stair can only be climbed from its foot: a rail closes its outer edge
// from the third step up, and the far end of the landing.
function stairBlocks(stair, blocks) {
    const rim = STAIR.radius + 0.8;
    for (let step = 2; step <= stair.steps; step++) {
        const angle = stair.start + (step + 0.5) * stair.angle;
        blocks.push({ x: stair.x + Math.cos(angle) * rim, z: stair.z + Math.sin(angle) * rim, sx: 0.95, sz: 0.95 });
    }
    const end = stair.start + STAIR.turn + 0.2;
    for (const distance of [1.3, 2, 2.7]) {
        blocks.push({ x: stair.x + Math.cos(end) * distance, z: stair.z + Math.sin(end) * distance, sx: 0.7, sz: 0.7 });
    }
}

function hasOpeningNear(edge, low) {
    return edge.openings.some((opening) => (low ? opening.from <= FILLET_RADIUS : opening.to >= LAST - FILLET_RADIUS));
}

// Hall corners are rounded off wherever no opening comes close to them.
function addFillets(plan) {
    const edges = Object.fromEntries(SIDES.map((side) => [side.name, side.edge(plan.cx, plan.cz)]));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const acrossX = sx < 0 ? edges.west : edges.east;
        const acrossZ = sz < 0 ? edges.north : edges.south;
        // The west/east walls run north→south, the north/south walls west→east.
        if (hasOpeningNear(acrossX, sz < 0) || hasOpeningNear(acrossZ, sx < 0)) continue;
        if (!filletZoneIsOpen(plan, sx, sz)) continue;
        plan.fillets.push({ sx, sz, radius: FILLET_RADIUS });
    }
}

function filletCells(sx, sz) {
    const cells = [];
    for (let v = 1; v <= FILLET_RADIUS; v++) {
        for (let u = 1; u <= FILLET_RADIUS; u++) cells.push([sx < 0 ? u : LAST - u, sz < 0 ? v : LAST - v]);
    }
    return cells;
}

function filletZoneIsOpen(plan, sx, sz) {
    return filletCells(sx, sz).every(([i, j]) => !plan.solid[cellIndex(i, j)]);
}

/** True where a chunk-local point lies inside a drum or behind a rounded corner. */
export function isInsideCurve(plan, x, z) {
    if (plan.drums.some((drum) => Math.hypot(x - drum.x, z - drum.z) < drum.radius)) return true;
    if (plan.coil && Math.hypot(x - plan.coil.x, z - plan.coil.z) < COIL.reach) return true;
    const wall = HALF - 1;
    return plan.fillets.some((fillet) => {
        const cx = fillet.sx * (wall - fillet.radius);
        const cz = fillet.sz * (wall - fillet.radius);
        const beyond = (x - cx) * fillet.sx > 0 && (z - cz) * fillet.sz > 0;
        return beyond && Math.hypot(x - cx, z - cz) > fillet.radius;
    });
}

/**
 * Moves a chunk-local point that lies inside a drum or behind a rounded corner
 * to just in front of the curved surface (written into `out`). Floors and
 * ceilings run on underneath curved walls; their hidden vertices take their
 * light from here, so no dark fringe shows along the curve.
 */
export function nudgeOutOfCurve(plan, x, z, out) {
    out.x = x;
    out.z = z;
    for (const drum of plan.drums) {
        const distance = Math.hypot(x - drum.x, z - drum.z);
        if (distance >= drum.radius + 0.25) continue;
        const scale = (drum.radius + 0.25) / Math.max(distance, 0.001);
        out.x = drum.x + (distance < 0.001 ? drum.radius + 0.25 : (x - drum.x) * scale);
        out.z = drum.z + (z - drum.z) * scale;
        return out;
    }
    const wall = HALF - 1;
    for (const fillet of plan.fillets) {
        const cx = fillet.sx * (wall - fillet.radius);
        const cz = fillet.sz * (wall - fillet.radius);
        const distance = Math.hypot(x - cx, z - cz);
        if ((x - cx) * fillet.sx <= 0 || (z - cz) * fillet.sz <= 0 || distance <= fillet.radius - 0.25) continue;
        const scale = (fillet.radius - 0.25) / distance;
        out.x = cx + (x - cx) * scale;
        out.z = cz + (z - cz) * scale;
        return out;
    }
    return out;
}

// Nothing else is placed against or inside a curved wall.
function reserveCurves(plan) {
    for (const fillet of plan.fillets) {
        for (const [i, j] of filletCells(fillet.sx, fillet.sz)) plan.clear[cellIndex(i, j)] = 1;
    }
    fill(plan, 1, 1, LAST - 1, LAST - 1, (index, i, j) => {
        const x = i + 0.5 - HALF;
        const z = j + 0.5 - HALF;
        if (plan.drums.some((drum) => Math.hypot(x - drum.x, z - drum.z) < drum.radius + 0.9)) plan.clear[index] = 1;
        for (const [feature, reach] of [[plan.stair, STAIR.radius + 1.6], [plan.coil, COIL.reach + 3]]) {
            if (feature && Math.hypot(x - feature.x, z - feature.z) < reach) plan.clear[index] = 1;
        }
    });
}

// Slices a curved wall into thin boxes for collision and light occlusion.
function sliceCircle(x, z, radius, blocks) {
    const slices = Math.ceil(radius * 2 / 0.7);
    const depth = radius * 2 / slices;
    for (let slice = 0; slice < slices; slice++) {
        const offset = -radius + (slice + 0.5) * depth;
        const half = Math.sqrt(radius * radius - offset * offset);
        blocks.push({ x, z: z + offset, sx: half * 2, sz: depth });
    }
}

function sliceFillet(fillet, blocks, inset) {
    const wall = HALF - 1;
    const slices = Math.ceil(fillet.radius / 0.5);
    const depth = fillet.radius / slices;
    for (let slice = 0; slice < slices; slice++) {
        // `v` runs from the corner along one wall; the block reaches from the other wall to the arc.
        const v = (slice + 0.5) * depth;
        const reach = fillet.radius - Math.sqrt(fillet.radius ** 2 - (fillet.radius - v) ** 2) - inset;
        if (reach < 0.05) continue;
        blocks.push({ x: fillet.sx * (wall - reach / 2), z: fillet.sz * (wall - v), sx: reach, sz: depth });
    }
}

/**
 * Drums and rounded corners as chunk-local blocks { x, z, sx, sz }. `inset`
 * pulls the blocks back from the curved surface: light occluders must sit
 * behind the tiles they shade, or the slices show up as stripes.
 */
export function getCurveBlocks(plan, inset = 0) {
    const blocks = [];
    for (const drum of plan.drums) sliceCircle(drum.x, drum.z, drum.radius - inset, blocks);
    for (const fillet of plan.fillets) sliceFillet(fillet, blocks, inset);
    // The stair's rail and the coils of a slide stop the player, not the light.
    if (inset === 0 && plan.stair) stairBlocks(plan.stair, blocks);
    if (inset === 0 && plan.coil) sliceCircle(plan.coil.x, plan.coil.z, COIL.reach, blocks);
    return blocks;
}

function raiseShaft(plan, shaft) {
    fill(plan, shaft.from, shaft.from, shaft.to, shaft.to, (index) => { plan.ceil[index] += shaft.rise; });
}

function createPlan(cx, cz) {
    const name = getArchetype(cx, cz);
    const archetype = ARCHETYPES[name];
    const plan = {
        cx,
        cz,
        archetype: name,
        height: archetype.height,
        solid: new Uint8Array(CELLS),
        clear: new Uint8Array(CELLS),
        arched: new Uint8Array(CELLS),
        floor: new Float64Array(CELLS),
        ceil: new Float64Array(CELLS).fill(archetype.height),
        skylight: new Uint8Array(CELLS),
        hole: new Uint8Array(CELLS),
        stair: null,
        coil: null,
        columns: [],
        drums: [],
        fillets: [],
        wells: [],
        fixtures: [],
        arches: [],
        lines: [],
        slide: null,
    };

    archetype.build(plan, poolNoise(cx, cz, 211));
    buildRing(plan, archetype.canal);
    addFillets(plan);
    reserveCurves(plan);
    plan.columns = plan.columns.filter((column) => isColumnFree(plan, column));
    // A canal cutting through a lap pool takes its lane line with it.
    plan.lines = plan.lines.filter((line) => lineFits(plan, line));
    if (archetype.shaft) raiseShaft(plan, archetype.shaft);
    addWells(plan, archetype.lights ?? DEFAULT_LIGHTS, archetype.light);
    if (plan.stair) openStairShaft(plan, archetype.light);
    plan.slide = findSlide(plan);
    if (plan.slide) reserveSlide(plan, plan.slide);
    plan.power = plan.wells.length > 0 ? plan.wells.filter((well) => well.powered).length / plan.wells.length : 0;
    return plan;
}

const planCache = new Map();
let lastPlan = null;

export function getChunkPlan(cx, cz) {
    if (lastPlan && lastPlan.cx === cx && lastPlan.cz === cz) return lastPlan;
    const key = `${cx},${cz}`;
    let plan = planCache.get(key);
    if (!plan) {
        if (planCache.size >= PLAN_CACHE_LIMIT) planCache.clear();
        plan = createPlan(cx, cz);
        planCache.set(key, plan);
    }
    lastPlan = plan;
    return plan;
}

export function isOpenCell(plan, i, j) {
    return i >= 0 && j >= 0 && i < GRID && j < GRID && plan.solid[cellIndex(i, j)] === 0;
}

export function isWaterCell(plan, i, j) {
    return isOpenCell(plan, i, j) && plan.floor[cellIndex(i, j)] < WATER_LEVEL;
}

/** Share of the light wells that still work in the hall around a world position (0…1). */
export function hallPowerAt(x, z) {
    const plan = getChunkPlan(Math.floor((x + HALF) / CHUNK_SIZE), Math.floor((z + HALF) / CHUNK_SIZE));
    return plan.power;
}

/** Floor height under a world position: 0 on the deck, negative in a pool. */
export function groundHeightAt(x, z) {
    const cx = Math.floor((x + HALF) / CHUNK_SIZE);
    const cz = Math.floor((z + HALF) / CHUNK_SIZE);
    const plan = getChunkPlan(cx, cz);
    const i = Math.min(LAST, Math.max(0, Math.floor(x - cx * CHUNK_SIZE + HALF)));
    const j = Math.min(LAST, Math.max(0, Math.floor(z - cz * CHUNK_SIZE + HALF)));
    const index = cellIndex(i, j);
    if (plan.solid[index]) return 0;
    if (plan.stair) {
        const step = stairHeightAt(plan, x - cx * CHUNK_SIZE, z - cz * CHUNK_SIZE);
        if (step !== null) return step;
    }
    return plan.floor[index];
}

// Merges cells that share a key into axis-aligned rectangles { i, j, w, h, key }.
export function greedyRects(keyAt) {
    const rects = [];
    const used = new Uint8Array(CELLS);
    for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
            const key = keyAt(i, j);
            if (used[cellIndex(i, j)] || key === null) continue;
            let w = 1;
            while (i + w < GRID && rowMatches(keyAt, used, i + w, j, 1, key)) w++;
            let h = 1;
            while (j + h < GRID && rowMatches(keyAt, used, i, j + h, w, key)) h++;
            claimCells(used, i, j, w, h);
            rects.push({ i, j, w, h, key });
        }
    }
    return rects;
}

function claimCells(used, i, j, w, h) {
    for (let dj = 0; dj < h; dj++) {
        for (let di = 0; di < w; di++) used[cellIndex(i + di, j + dj)] = 1;
    }
}

function rowMatches(keyAt, used, i, j, w, key) {
    for (let di = 0; di < w; di++) {
        if (used[cellIndex(i + di, j)] || keyAt(i + di, j) !== key) return false;
    }
    return true;
}

/** Solid tile as chunk-local blocks { x, z, sx, sz } (centre and size in metres). */
export function getSolidBlocks(plan) {
    return greedyRects((i, j) => (plan.solid[cellIndex(i, j)] ? 1 : null))
        .map((rect) => ({ x: rect.i + rect.w / 2 - HALF, z: rect.j + rect.h / 2 - HALF, sx: rect.w, sz: rect.h }));
}

/** Everything that stops the player: solid tile, drums, rounded corners. */
export function getCollisionBlocks(plan) {
    return [...getSolidBlocks(plan), ...getCurveBlocks(plan)];
}

/** Everything that stops the baked light. */
export function getLightBlocks(plan) {
    return [...getSolidBlocks(plan), ...getCurveBlocks(plan, 0.35)];
}

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function hasColumnNear(plan, x, z, distance) {
    return plan.columns.some((column) => Math.hypot(column.x - x, column.z - z) < distance);
}

/**
 * Wall faces that can carry a phone: a tall wall behind, shallow or dry
 * footing, and three clear metres in front. Each spot is the point on the wall
 * face { x, z } with the normal { nx, nz } pointing into the hall.
 */
export function getPhoneSpots(plan) {
    const spots = [];
    for (let j = 1; j < LAST; j++) {
        for (let i = 1; i < LAST; i++) {
            for (const [dx, dz] of DIRECTIONS) {
                const spot = phoneSpotAt(plan, i, j, dx, dz);
                if (spot) spots.push(spot);
            }
        }
    }
    return spots;
}

function phoneSpotAt(plan, i, j, dx, dz) {
    if (isOpenCell(plan, i + dx, j + dz)) return null;
    const floor = plan.floor[cellIndex(i, j)];
    for (let step = 0; step <= 2; step++) {
        const ci = i - dx * step;
        const cj = j - dz * step;
        if (ci < 1 || cj < 1 || ci >= LAST || cj >= LAST || !isOpenCell(plan, ci, cj)) return null;
        const index = cellIndex(ci, cj);
        if (plan.clear[index] || plan.floor[index] < -0.35 || Math.abs(plan.floor[index] - floor) > 0.35) return null;
    }
    const x = i + 0.5 - HALF + dx * 0.5;
    const z = j + 0.5 - HALF + dz * 0.5;
    if (hasColumnNear(plan, x - dx * 1.5, z - dz * 1.5, 2.2)) return null;
    return { x, z, nx: -dx, nz: -dz, floor };
}

function isDryDeck(plan, i, j) {
    return i >= 1 && j >= 1 && i < LAST && j < LAST && isOpenCell(plan, i, j)
        && plan.floor[cellIndex(i, j)] === 0 && !plan.clear[cellIndex(i, j)];
}

function tooClose(spots, spot, distance) {
    return spots.some((other) => Math.hypot(other.x - spot.x, other.z - spot.z) < distance);
}

/**
 * Pool edges that get a steel ladder: dry deck beside water that drops
 * straight down by at least half a metre. Each spot is the midpoint of the
 * edge { x, z }, the direction { dx, dz } towards the water, and the depth there.
 */
export function getLadderSpots(plan) {
    const spots = [];
    for (let j = 1; j < LAST; j++) {
        for (let i = 1; i < LAST; i++) {
            if (!isDryDeck(plan, i, j) || poolNoise(plan.cx * GRID + i, plan.cz * GRID + j, 503) > 0.08) continue;
            for (const [dx, dz] of DIRECTIONS) {
                const depth = -plan.floor[cellIndex(i + dx, j + dz)];
                if (!isOpenCell(plan, i + dx, j + dz) || depth < 0.45) continue;
                const spot = { x: i + 0.5 - HALF + dx * 0.5, z: j + 0.5 - HALF + dz * 0.5, dx, dz, depth };
                if (!tooClose(spots, spot, 7) && !hasColumnNear(plan, spot.x, spot.z, 1.2)) spots.push(spot);
            }
        }
    }
    return spots;
}

/**
 * Walls that carry an enamel sign: dry deck in front, tile behind. Same shape
 * as a phone spot, plus `text`, an index into the level's sign texts.
 */
export function getSignSpots(plan, textCount) {
    const spots = [];
    for (let j = 1; j < LAST; j++) {
        for (let i = 1; i < LAST; i++) {
            if (!isDryDeck(plan, i, j)) continue;
            for (const [dx, dz] of DIRECTIONS) {
                const roll = poolNoise(plan.cx * GRID + i + dx * 7, plan.cz * GRID + j + dz * 13, 601);
                if (roll > 0.014 || isOpenCell(plan, i + dx, j + dz) || !isDryDeck(plan, i - dx, j - dz)) continue;
                const spot = { x: i + 0.5 - HALF + dx * 0.5, z: j + 0.5 - HALF + dz * 0.5, nx: -dx, nz: -dz, text: signText(roll / 0.014, textCount) };
                if (!tooClose(spots, spot, 6)) spots.push(spot);
            }
        }
    }
    return spots;
}

// The first two thirds of the texts are ordinary pool rules; the rest are rare and wrong.
function signText(roll, textCount) {
    const ordinary = Math.ceil(textCount * 2 / 3);
    if (roll < 0.8) return Math.floor(roll / 0.8 * ordinary);
    return ordinary + Math.floor((roll - 0.8) / 0.2 * (textCount - ordinary));
}

export const SLIDE_RADIUS = 0.7;

// A slide needs four cells of solid wall behind it, dry deck under it, and water where it ends.
function slideAt(plan, side, t) {
    for (let offset = -1; offset <= 2; offset++) {
        const [i, j] = side.cell(t + offset, 0);
        if (!plan.solid[cellIndex(i, j)]) return null;
    }
    for (let depth = 1; depth <= 8; depth++) {
        const cells = [side.cell(t, depth), side.cell(t + 1, depth)];
        if (cells.every(([i, j]) => isWaterCell(plan, i, j))) return depth >= 3 ? { side: side.name, t, run: depth } : null;
        if (!cells.every(([i, j]) => isDryDeck(plan, i, j))) return null;
    }
    return null;
}

/**
 * At most one tube slide per hall: it leaves a solid wall high up and curves
 * down across the deck to end over the water. `t` and `t + 1` are the cells
 * it runs above, `run` the distance from the border to the pool edge, and
 * `top` the height of its centre where it leaves the wall.
 */
function findSlide(plan) {
    if (plan.height < 4.4 || poolNoise(plan.cx, plan.cz, 701) > 0.5) return null;
    const slides = [];
    for (const side of SIDES) {
        for (let t = 3; t <= GRID - 5; t++) {
            const slide = slideAt(plan, side, t);
            if (!slide) continue;
            const frame = side.cell(t + 1, slide.run / 2);
            if (!hasColumnNear(plan, frame[0] - HALF, frame[1] - HALF, slide.run / 2 + 1.5)) slides.push(slide);
        }
    }
    if (slides.length === 0) return null;
    const slide = slides[Math.floor(poolNoise(plan.cx, plan.cz, 709) * slides.length)];
    return { ...slide, top: Math.min(plan.height - 1.5, 3.7) };
}

// Nothing else is placed under a slide: no phone, sign, or ladder.
function reserveSlide(plan, slide) {
    const side = SIDES.find((candidate) => candidate.name === slide.side);
    for (let depth = 1; depth <= slide.run; depth++) {
        for (let offset = -1; offset <= 2; offset++) {
            const [i, j] = side.cell(slide.t + offset, depth);
            plan.clear[cellIndex(i, j)] = 1;
        }
    }
}

export function getSlide(plan) {
    return plan.slide;
}

/** Whether light well `index` of a hall still works; a long skylight counts as one well. */
export function isPoolFixturePowered(cx, cz, index) {
    // The arrival hall and the halls around it always have light.
    if (Math.abs(cx) <= 1 && Math.abs(cz) <= 1) return true;
    const circuitFailed = poolNoise(cx, cz, 307) < 0.11;
    return !circuitFailed && poolNoise(cx * 31 + index, cz * 17 - index, 401) > 0.04;
}
