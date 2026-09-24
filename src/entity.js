import * as THREE from 'three';
import { ENTITY_DISAPPEAR_DISTANCE, DEBUG_SANITY_LEVELS } from './constants.js';
import { randomBetween } from './random.js';
import { hasLineOfSight, queryWallsNearBox } from './world.js';
import { createEntityModel, animateEntityModel } from './entity-model.js';

export const ENTITY_SANITY_THRESHOLD = 50;
const FIRST_ENCOUNTER_DELAY = 8000;
let bacteriaEntity = null;
let bacteriaVisible = false;
let eligible = false;
let nextSpawnTime = 0;
let spawnStartTime = 0;
let visibleDuration = 0;
let lastUpdateTime = 0;
const hiddenEntityPosition = new THREE.Vector3();
const entityBounds = new THREE.Box3();
const entityWorldPosition = new THREE.Vector3();
const entityQueryBounds = new THREE.Box3();
const entityQuerySize = new THREE.Vector3();
const nearbyEntityWalls = [];
const spawnDirection = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);

export function getBacteriaEntity() {
    return bacteriaEntity;
}

export function isBacteriaVisible() {
    return bacteriaVisible;
}

export function resetBacteriaState(materials = []) {
    hideBacteriaEntity(materials);
    eligible = false;
    nextSpawnTime = 0;
    spawnStartTime = 0;
    visibleDuration = 0;
    lastUpdateTime = 0;
}
// Check if entity bounding box at given position would collide with any walls
function entityCollidesWithWalls(x, z, entityHalfWidth, walls, wallSpatialIndex) {
    const padding = 0.3;
    const halfSize = entityHalfWidth + padding;
    const entityMinX = x - halfSize;
    const entityMaxX = x + halfSize;
    const entityMinZ = z - halfSize;
    const entityMaxZ = z + halfSize;
    const wallsToCheck = wallSpatialIndex
        ? queryWallsNearBox(
            wallSpatialIndex,
            entityQueryBounds.setFromCenterAndSize(
                entityWorldPosition.set(x, 1.5, z),
                entityQuerySize.set(halfSize * 2, 3, halfSize * 2),
            ),
            nearbyEntityWalls,
        )
        : walls;

    for (const wall of wallsToCheck) {
        const wallBounds = wall.userData.worldBox ?? entityBounds.setFromObject(wall);

        if (entityMaxX > wallBounds.min.x && entityMinX < wallBounds.max.x &&
            entityMaxZ > wallBounds.min.z && entityMinZ < wallBounds.max.z) {
            return true;
        }
    }

    return false;
}

function updateEnvironmentDarkness(entityPos, visible, radius, intensity, materials) {
    materials.forEach(mat => {
        if (mat && mat.userData.darknessUniforms) {
            mat.userData.darknessUniforms.entityWorldPos.value.copy(entityPos);
            mat.userData.darknessUniforms.entityVisible.value = visible ? 1.0 : 0.0;
            mat.userData.darknessUniforms.darknessRadius.value = radius;
            mat.userData.darknessUniforms.darknessIntensity.value = intensity;
        }
    });
}

function hideBacteriaEntity(materials) {
    if (bacteriaEntity) {
        bacteriaEntity.visible = false;
    }
    bacteriaVisible = false;

    updateEnvironmentDarkness(hiddenEntityPosition, false, 0, 0, materials);
}


function spawnBacteriaEntity(minDist, maxDist, bacteriaModel, camera, scene, walls, wallSpatialIndex) {
    if (!bacteriaEntity) bacteriaEntity = createEntityModel(bacteriaModel);
    if (bacteriaEntity.parent !== scene) scene.add(bacteriaEntity);
    const player = camera.position;
    for (let attempt = 0; attempt < 24; attempt++) {
        camera.getWorldDirection(spawnDirection);
        spawnDirection.y = 0;
        if (spawnDirection.lengthSq() < 0.001) return false;
        spawnDirection.normalize().applyAxisAngle(upAxis, randomBetween(-0.45, 0.45));
        const distance = randomBetween(minDist, maxDist);
        const x = player.x + spawnDirection.x * distance;
        const z = player.z + spawnDirection.z * distance;
        if (!hasLineOfSight(player.x, player.z, x, z, walls, wallSpatialIndex)) continue;
        if (entityCollidesWithWalls(x, z, bacteriaEntity.userData.halfWidth, walls, wallSpatialIndex)) continue;
        bacteriaEntity.position.set(x, 0, z);
        bacteriaEntity.rotation.set(0, Math.atan2(player.x - x, player.z - z), 0);
        bacteriaEntity.userData.walkBlend = 0;
        bacteriaEntity.userData.stride = 0;
        bacteriaEntity.visible = true;
        bacteriaVisible = true;
        return true;
    }
    return false;
}

