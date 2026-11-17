import * as THREE from 'three';
import { poolUniforms } from './shading.js';

/**
 * Low sunlight through the skylights. The level is static, so its shadows are
 * a depth image of the halls seen from the sun, re-rendered only when the
 * player has moved a few metres or new chunks may have streamed in. The tile
 * and water shaders compare against it to draw hard-edged patches of sun.
 */

// Unit vector from the ground towards the sun: 50° up, slanting in from the south-east.
export const SUN_DIRECTION = new THREE.Vector3(0.527, 0.766, 0.369).normalize();
// How far from the player sunlight is drawn; the shaders fade it out before this.
export const SUN_REACH = 28;

const HALF_SIZE = SUN_REACH + 6;
const SNAP = 4;
const DISTANCE = 90;
const REFRESH_SECONDS = 0.6;

const sunCamera = new THREE.OrthographicCamera(-HALF_SIZE, HALF_SIZE, HALF_SIZE, -HALF_SIZE, 1, DISTANCE * 2);
// Only surfaces facing away from the sun are drawn (ceilings, far walls, the far
// side of a drum). Sunlit surfaces are then never in their own shadow image, so
// the comparison needs almost no bias and no light leaks in under the ceilings.
const depthMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide, colorWrite: false });
const centre = new THREE.Vector3();
const textureBias = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
);
poolUniforms.poolSunDirection.value.copy(SUN_DIRECTION);
let target = null;
let lastX = Number.NaN;
let lastZ = Number.NaN;
let lastRender = -Infinity;

function ensureTarget(size) {
    if (target && target.width === size) return target;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(size, size, { depthTexture: new THREE.DepthTexture(size, size) });
    target.depthTexture.minFilter = THREE.NearestFilter;
    target.depthTexture.magFilter = THREE.NearestFilter;
    lastRender = -Infinity;
    return target;
}

export function disablePoolSun() {
    poolUniforms.poolSunOn.value = 0;
}

/**
 * Keeps the sun's depth image current. `hidden` lists materials that let the
 * sun through (the water surface and the bright panels that stand in for
 * sky); `revealed` lists materials drawn only here (the lids over the walls).
 */
export function renderPoolSun(renderer, scene, camera, hidden, revealed, size) {
    const x = Math.round(camera.position.x / SNAP) * SNAP;
    const z = Math.round(camera.position.z / SNAP) * SNAP;
    const now = performance.now() / 1000;
    const sunTarget = ensureTarget(size);
    poolUniforms.poolSunOn.value = 1;
    if (x === lastX && z === lastZ && now - lastRender < REFRESH_SECONDS) return;
    lastX = x;
    lastZ = z;
    lastRender = now;

    centre.set(x, 0, z);
    sunCamera.position.copy(centre).addScaledVector(SUN_DIRECTION, DISTANCE);
    sunCamera.lookAt(centre);
    sunCamera.updateMatrixWorld();
    poolUniforms.poolSunMatrix.value.copy(textureBias).multiply(sunCamera.projectionMatrix).multiply(sunCamera.matrixWorldInverse);
    poolUniforms.poolSunTexel.value = 1 / size;

    // The depth image must not be sampled while it is being drawn.
    poolUniforms.poolSunMap.value = null;
    const previousTarget = renderer.getRenderTarget();
    const previousOverride = scene.overrideMaterial;
    for (const material of hidden) material.visible = false;
    for (const material of revealed) material.visible = true;
    scene.overrideMaterial = depthMaterial;
    renderer.setRenderTarget(sunTarget);
    renderer.clear();
    renderer.render(scene, sunCamera);
    renderer.setRenderTarget(previousTarget);
    scene.overrideMaterial = previousOverride;
    for (const material of hidden) material.visible = true;
    for (const material of revealed) material.visible = false;
    poolUniforms.poolSunMap.value = sunTarget.depthTexture;
}
