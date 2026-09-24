import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createEntityModel, animateEntityModel, ENTITY_HEIGHT } from '../src/entity-model.js';
import { updateBacteriaEntity, resetBacteriaState, getBacteriaEntity, isBacteriaVisible } from '../src/entity.js';

async function loadModel() {
    const file = await readFile(new URL('../public/models/bacteria_-_kane_pixels_backrooms.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
    return gltf.scene;
}

function wall(min, max) {
    const mesh = new THREE.Object3D();
    mesh.userData.worldBox = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
    return mesh;
}

test('entity uses sanity, delays first sighting, pauses and clears on recovery', async () => {
    const source = await loadModel();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.y = 1.7;
    resetBacteriaState();
    const tick = (time, sanity, walls = []) => updateBacteriaEntity(source, camera, scene, walls, null, [], true, sanity, -1, time);
    tick(0, 100);
    tick(1000000, 100);
    expect(isBacteriaVisible()).toBe(false);
    tick(1000001, 50);
    tick(1008000, 50);
    expect(isBacteriaVisible()).toBe(false);
    tick(1008001, 50);
    expect(isBacteriaVisible()).toBe(true);
    const entity = getBacteriaEntity();
    expect(entity.userData.animation).toBe('idle');
    const start = entity.position.clone();
    for (let time = 1008101; time <= 1011001; time += 100) tick(time, 50);
    expect(entity.userData.animation).toBe('walk');
    expect(entity.position.distanceTo(start)).toBeGreaterThan(0.2);
    const frozen = Float32Array.from(entity.children[0].geometry.attributes.position.array);
    const position = entity.position.clone();
    tick(1011001, 50);
    expect(entity.position.equals(position)).toBe(true);
    expect(entity.children[0].geometry.attributes.position.array).toEqual(frozen);
    tick(1011101, 75);
    expect(isBacteriaVisible()).toBe(false);
    tick(1011201, 30);
    expect(isBacteriaVisible()).toBe(false);
    resetBacteriaState();
    tick(0, 30);
    tick(8000, 30);
    expect(isBacteriaVisible()).toBe(true);
});

test('entity fits below the ceiling and its collision radius encloses animated, rotated limbs', async () => {
    const model = await loadModel();
    model.scale.setScalar(0.12); // The loader's scale must not alter final size.
    const entity = createEntityModel(model);
    const box = new THREE.Box3().setFromObject(entity, true);
    expect(box.max.y - box.min.y).toBeCloseTo(ENTITY_HEIGHT, 3);
    const radius = entity.userData.halfWidth;
    const rest = entity.children.map(mesh => Float32Array.from(mesh.geometry.attributes.position.array));
    animateEntityModel(entity, 1, 0.1, 0);
    expect(entity.children[0].geometry.attributes.position.array).not.toEqual(rest[0]);
    for (let frame = 0; frame < 180; frame++) {
        animateEntityModel(entity, frame / 30, 1 / 30, 0.85);
        entity.rotation.y = frame / 13;
        box.setFromObject(entity, true);
        expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
        expect(box.max.y).toBeLessThan(2.4);
        expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z))).toBeLessThan(radius);
    }
    const legs = entity.children.find(mesh => mesh.name.startsWith('Legs'));
    expect(legs.geometry.attributes.position.array).not.toEqual(rest[entity.children.indexOf(legs)]);
});

test('entity stops before a limb hits a wall and throttles failed placements', async () => {
    const source = await loadModel();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.y = 1.7;
    resetBacteriaState();
    const tick = (time, walls = []) => updateBacteriaEntity(source, camera, scene, walls, null, [], true, 30, -1, time);
    tick(0);
    const obstruction = wall([-100, 0, -100], [100, 3, -1]);
    tick(8000, [obstruction]);
    expect(isBacteriaVisible()).toBe(false);
    tick(8001);
    expect(isBacteriaVisible()).toBe(false);
    tick(13000);
    expect(isBacteriaVisible()).toBe(true);
    const entity = getBacteriaEntity();
    entity.position.set(0, 0, -20);
    const obstacleZ = -20 + entity.userData.halfWidth + 0.31;
    const obstacle = wall([0.6, 0, obstacleZ], [0.9, 3, obstacleZ + 2]);
    for (let time = 13100; time <= 17500; time += 100) tick(time, [obstacle]);
    expect(isBacteriaVisible()).toBe(true);
    expect(entity.userData.animation).toBe('idle');
    expect(entity.position.z).toBeLessThanOrEqual(-19.99);
    tick(17600, [wall([-3, 0, -21], [3, 3, -19])]);
    expect(isBacteriaVisible()).toBe(false);
});

test('runtime passes displayed sanity regardless of phone progress or elapsed time', async ({ page }) => {
    await page.route('**/src/entity.js*', async route => {
        const response = await route.fetch();
        const source = await response.text();
        const body = source.replace(
            '    if (!bacteriaModel || !camera || !isStarted) return;',
            '    globalThis.entityInput = { sanity: playerSanity, debug: debugSanityOverride };\n    if (!bacteriaModel || !camera || !isStarted) return;',
        );
        await route.fulfill({ response, body });
    });
    await page.route('**/src/runtime.js*', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) + `
            globalThis.probeEntitySanity = (wander) => {
                playerSanity = 90;
                session.elapsed = 3600;
                session.calls.add('one');
                session.calls.add('two');
                settings.difficulty = wander ? 'explore' : 'survival';
                debugSanityOverride = wander ? 5 : -1;
                updateRuntimeSystems();
                return globalThis.entityInput;
            };
        ` });
    });
    await page.goto('/');
    await page.locator('[data-level-id="lobby"]').click();
    await page.locator('#launch-level').click();
    await expect(page.locator('#resume-game')).toBeVisible();
    expect(await page.evaluate(() => globalThis.probeEntitySanity(false))).toEqual({ sanity: 90, debug: -1 });
    expect(await page.evaluate(() => globalThis.probeEntitySanity(true))).toEqual({ sanity: 100, debug: -1 });
});
