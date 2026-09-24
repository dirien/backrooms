import { test, expect } from '@playwright/test';
import { getPhoneChunkForSector, isPhoneChunk } from '../src/world-layout.js';
import * as THREE from 'three';
import { sampleFixtureIrradiance } from '../src/lighting.js';
import { generateWallGrid, createChunkLightingContext } from '../src/world.js';
import { createExpedition, connectPhone, advanceVitals, REQUIRED_CALLS } from '../src/expedition.js';

// Expose test controls only in intercepted source; the shipped game has no test API.
const testExports = `
import { getPhoneChunkForSector } from '/src/world-layout.js';
import { bakeFixtureLighting } from '/src/lighting.js';
globalThis.expeditionTest = {
    state: () => ({ started: isStarted, paused, sanity: playerSanity, calls: session.calls.size, distance: session.distance, stamina: session.stamina, battery: session.battery, elapsed: session.elapsed, phones: phonePositions.length, chunks: chunks.size, pitch: camera.rotation.x, yaw: camera.rotation.y, height: camera.position.y, gameOver: isSanityGameOver }),
    phone: (blocked = false) => {
        findNearestPhone();
        if (!nearestPhone) {
            for (let sector = -2; sector <= 2; sector++) {
                const chunk = getPhoneChunkForSector(sector, 0);
                camera.position.set(chunk.x * CHUNK_SIZE, 1.7, chunk.z * CHUNK_SIZE);
                refreshChunks(true);
                findNearestPhone();
                if (nearestPhone) break;
            }
        }
        const phone = nearestPhone;
        if (!phone) return false;
        for (const [x,z] of [[1.8,0],[-1.8,0],[0,1.8],[0,-1.8]]) {
            const clear = hasLineOfSight(phone.x + x, phone.z + z, phone.x, phone.z, walls, wallSpatialIndex);
            const candidate = new THREE.Vector3(phone.x + x, 1.7, phone.z + z);
            const bounds = new THREE.Box3().setFromCenterAndSize(candidate, new THREE.Vector3(PLAYER_RADIUS * 2, 1.8, PLAYER_RADIUS * 2));
            if (walls.some(wall => bounds.intersectsBox(wall.userData.worldBox))) continue;
            if (clear !== blocked) {
                camera.position.copy(candidate);
                velocity.set(0, 0, 0);
                callCooldown = 0;
                findNearestPhone();
                return true;
            }
        }
        return false;
    },
    lose: () => { playerSanity = 0.001; },
    lighting: (powered, torchOn) => {
        camera.position.set(0, 1.7, 0);
        camera.rotation.set(-0.65, 0, 0);
        refreshChunks(true);
        const chunk = chunks.get('0,0');
        const context = chunk.userData.fixtureLighting;
        const previousPower = context.lights.map(light => light.powered);
        for (const light of context.lights) light.powered = powered && light.position.x === 0 && light.position.z === 0;
        bakeFixtureLighting(chunk, context);
        flashlight.intensity = torchOn ? TORCH_INTENSITY : 0;
        const target = new THREE.WebGLRenderTarget(48, 48);
        const pixels = new Uint8Array(48 * 48 * 4);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, 48, 48, pixels);
        renderer.setRenderTarget(null);
        target.dispose();
        context.lights.forEach((light, index) => { light.powered = previousPower[index]; });
        bakeFixtureLighting(chunk, context);
        let luminance = 0;
        for (let index = 0; index < pixels.length; index += 4) luminance += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
        return luminance / (48 * 48);
    },
};`;

async function instrument(page) {
    await page.route('**/src/runtime.js*', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) + testExports });
    });
}
const state = (page) => page.evaluate(() => globalThis.expeditionTest.state());
const value = async (page, key) => { const snapshot = await state(page); return snapshot[key]; };
const phone = (page, blocked = false) => page.evaluate((blockedSide) => globalThis.expeditionTest.phone(blockedSide), blocked);
async function launch(page) {
    await page.locator('[data-level-id="lobby"]').click();
    await page.locator('#launch-level').click();
    await expect(page.locator('#resume-game')).toBeVisible();
    const spawn = await state(page);
    expect(spawn.height).toBe(1.7);
    expect(spawn.gameOver).toBe(false);
    expect(spawn.sanity).toBe(100);
    await page.locator('#resume-game').click();
    await expect(page.locator('#session-overlay')).toBeHidden();
    await expect(page.locator('#field-hud')).toBeVisible();
}

