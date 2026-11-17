import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { sampleFixtureIrradiance } from '../src/lighting.js';
import {
    COIL,
    GRID,
    SIDES,
    STAIR,
    WATER_LEVEL,
    cellIndex,
    getArchetype,
    getChunkPlan,
    getCollisionBlocks,
    getEdge,
    getLadderSpots,
    getPhoneSpots,
    getSignSpots,
    getSlide,
    groundHeightAt,
    isInsideCurve,
    isOpenCell,
    isPoolFixturePowered,
} from '../src/levels/pools/layout.js';
import { createPoolLightingContext } from '../src/levels/pools/chunk.js';

const PLAYER_RADIUS = 0.5;
const EYE_HEIGHT = 1.7;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Checks collect problems and assert once per test: a failure names every offending hall.
function forEachHall(range, visit) {
    for (let cx = -range; cx <= range; cx++) {
        for (let cz = -range; cz <= range; cz++) visit(cx, cz, getChunkPlan(cx, cz));
    }
}

// A cell can be walked through if it is open and its centre is not inside a drum or behind a rounded corner.
function isWalkable(plan, i, j) {
    return isOpenCell(plan, i, j) && !isInsideCurve(plan, i + 0.5 - 12, j + 0.5 - 12);
}

function openCells(plan) {
    const cells = [];
    for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
            if (isWalkable(plan, i, j)) cells.push([i, j]);
        }
    }
    return cells;
}

function reachableCount(plan, start) {
    const visited = new Set([cellIndex(...start)]);
    const pending = [start];
    while (pending.length > 0) {
        const [i, j] = pending.pop();
        for (const [di, dj] of STEPS) {
            const index = cellIndex(i + di, j + dj);
            if (!isWalkable(plan, i + di, j + dj) || visited.has(index)) continue;
            visited.add(index);
            pending.push([i + di, j + dj]);
        }
    }
    return visited.size;
}

// The south ring of a hall and the north ring of the next are two halves of one wall.
function borderMismatches(plan, other, mine, theirs) {
    let mismatches = 0;
    for (let t = 0; t < GRID; t++) {
        const a = mine(t);
        const b = theirs(t);
        const same = plan.solid[a] === other.solid[b] && (plan.solid[a] === 1 || (plan.floor[a] === other.floor[b] && plan.ceil[a] === other.ceil[b]));
        if (!same) mismatches++;
    }
    return mismatches;
}

test('every wall between pool halls has an opening and both halls agree on it', () => {
    const types = new Set();
    const problems = [];
    forEachHall(8, (cx, cz, plan) => {
        for (const axis of ['x', 'z']) {
            const edge = getEdge(cx, cz, axis);
            types.add(edge.type);
            const valid = edge.openings.length > 0 && edge.openings.every((opening) => opening.from >= 1 && opening.to <= GRID - 2 && opening.from <= opening.to);
            if (!valid) problems.push(`edge ${cx},${cz},${axis}`);
        }
        const south = borderMismatches(plan, getChunkPlan(cx, cz + 1), (t) => cellIndex(t, GRID - 1), (t) => cellIndex(t, 0));
        const east = borderMismatches(plan, getChunkPlan(cx + 1, cz), (t) => cellIndex(GRID - 1, t), (t) => cellIndex(0, t));
        if (south + east > 0) problems.push(`border ${cx},${cz}`);
    });
    expect(problems).toEqual([]);
    expect([...types].sort()).toEqual(['arcade', 'canal', 'colonnade', 'door', 'gate', 'portal', 'twin']);
});

function blockedOpenings(cx, cz, plan) {
    let blocked = 0;
    for (const side of SIDES) {
        for (const opening of side.edge(cx, cz).openings) {
            for (let t = opening.from; t <= opening.to; t++) {
                // The opening and the two cells in front of it are clear.
                for (let depth = 0; depth <= 2; depth++) {
                    if (!isWalkable(plan, ...side.cell(t, depth))) blocked++;
                }
            }
        }
    }
    return blocked;
}

