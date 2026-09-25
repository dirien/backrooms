import { CHUNK_SIZE } from '../../constants.js';

/**
 * Level 5 layout rules, as plain chunk-local data (no Three.js), so tests and
 * lighting contexts can use them without building meshes.
 *
 * Every chunk row carries an unbroken east-west corridor through the chunk
 * centre. North-south corridors link neighbouring rows at least every third
 * chunk, so the hotel stays connected. Rows without a link may end in a short
 * dead-end alcove holding an elevator, a clock, or a console table.
 */

export const CORRIDOR_HALF_WIDTH = 1.5;
export const WALL_THICKNESS = 0.3;
export const WALL_HEIGHT = 3;
export const ALCOVE_DEPTH = 3.6;
export const BAY = 4;
export const DOOR_HALF_WIDTH = 0.62;
export const PANEL_HALF_WIDTH = 0.72;

const HALF_CHUNK = CHUNK_SIZE / 2;
const INNER = CORRIDOR_HALF_WIDTH;
const OUTER = CORRIDOR_HALF_WIDTH + WALL_THICKNESS;
const WALL_CENTER = CORRIDOR_HALF_WIDTH + WALL_THICKNESS / 2;
const ALCOVE_FEATURES = ['elevator', 'clock', 'console'];

export function hotelNoise(seed) {
    return Math.abs(Math.sin(seed) * 10000) % 1;
}

function rowPhase(cz) {
    return Math.floor(hotelNoise(cz * 811 + 17) * 3);
}

/** True when the corridor in chunk (cx, cz) continues south into (cx, cz + 1). */
export function hasSouthLink(cx, cz) {
    const guaranteed = ((cx - rowPhase(cz)) % 3 + 3) % 3 === 0;
    return guaranteed || hotelNoise(cx * 1291 + cz * 3907 + 5) < 0.3;
}

export function getChunkPlan(cx, cz) {
    const north = hasSouthLink(cx, cz - 1);
    const south = hasSouthLink(cx, cz);
    const roll = hotelNoise(cx * 523 + cz * 2069 + 31);
    let alcove = null;

    if (!north && !south && roll < 0.55) {
        alcove = roll < 0.275 ? 'north' : 'south';
    } else if (north !== south && roll < 0.4) {
        alcove = north ? 'south' : 'north';
    }

    return {
        north,
        south,
        alcove,
        alcoveFeature: ALCOVE_FEATURES[Math.floor(hotelNoise(cx * 97 + cz * 331 + 7) * ALCOVE_FEATURES.length)],
    };
}

function sideSign(side) {
    return side === 'north' ? -1 : 1;
}

function isSideOpen(plan, side) {
    return plan[side] || plan.alcove === side;
}

function span(from, to) {
    return { from: Math.min(from, to), to: Math.max(from, to) };
}

/** Axis-aligned wall blocks { x, z, sx, sz } in chunk-local space, WALL_HEIGHT tall. */
export function getWallBlocks(plan) {
    const blocks = [];
    const addX = (from, to, z) => blocks.push({ x: (from + to) / 2, z, sx: to - from, sz: WALL_THICKNESS });
    const addZ = (from, to, x) => {
        const range = span(from, to);
        blocks.push({ x, z: (range.from + range.to) / 2, sx: WALL_THICKNESS, sz: range.to - range.from });
    };

    for (const side of ['north', 'south']) {
        const sign = sideSign(side);
        if (isSideOpen(plan, side)) {
            addX(-HALF_CHUNK, -INNER, sign * WALL_CENTER);
            addX(INNER, HALF_CHUNK, sign * WALL_CENTER);
        } else {
            addX(-HALF_CHUNK, HALF_CHUNK, sign * WALL_CENTER);
        }

        if (plan[side]) {
            addZ(sign * OUTER, sign * HALF_CHUNK, -WALL_CENTER);
            addZ(sign * OUTER, sign * HALF_CHUNK, WALL_CENTER);
        } else if (plan.alcove === side) {
            addZ(sign * OUTER, sign * (INNER + ALCOVE_DEPTH), -WALL_CENTER);
            addZ(sign * OUTER, sign * (INNER + ALCOVE_DEPTH), WALL_CENTER);
            addX(-OUTER, OUTER, sign * (INNER + ALCOVE_DEPTH + WALL_THICKNESS / 2));
        }
    }

    return blocks;
}

/**
 * Corridor-facing wall faces. `axis` is the direction the face runs along,
 * `fixed` its plane coordinate, and (nx, nz) the normal pointing into the corridor.
 */