test('survival rules require three distinct lines and recover exhausted stamina', () => {
    const session = createExpedition();
    expect(connectPhone(session, { x: 12, z: 4 })).toBe(true);
    expect(connectPhone(session, { x: 12, z: 4 })).toBe(false);
    connectPhone(session, { x: 24, z: 4 });
    connectPhone(session, { x: 48, z: 4 });
    expect(session.calls.size).toBe(REQUIRED_CALLS);
    expect(connectPhone(session, { x: 60, z: 4 })).toBe(false);
    for (let index = 0; index < 100; index++) advanceVitals(session, 0.05, true, true);
    expect(session.exhausted).toBe(true);
    expect(advanceVitals(session, 0.05, true, true)).toBe(false);
    for (let index = 0; index < 50; index++) advanceVitals(session, 0.05, false, false);
    expect(session.exhausted).toBe(false);
    expect(advanceVitals(session, 0.05, true, true)).toBe(true);
});

test('desktop exploration, pause, blocked calls, escape, restart and loss', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await instrument(page);
    await page.goto('/?quality=low');
    await launch(page);
    await expect.poll(async () => await value(page, 'chunks')).toBeGreaterThan(0);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await expect.poll(async () => await value(page, 'distance'), { timeout: 15000 }).toBeGreaterThan(0.5);
    expect(await value(page, 'stamina')).toBeLessThan(100);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    expect(await value(page, 'height')).toBeGreaterThan(1.6);
    expect(await value(page, 'gameOver')).toBe(false);
    expect(await value(page, 'pitch')).toBe(0);
    expect(await value(page, 'yaw')).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('game.png') });
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('#session-overlay')).toBeVisible();
    const before = await state(page);
    await page.waitForTimeout(400);
    const after = await state(page);
    expect(after.elapsed).toBe(before.elapsed);
    expect(after.sanity).toBe(before.sanity);
    await page.locator('#resume-game').click();
    await expect(page.locator('#session-overlay')).toBeHidden();
    expect(await phone(page, true)).toBe(true);
    await page.keyboard.press('KeyE');
    expect(await value(page, 'calls')).toBe(0);
    for (let calls = 1; calls <= 3; calls++) {
        expect(await phone(page)).toBe(true);
        await page.keyboard.press('KeyE');
        await expect.poll(async () => await value(page, 'calls')).toBe(calls);
        if (calls === 1) {
            await page.keyboard.press('KeyE');
            expect(await value(page, 'calls')).toBe(1);
        }
    }
    await expect(page.locator('#session-title')).toHaveText('You made contact.', { timeout: 15000 });
    await page.locator('#leave-game').click();
    await launch(page);
    expect(await value(page, 'calls')).toBe(0);
    await page.evaluate(() => globalThis.expeditionTest.lose());
    await expect(page.locator('#session-title')).toHaveText('Lost to the rooms.', { timeout: 15000 });
    expect(errors).toEqual([]);
});

test('touch controls, torch, pause and Wander mode', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await instrument(page);
    await page.goto('/?quality=low');
    await page.locator('.menu-settings summary').tap();
    await page.locator('.menu-settings [data-setting="difficulty"]').selectOption('explore');
    await page.locator('[data-level-id="lobby"]').tap();
    await page.locator('#launch-level').tap();
    await expect(page.locator('#mobile-actions')).toBeVisible();
    await page.locator('#mobile-torch').tap();
    await expect(page.locator('#torch-state')).toHaveText('CHARGING');
    await page.locator('#mobile-pause').tap();
    await expect(page.locator('#session-overlay')).toBeVisible();
    expect(await value(page, 'sanity')).toBe(100);
    await page.locator('#resume-game').tap();
    await expect(page.locator('#session-overlay')).toBeHidden();
    await expect(page.locator('#touch-controls')).toHaveClass('active');
    await context.close();
});


test('procedural rooms remain connected and every chunk boundary has a passage', () => {
    for (let cx = -5; cx <= 5; cx++) {
        for (let cz = -5; cz <= 5; cz++) {
            const grid = generateWallGrid(cx, cz, 3);
            expect(generateWallGrid(cx, cz, 3)).toEqual(grid);
            const { horizontalWalls: h, verticalWalls: v } = grid;
            expect([h[0][1], h[3][1], v[0][1], v[3][1]]).toEqual([false, false, false, false]);
            const visited = new Set(['0,0']);
            const pending = [[0, 0]];
            while (pending.length > 0) {
                const [x, z] = pending.pop();
                for (const [nx, nz, blocked] of [[x + 1, z, v[x + 1][z]], [x - 1, z, v[x][z]], [x, z + 1, h[z + 1][x]], [x, z - 1, h[z][x]]]) {
                    if (nx < 0 || nz < 0 || nx >= 3 || nz >= 3 || blocked || visited.has(`${nx},${nz}`)) continue;
                    visited.add(`${nx},${nz}`);
                    pending.push([nx, nz]);
                }
            }
            expect(visited.size).toBe(9);
        }
    }
});


