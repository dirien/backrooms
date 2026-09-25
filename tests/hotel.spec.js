import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { sampleFixtureIrradiance } from '../src/lighting.js';
import { DOOR_HALF_WIDTH, PANEL_HALF_WIDTH, getChunkPlan, getFloorAreas, getRunSlots, getWallBlocks, getWallRuns, hasSouthLink } from '../src/levels/hotel/layout.js';
import { createHotelLightingContext } from '../src/levels/hotel/chunk.js';
import { BACKROOM_LEVELS } from '../src/levels.js';

const PLAYER_RADIUS = 0.5;

function blockContains(block, x, z, margin) {
    return Math.abs(x - block.x) < block.sx / 2 + margin && Math.abs(z - block.z) < block.sz / 2 + margin;
}

test('playable levels declare a loader and every hotel corridor row is reachable', () => {
    for (const level of BACKROOM_LEVELS) {
        expect(typeof level.load === 'function').toBe(level.playable === true);
    }
    const range = 12;
    for (let cz = -range; cz < range; cz++) {
        for (let cx = -range; cx <= range - 2; cx++) {
            expect([0, 1, 2].some((offset) => hasSouthLink(cx + offset, cz))).toBe(true);
        }
    }
    const visited = new Set(['0,0']);
    const pending = [[0, 0]];
    while (pending.length > 0) {
        const [x, z] = pending.pop();
        const neighbours = [[x + 1, z, true], [x - 1, z, true], [x, z + 1, hasSouthLink(x, z)], [x, z - 1, hasSouthLink(x, z - 1)]];
        for (const [nx, nz, open] of neighbours) {
            if (!open || Math.abs(nx) > range || Math.abs(nz) > range || visited.has(`${nx},${nz}`)) continue;
            visited.add(`${nx},${nz}`);
            pending.push([nx, nz]);
        }
    }
    expect(visited.size).toBe((range * 2 + 1) ** 2);
});

function expectWalkable(areas, blocks) {
    for (const area of areas) {
        for (let fx = 0; fx <= 1; fx += 0.125) {
            for (let fz = 0; fz <= 1; fz += 0.25) {
                const x = area.x - area.sx / 2 + PLAYER_RADIUS + fx * (area.sx - PLAYER_RADIUS * 2);
                const z = area.z - area.sz / 2 + PLAYER_RADIUS + fz * (area.sz - PLAYER_RADIUS * 2);
                expect(blocks.some((block) => blockContains(block, x, z, 0))).toBe(false);
            }
        }
    }
}

function expectSlotsFit(runs) {
    for (const run of runs) {
        let previousEnd = run.from;
        for (const slot of getRunSlots(run)) {
            const half = slot.kind === 'door' ? DOOR_HALF_WIDTH : PANEL_HALF_WIDTH;
            expect(slot.u - half).toBeGreaterThanOrEqual(previousEnd);
            previousEnd = slot.u + half;
        }
        expect(previousEnd).toBeLessThanOrEqual(run.to);
    }
}

test('hotel walls leave every corridor walkable, openings agree across borders, and doors fit', () => {
    const features = new Set();
    for (let cx = -6; cx <= 6; cx++) {
        for (let cz = -6; cz <= 6; cz++) {
            const plan = getChunkPlan(cx, cz);
            expect(getChunkPlan(cx, cz)).toEqual(plan);
            expect(plan.south).toBe(getChunkPlan(cx, cz + 1).north);
            if (plan.alcove) {
                expect(plan[plan.alcove]).toBe(false);
                features.add(plan.alcoveFeature);
            }
            const areas = getFloorAreas(plan);
            expect(areas[0]).toMatchObject({ x: 0, z: 0, sx: 24 });
            expectWalkable(areas, getWallBlocks(plan));
            expectSlotsFit(getWallRuns(plan));
        }
    }
    expect([...features].sort()).toEqual(['clock', 'console', 'elevator']);
});

test('hotel fixture light agrees across chunk borders and walls stop it', () => {
    const up = new THREE.Vector3(0, 1, 0);
    const sample = new THREE.Vector3();
    let litSamples = 0;
    for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
            const here = createHotelLightingContext(x, z);
            const east = createHotelLightingContext(x + 1, z);
            const south = createHotelLightingContext(x, z + 1);
            for (const offset of [-1.2, 0, 1.2]) {
                sample.set(x * 24 + 12, 0, z * 24 + offset);
                const left = sampleFixtureIrradiance(sample, up, here);
                expect(left).toBeCloseTo(sampleFixtureIrradiance(sample, up, east), 6);
                if (left > 0.1) litSamples++;
                sample.set(x * 24 + offset, 0, z * 24 + 12);
                expect(sampleFixtureIrradiance(sample, up, here)).toBeCloseTo(sampleFixtureIrradiance(sample, up, south), 6);
            }
            // Behind the corridor walls lies solid hotel: no fixture reaches it.
            sample.set(x * 24 + 7, 0, z * 24 + 6);
            if (!getChunkPlan(x, z).south && getChunkPlan(x, z).alcove !== 'south') {
                expect(sampleFixtureIrradiance(sample, up, here)).toBe(0);
            }
        }
    }
    expect(litSamples).toBeGreaterThan(20);
});