test('pool halls are deterministic, fully walkable, and never deep enough to submerge the player', () => {
    const archetypes = new Set();
    const problems = [];
    forEachHall(7, (cx, cz, plan) => {
        archetypes.add(plan.archetype);
        const cells = openCells(plan);
        if (plan.archetype !== getArchetype(cx, cz) || getChunkPlan(cx, cz) !== plan) problems.push(`unstable ${cx},${cz}`);
        if (reachableCount(plan, cells[0]) !== cells.length) problems.push(`disconnected ${cx},${cz}`);
        if (blockedOpenings(cx, cz, plan) > 0) problems.push(`blocked opening ${cx},${cz}`);
        const cramped = cells.some(([i, j]) => plan.ceil[cellIndex(i, j)] - plan.floor[cellIndex(i, j)] < 2.5);
        const submerged = cells.some(([i, j]) => EYE_HEIGHT + plan.floor[cellIndex(i, j)] <= WATER_LEVEL + 0.5);
        if (cramped || submerged) problems.push(`headroom ${cx},${cz}`);
        if (!plan.columns.every((column) => Number.isInteger(column.x) && Number.isInteger(column.z))) problems.push(`column ${cx},${cz}`);
    });
    expect(problems).toEqual([]);
    expect([...archetypes].sort()).toEqual(['arrival', 'bends', 'cross', 'flooded', 'grand', 'island', 'lanes', 'piers', 'plunge', 'spiral']);
});

test('the arrival hall is dry underfoot with a pool ahead, and the ground sampler follows the terraces', () => {
    expect(getArchetype(0, 0)).toBe('arrival');
    for (const [x, z] of [[0, 0], [-0.4, -0.4], [0.4, 0.4], [0.4, -0.4]]) expect(groundHeightAt(x, z)).toBe(0);
    expect(getEdge(0, -1, 'z').type).toBe('arcade');
    // Walking north from the spawn point steps down one terrace at a time.
    const depths = [-1.5, -2.5, -3.5, -4.5, -5.5].map((z) => groundHeightAt(0.5, z));
    expect(depths).toEqual([0, -0.2, -0.4, -0.6, -0.8]);
    expect(groundHeightAt(0.5, -5.5)).toBeLessThan(WATER_LEVEL);
    // Inside solid tile the sampler reports deck height.
    expect(groundHeightAt(-11.5, -11.5)).toBe(0);
});

test('canals keep their depth across chunk borders and run on into both halls', () => {
    const canals = [];
    forEachHall(6, (cx, cz) => {
        if (getEdge(cx, cz, 'x').type !== 'canal') return;
        const x = cx * 24 + 12;
        const z = cz * 24 + 0.5;
        canals.push([groundHeightAt(x - 0.5, z), groundHeightAt(x + 0.5, z), groundHeightAt(x - 2.5, z) < WATER_LEVEL, groundHeightAt(x + 2.5, z) < WATER_LEVEL]);
    });
    expect(canals.length).toBeGreaterThan(10);
    expect(canals.every((canal) => canal[0] === -0.6 && canal[1] === -0.6 && canal[2] && canal[3])).toBe(true);
});

function overlapsSolid(plan, blocks, x, z) {
    const hitsBlock = blocks.some((block) => Math.abs(x - block.x) < block.sx / 2 + PLAYER_RADIUS && Math.abs(z - block.z) < block.sz / 2 + PLAYER_RADIUS);
    const hitsColumn = plan.columns.some((column) => Math.abs(x - column.x) < column.radius + PLAYER_RADIUS && Math.abs(z - column.z) < column.radius + PLAYER_RADIUS);
    return hitsBlock || hitsColumn;
}