test('phone sectors are sparse, deterministic and separated by at least 120 metres', () => {
    const locations = [];
    let count = 0;
    for (let x = -30; x < 30; x++) {
        for (let z = -30; z < 30; z++) {
            if (isPhoneChunk(x, z)) { count++; locations.push({ x, z }); }
        }
    }
    expect(count).toBe(100); // 100 phones across 3,600 chunks, previously about 1,800.
    for (const a of locations) {
        const sector = getPhoneChunkForSector(Math.floor(a.x / 6), Math.floor(a.z / 6));
        expect(sector).toEqual(a);
        for (const b of locations) {
            if (a === b) continue;
            expect(Math.hypot(a.x - b.x, a.z - b.z) * 24).toBeGreaterThanOrEqual(120);
        }
    }
});

test('failed fixtures darken the rendered room and the torch visibly lights it', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await instrument(page);
    await page.goto('/?quality=low');
    await launch(page);
    const dark = await page.evaluate(() => globalThis.expeditionTest.lighting(false, false));
    const powered = await page.evaluate(() => globalThis.expeditionTest.lighting(true, false));
    const torch = await page.evaluate(() => globalThis.expeditionTest.lighting(false, true));
    expect(powered).toBeGreaterThan(dark * 3 + 2);
    expect(torch).toBeGreaterThan(dark * 3 + 2);
    expect(errors).toEqual([]);
});


test('neighbouring chunks agree on lighting before either chunk has loaded', () => {
    const normal = new THREE.Vector3(0, 1, 0);
    const sample = new THREE.Vector3();
    let litSamples = 0;
    for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
            const a = createChunkLightingContext(x, z);
            const b = createChunkLightingContext(x + 1, z);
            for (const offset of [-9, -5, -1, 3, 7, 11]) {
                sample.set(x * 24 + 12, 0, z * 24 + offset);
                const left = sampleFixtureIrradiance(sample, normal, a);
                const right = sampleFixtureIrradiance(sample, normal, b);
                expect(left).toBeCloseTo(right, 6);
                if (left > 0.1) litSamples++;
            }
        }
    }
    expect(litSamples).toBeGreaterThan(10);
});

test('walls block fixture light, doorways pass it, and distant visible surfaces stay lit', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?quality=low');
    const samples = await page.evaluate(async () => {
        const THREE = await import('/node_modules/three/build/three.module.js');
        const { bakeFixtureLighting, createFixtureBakeContext } = await import('/src/lighting.js');
        const scene = new THREE.Scene();
        const group = new THREE.Group();
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12, 24, 24), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 1 }));
        floor.rotation.x = -Math.PI / 2;
        group.add(floor);
        scene.add(group);
        const panel = { userData: { powered: true, worldPosition: new THREE.Vector3(2, 2.99, 0) } };
        const wall = (minZ, maxZ) => ({ userData: { worldBox: new THREE.Box3(new THREE.Vector3(-0.15, 0, minZ), new THREE.Vector3(0.15, 3, maxZ)) } });
        const camera = new THREE.OrthographicCamera(-0.8, 0.8, 0.8, -0.8, 0.1, 100);
        camera.up.set(0, 0, -1);
        const renderer = new THREE.WebGLRenderer();
        const target = new THREE.WebGLRenderTarget(32, 32);
        const pixels = new Uint8Array(32 * 32 * 4);
        renderer.setRenderTarget(target);
        function measure(walls, height) {
            bakeFixtureLighting(group, createFixtureBakeContext([panel], walls));
            camera.position.set(-2.5, height, 0);
            camera.lookAt(-2.5, 0, 0);
            renderer.render(scene, camera);
            renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
            let total = 0;
            for (let i = 0; i < pixels.length; i += 4) total += pixels[i] + pixels[i + 1] + pixels[i + 2];
            return total / (32 * 32 * 3);
        }
        const near = measure([], 6);
        const far = measure([], 46);
        const blocked = measure([wall(-4, 4)], 6);
        const doorway = measure([wall(-4, -0.7), wall(0.7, 4)], 6);
        const darkContext = createFixtureBakeContext([{ userData: { ...panel.userData, powered: false } }], []);
        bakeFixtureLighting(group, darkContext);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
        const poweredOff = pixels.every((value, index) => index % 4 === 3 || value === 0);
        floor.geometry.dispose();
        floor.material.dispose();
        target.dispose();
        renderer.dispose();
        return { near, far, blocked, doorway, poweredOff };
    });
    expect(samples.near).toBeGreaterThan(1);
    expect(samples.far).toBeCloseTo(samples.near, 1);
    expect(samples.blocked).toBeLessThan(samples.near * 0.05);
    expect(samples.doorway).toBeGreaterThan(samples.near * 0.6);
    expect(samples.poweredOff).toBe(true);
    expect(errors).toEqual([]);
});