export function getWallRuns(plan) {
    const runs = [];
    const add = (axis, fixed, nx, nz, from, to, kind = 'corridor') => runs.push({ axis, fixed, nx, nz, ...span(from, to), kind });

    for (const side of ['north', 'south']) {
        const sign = sideSign(side);
        if (isSideOpen(plan, side)) {
            add('x', sign * INNER, 0, -sign, -HALF_CHUNK, -INNER);
            add('x', sign * INNER, 0, -sign, INNER, HALF_CHUNK);
        } else {
            add('x', sign * INNER, 0, -sign, -HALF_CHUNK, HALF_CHUNK);
        }

        // Side faces start at the corridor corner: the end of the east-west wall is part of them.
        if (plan[side]) {
            add('z', -INNER, 1, 0, sign * INNER, sign * HALF_CHUNK);
            add('z', INNER, -1, 0, sign * INNER, sign * HALF_CHUNK);
        } else if (plan.alcove === side) {
            add('z', -INNER, 1, 0, sign * INNER, sign * (INNER + ALCOVE_DEPTH), 'alcove');
            add('z', INNER, -1, 0, sign * INNER, sign * (INNER + ALCOVE_DEPTH), 'alcove');
            add('x', sign * (INNER + ALCOVE_DEPTH), 0, -sign, -INNER, INNER, 'alcove-end');
        }
    }

    return runs;
}

/**
 * Door and panel slots along a run. The rhythm is world-aligned (chunk origins
 * are multiples of BAY), so doors face each other and continue across chunks.
 */
export function getRunSlots(run) {
    const slots = [];
    if (run.kind === 'alcove-end') return slots;

    for (let u = -HALF_CHUNK + 1; u < HALF_CHUNK; u += 2) {
        const kind = (u + HALF_CHUNK) % BAY === 1 ? 'door' : 'panel';
        const half = kind === 'door' ? DOOR_HALF_WIDTH : PANEL_HALF_WIDTH;
        if (u - half < run.from + 0.05 || u + half > run.to - 0.05) continue;
        slots.push({ kind, u });
    }

    return slots;
}

/** Walkable floor rectangles { x, z, sx, sz } in chunk-local space. */
export function getFloorAreas(plan) {
    const areas = [{ x: 0, z: 0, sx: CHUNK_SIZE, sz: CORRIDOR_HALF_WIDTH * 2 }];

    for (const side of ['north', 'south']) {
        const sign = sideSign(side);
        let depth = 0;
        if (plan[side]) depth = HALF_CHUNK - INNER;
        else if (plan.alcove === side) depth = ALCOVE_DEPTH;
        if (depth > 0) areas.push({ x: 0, z: sign * (INNER + depth / 2), sx: CORRIDOR_HALF_WIDTH * 2, sz: depth });
    }

    return areas;
}

/** Ceiling fixture positions { x, z } in chunk-local space, one per bay. */
export function getFixtures(plan) {
    const fixtures = [-10, -6, -2, 2, 6, 10].map((x) => ({ x, z: 0 }));

    for (const side of ['north', 'south']) {
        const sign = sideSign(side);
        if (plan[side]) {
            fixtures.push({ x: 0, z: sign * 6 }, { x: 0, z: sign * 10 });
        } else if (plan.alcove === side) {
            fixtures.push({ x: 0, z: sign * (INNER + ALCOVE_DEPTH / 2) });
        }
    }

    return fixtures;
}

/** Ceiling cross-beam positions: { axis, at } where `axis` is the corridor direction. */
export function getBeams(plan) {
    const beams = [];
    const crossing = isSideOpen(plan, 'north') || isSideOpen(plan, 'south');

    for (let x = -HALF_CHUNK; x < HALF_CHUNK; x += BAY) {
        if (x === 0 && crossing) continue;
        beams.push({ axis: 'x', at: x });
    }

    for (const side of ['north', 'south']) {
        if (!plan[side]) continue;
        const beamPositions = side === 'north' ? [-12, -8, -4] : [4, 8];
        for (const z of beamPositions) beams.push({ axis: 'z', at: z });
    }

    return beams;
}

export function isHotelFixturePowered(cx, cz, x, z) {
    // The arrival corridor is always lit; elsewhere whole circuits and single lamps fail.
    if (cx === 0 && cz === 0) return true;
    const circuitFailed = hotelNoise(cx * 719 + cz * 1433 + 91) < 0.14;
    return !circuitFailed && hotelNoise((cx * CHUNK_SIZE + x) * 147 + (cz * CHUNK_SIZE + z) * 317 + 11) > 0.1;
}