test('every pool hall can carry a phone on a wall with clear, shallow footing in front', () => {
    const problems = [];
    forEachHall(7, (cx, cz, plan) => {
        const blocks = getCollisionBlocks(plan);
        const spots = getPhoneSpots(plan);
        if (spots.length === 0) problems.push(`no spot ${cx},${cz}`);
        for (const spot of spots) {
            const onWall = Math.abs(spot.nx) + Math.abs(spot.nz) === 1 && !isOpenCell(plan, Math.floor(spot.x - spot.nx * 0.5 + 12), Math.floor(spot.z - spot.nz * 0.5 + 12));
            // 1.9 m in front of the phone there is room to stand, in shallow water at most.
            const clear = spot.floor >= -0.35 && !overlapsSolid(plan, blocks, spot.x + spot.nx * 1.88, spot.z + spot.nz * 1.88);
            if (!onWall || !clear) problems.push(`spot ${cx},${cz} ${spot.x},${spot.z}`);
        }
    });
    expect(problems).toEqual([]);
});

test('pool light agrees across chunk borders, walls stop it, and some halls have lost power', () => {
    const up = new THREE.Vector3(0, 1, 0);
    const sample = new THREE.Vector3();
    const light = (x, z, context) => sampleFixtureIrradiance(sample.set(x, 0, z), up, context);
    const problems = [];
    let litSamples = 0;
    let darkHalls = 0;
    forEachHall(3, (x, z, plan) => {
        const here = createPoolLightingContext(x, z);
        const east = createPoolLightingContext(x + 1, z);
        const south = createPoolLightingContext(x, z + 1);
        for (const offset of [-9.5, -6.5, -2.5, 0.5, 3.5, 7.5, 10.5]) {
            const border = light(x * 24 + 12, z * 24 + offset, here);
            if (border > 0.1) litSamples++;
            if (Math.abs(border - light(x * 24 + 12, z * 24 + offset, east)) > 1e-6) problems.push(`east border ${x},${z}`);
            if (Math.abs(light(x * 24 + offset, z * 24 + 12, here) - light(x * 24 + offset, z * 24 + 12, south)) > 1e-6) problems.push(`south border ${x},${z}`);
        }
        // The corner pier is solid from floor to ceiling: nothing lights its core.
        if (light(x * 24 - 11.5, z * 24 - 11.5, here) !== 0) problems.push(`lit pier ${x},${z}`);

        const powered = plan.wells.filter((well) => well.powered).length;
        if (powered === 0) darkHalls++;
        if (!plan.wells.every((well) => well.powered === isPoolFixturePowered(x, z, well.group))) problems.push(`power ${x},${z}`);
        if (Math.abs(x) <= 1 && Math.abs(z) <= 1 && powered !== plan.wells.length) problems.push(`arrival power ${x},${z}`);
        const centreLit = light(x * 24 + 0.5, z * 24 + 0.5, here) > 0.3;
        const centreOpen = !plan.solid[cellIndex(12, 12)] && !isInsideCurve(plan, 0.5, 0.5);
        if (powered === plan.wells.length && centreOpen && !centreLit) problems.push(`dim ${x},${z}`);
    });
    expect(problems).toEqual([]);
    expect(litSamples).toBeGreaterThan(30);
    expect(darkHalls).toBeGreaterThan(0);
});