function updateBacteriaMotion(currentTime, delta, sanityFactor, camera, walls, materials, wallSpatialIndex) {
    const player = camera.position;
    const entity = bacteriaEntity;
    const dx = player.x - entity.position.x;
    const dz = player.z - entity.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < ENTITY_DISAPPEAR_DISTANCE ||
        !hasLineOfSight(player.x, player.z, entity.position.x, entity.position.z, walls, wallSpatialIndex) ||
        entityCollidesWithWalls(entity.position.x, entity.position.z, entity.userData.halfWidth, walls, wallSpatialIndex)) {
        hideBacteriaEntity(materials);
        return;
    }

    // Watch first, then approach slowly. Clearance includes every animated pose
    // and rotation. Small bounded steps cannot tunnel through thin wall segments.
    let speed = currentTime - spawnStartTime > 1800 ? 0.35 + sanityFactor * 0.5 : 0;
    const step = Math.min(speed * delta, Math.max(0, distance - ENTITY_DISAPPEAR_DISTANCE - 0.1));
    const x = entity.position.x + dx / distance * step;
    const z = entity.position.z + dz / distance * step;
    if (step === 0 || entityCollidesWithWalls(x, z, entity.userData.halfWidth, walls, wallSpatialIndex)) {
        speed = 0;
    } else {
        entity.position.x = x;
        entity.position.z = z;
    }
    entity.rotation.set(0, Math.atan2(dx, dz), 0);
    animateEntityModel(entity, currentTime / 1000, delta, speed);
    entity.userData.distortionMaterial.uniforms.glitchIntensity.value = 0.3 + sanityFactor * 0.4;
    entityWorldPosition.set(entity.position.x, 1, entity.position.z);
    updateEnvironmentDarkness(entityWorldPosition, true, 4 + sanityFactor * 3, 0.5 + sanityFactor * 0.4, materials);
}

export function updateBacteriaEntity(bacteriaModel, camera, scene, walls, wallSpatialIndex, materials, isStarted, playerSanity, debugSanityOverride, currentTime = performance.now()) {
    if (!bacteriaModel || !camera || !isStarted) return;
    const sanity = debugSanityOverride >= 0 ? DEBUG_SANITY_LEVELS[debugSanityOverride] : playerSanity;
    const delta = THREE.MathUtils.clamp((currentTime - lastUpdateTime) / 1000, 0, 0.1);
    lastUpdateTime = currentTime;
    if (sanity > ENTITY_SANITY_THRESHOLD) {
        if (bacteriaVisible) hideBacteriaEntity(materials);
        eligible = false;
        return;
    }
    if (!eligible) {
        eligible = true;
        nextSpawnTime = currentTime + FIRST_ENCOUNTER_DELAY;
    }
    const sanityFactor = THREE.MathUtils.clamp(1 - sanity / ENTITY_SANITY_THRESHOLD, 0, 1);
    if (bacteriaVisible) {
        if (currentTime - spawnStartTime >= visibleDuration) hideBacteriaEntity(materials);
        else updateBacteriaMotion(currentTime, delta, sanityFactor, camera, walls, materials, wallSpatialIndex);
        if (!bacteriaVisible) nextSpawnTime = currentTime + randomBetween(10000, 18000) * (1 - sanityFactor * 0.55);
        return;
    }
    if (currentTime < nextSpawnTime) return;
    // Failed placements also get a cooldown, rather than retrying every frame.
    nextSpawnTime = currentTime + randomBetween(3000, 5000);
    const minDist = ENTITY_DISAPPEAR_DISTANCE + 3 + (1 - sanityFactor) * 4;
    if (spawnBacteriaEntity(minDist, minDist + 10, bacteriaModel, camera, scene, walls, wallSpatialIndex)) {
        spawnStartTime = currentTime;
        visibleDuration = randomBetween(6000, 9000) + sanityFactor * 3000;
        updateBacteriaMotion(currentTime, 0, sanityFactor, camera, walls, materials, wallSpatialIndex);
    }
}