test('ladders stand at sheer pool edges, signs hang on tile, and slides run from solid wall to water', () => {
    const problems = [];
    const counts = { ladders: 0, signs: 0, slides: 0, lines: 0 };
    const solidAt = (plan, x, z) => !isOpenCell(plan, Math.floor(x + 12), Math.floor(z + 12));
    forEachHall(8, (cx, cz, plan) => {
        const ground = (x, z) => groundHeightAt(cx * 24 + x, cz * 24 + z);
        for (const ladder of getLadderSpots(plan)) {
            counts.ladders++;
            // Half a metre back is dry deck; half a metre out the floor drops by the stated depth.
            const dry = ground(ladder.x - ladder.dx * 0.5, ladder.z - ladder.dz * 0.5) === 0;
            const sheer = ground(ladder.x + ladder.dx * 0.5, ladder.z + ladder.dz * 0.5) === -ladder.depth && ladder.depth >= 0.45;
            if (!dry || !sheer) problems.push(`ladder ${cx},${cz}`);
        }
        for (const sign of getSignSpots(plan, 16)) {
            counts.signs++;
            const valid = sign.text >= 0 && sign.text < 16 && solidAt(plan, sign.x - sign.nx * 0.5, sign.z - sign.nz * 0.5) && !solidAt(plan, sign.x + sign.nx * 0.5, sign.z + sign.nz * 0.5);
            if (!valid) problems.push(`sign ${cx},${cz}`);
        }
        counts.lines += plan.lines.length;
        if (!plan.lines.every((line) => ground(line.x, line.z) === line.y)) problems.push(`lane line ${cx},${cz}`);

        const slide = getSlide(plan);
        if (!slide) return;
        counts.slides++;
        const side = SIDES.find((candidate) => candidate.name === slide.side);
        const cell = (depth) => side.cell(slide.t, depth);
        const walled = [-1, 0, 1, 2].every((offset) => plan.solid[cellIndex(...side.cell(slide.t + offset, 0))] === 1);
        const deck = [1, 2].every((depth) => plan.floor[cellIndex(...cell(depth))] === 0 && isOpenCell(plan, ...cell(depth)));
        const wet = plan.floor[cellIndex(...cell(slide.run))] < WATER_LEVEL;
        if (!walled || !deck || !wet || slide.run < 3 || slide.top > plan.height - 1.4) problems.push(`slide ${cx},${cz}`);
    });
    expect(problems).toEqual([]);
    for (const count of Object.values(counts)) expect(count).toBeGreaterThan(10);
});

// Drums are solid to their surface, never reach the walls, and (unless a slide coils around them) free just outside it.
function drumProblems(plan) {
    return plan.drums.filter((drum) => {
        const coiled = plan.coil && plan.coil.x === drum.x && plan.coil.z === drum.z;
        const solid = isInsideCurve(plan, drum.x, drum.z) && (coiled || !isInsideCurve(plan, drum.x + drum.radius + 0.1, drum.z));
        return !solid || Math.abs(drum.x) + drum.radius > 9.6 || Math.abs(drum.z) + drum.radius > 9.6;
    }).length;
}

// Along the diagonal, the tile surface of a rounded corner lies `radius` from the arc's centre.
function filletProblems(plan) {
    return plan.fillets.filter((fillet) => {
        const centre = 11 - fillet.radius;
        const behind = centre + (fillet.radius + 0.2) * Math.SQRT1_2;
        const before = centre + (fillet.radius - 0.2) * Math.SQRT1_2;
        return !isInsideCurve(plan, fillet.sx * behind, fillet.sz * behind) || isInsideCurve(plan, fillet.sx * before, fillet.sz * before);
    }).length;
}

// A well is open to the sun exactly when it works. Columns that rise into a
// light shaft stand under its skylight; no other curved wall does.
function wellProblems(plan) {
    const risers = plan.drums.filter((drum) => drum.tall || drum.top);
    return plan.wells.filter((well) => {
        const index = cellIndex(Math.floor(well.x + 12), Math.floor(well.z + 12));
        const open = plan.hole[index] ? plan.stair.powered : Boolean(plan.skylight[index]);
        const aboveRiser = risers.some((drum) => drum.x === well.x && drum.z === well.z);
        return open !== well.powered || (isInsideCurve(plan, well.x, well.z) && !aboveRiser);
    }).length;
}

test('curved walls leave every opening clear, and only working light wells are open to the sun', () => {
    const problems = [];
    const counts = { drums: 0, fillets: 0, skylights: 0, closed: 0 };
    forEachHall(8, (cx, cz, plan) => {
        counts.drums += plan.drums.length;
        counts.fillets += plan.fillets.length;
        counts.skylights += plan.wells.filter((well) => well.powered).length;
        counts.closed += plan.wells.filter((well) => !well.powered).length;
        const outside = getCollisionBlocks(plan).some((block) => Math.abs(block.x) > 12 || Math.abs(block.z) > 12);
        const failures = drumProblems(plan) + filletProblems(plan) + wellProblems(plan);
        if (outside || failures > 0 || plan.fixtures.length < plan.wells.length) problems.push(`${plan.archetype} ${cx},${cz}`);
    });
    expect(problems).toEqual([]);
    for (const count of Object.values(counts)) expect(count).toBeGreaterThan(20);
});

function blockAt(blocks, x, z) {
    return blocks.some((block) => Math.abs(x - block.x) < block.sx / 2 && Math.abs(z - block.z) < block.sz / 2);
}

test('a spiral stair climbs step by step from its foot into the ceiling shaft, railed on its outer edge', () => {
    const problems = [];
    let stairs = 0;
    forEachHall(8, (cx, cz, plan) => {
        const stair = plan.stair;
        if (!stair) return;
        stairs++;
        const blocks = getCollisionBlocks(plan);
        const point = (angle, distance) => [stair.x + Math.cos(stair.start + angle) * distance, stair.z + Math.sin(stair.start + angle) * distance];
        const ground = (angle, distance) => groundHeightAt(cx * 24 + point(angle, distance)[0], cz * 24 + point(angle, distance)[1]);
        const middle = (STAIR.column + STAIR.radius) / 2;
        // Every step is one riser above the last; the landing ends well above head height.
        const heights = Array.from({ length: stair.steps }, (_, step) => ground((step + 0.5) * stair.angle, middle));
        const rises = heights.every((height, step) => Math.abs(height - (stair.base + (step + 1) * STAIR.riser)) < 1e-9);
        const landing = ground((stair.steps + 0.5) * stair.angle, middle);
        if (!rises || landing !== heights.at(-1) || landing + 1.7 < plan.height + 0.5 || landing + 1.7 > plan.height + STAIR.rise - 0.5) problems.push(`steps ${cx},${cz}`);
        // Past the landing and outside the stair the floor is the hall's own.
        if (ground(STAIR.turn + 0.4, middle) !== stair.base || ground(1, STAIR.radius + 0.3) !== stair.base) problems.push(`floor ${cx},${cz}`);
        // The foot is open; from the third step up the outer edge and the end of the landing are closed.
        const rim = STAIR.radius + 0.6;
        if (blockAt(blocks, ...point(0.5 * stair.angle, rim)) || blockAt(blocks, ...point(-0.3, middle))) problems.push(`foot ${cx},${cz}`);
        for (let step = 2; step <= stair.steps; step++) {
            if (!blockAt(blocks, ...point((step + 0.5) * stair.angle, rim))) problems.push(`rail ${cx},${cz},${step}`);
        }
        if (!blockAt(blocks, ...point(STAIR.turn + 0.2, middle))) problems.push(`landing end ${cx},${cz}`);
        if (!isInsideCurve(plan, stair.x, stair.z) || isInsideCurve(plan, ...point(1, middle))) problems.push(`column ${cx},${cz}`);
    });
    expect(problems).toEqual([]);
    expect(stairs).toBeGreaterThan(10);
});

test('a coiled slide keeps the player outside its coils', () => {
    const problems = [];
    let coils = 0;
    forEachHall(8, (cx, cz, plan) => {
        if (!plan.coil) return;
        coils++;
        const blocks = getCollisionBlocks(plan);
        const inside = isInsideCurve(plan, plan.coil.x + COIL.reach - 0.2, plan.coil.z) && blockAt(blocks, plan.coil.x + COIL.reach - 0.4, plan.coil.z);
        const outside = !isInsideCurve(plan, plan.coil.x + COIL.reach + 0.2, plan.coil.z);
        const column = plan.drums.some((drum) => drum.x === plan.coil.x && drum.z === plan.coil.z && drum.radius === COIL.column);
        if (!inside || !outside || !column || plan.height < 4.5) problems.push(`coil ${cx},${cz}`);
    });
    expect(problems).toEqual([]);
    expect(coils).toBeGreaterThan(10);
});
