import * as THREE from 'three';
import { ENTITY_DISAPPEAR_DISTANCE, DEBUG_SANITY_LEVELS } from './constants.js';
import { randomBetween, randomFloat } from './random.js';
import { ENTITY_DISTORTION_SHADER } from './shaders/entity.js';
import { hasLineOfSight, queryWallsNearBox } from './world.js';

/**
 * Bacteria entity system for horror appearances
 */

let bacteriaEntity = null;
let bacteriaVisible = false;
let bacteriaLastSpawnTime = 0;
let bacteriaNextSpawnDelay = 2000;
let bacteriaVisibleDuration = 0;
let bacteriaSpawnStartTime = 0;
let demoBacteriaEntity = null;
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

export function resetBacteriaState() {
    if (bacteriaEntity) {
        bacteriaEntity.visible = false;
    }
    bacteriaVisible = false;
    bacteriaLastSpawnTime = 0;
    bacteriaNextSpawnDelay = 2000;
    bacteriaVisibleDuration = 0;
    bacteriaSpawnStartTime = 0;
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

// Spawn the bacteria entity at a position the player can see
function spawnBacteriaEntity(minDist, maxDist, bacteriaModel, camera, scene, walls, wallSpatialIndex) {
    if (!bacteriaModel || !camera || !scene) return false;

    if (!bacteriaEntity) {
        bacteriaEntity = bacteriaModel.clone();

        const distortionMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.clone(ENTITY_DISTORTION_SHADER.uniforms),
            vertexShader: ENTITY_DISTORTION_SHADER.vertexShader,
            fragmentShader: ENTITY_DISTORTION_SHADER.fragmentShader,
            side: THREE.DoubleSide
        });

        bacteriaEntity.traverse((child) => {
            if (child.isMesh) {
                child.material = distortionMaterial;
            }
        });

        bacteriaEntity.userData.distortionMaterial = distortionMaterial;
        bacteriaEntity.scale.set(0.5, 0.5, 0.5);

        bacteriaEntity.updateMatrixWorld(true);
        const tempBox = new THREE.Box3().setFromObject(bacteriaEntity);
        bacteriaEntity.userData.floorOffset = -tempBox.min.y;

        const sizeX = (tempBox.max.x - tempBox.min.x) / 2;
        const sizeZ = (tempBox.max.z - tempBox.min.z) / 2;
        bacteriaEntity.userData.halfWidth = Math.max(sizeX, sizeZ);

        scene.add(bacteriaEntity);
    }

    const playerPos = camera.position;
    const playerX = playerPos.x;
    const playerZ = playerPos.z;

    const entityHalfWidth = bacteriaEntity.userData.halfWidth || 1;
    const maxAngleOffset = Math.PI * 0.3;

    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        spawnDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);
        spawnDirection.y = 0;
        spawnDirection.normalize();

        const angleOffset = randomBetween(-0.5, 0.5) * maxAngleOffset;
        spawnDirection.applyAxisAngle(upAxis, angleOffset);

        const distance = randomBetween(minDist, maxDist);

        const spawnX = playerX + spawnDirection.x * distance;
        const spawnZ = playerZ + spawnDirection.z * distance;

        if (!hasLineOfSight(playerX, playerZ, spawnX, spawnZ, walls, wallSpatialIndex)) {
            continue;
        }

        if (entityCollidesWithWalls(spawnX, spawnZ, entityHalfWidth, walls, wallSpatialIndex)) {
            continue;
        }

        bacteriaEntity.position.set(
            spawnX,
            bacteriaEntity.userData.floorOffset || 0,
            spawnZ
        );

        bacteriaEntity.scale.set(0.5, 0.5, 0.5);
        bacteriaEntity.visible = true;
        bacteriaVisible = true;

        return true;
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

function updateBacteriaDistortion(progress, sanityFactor, camera, walls, materials, wallSpatialIndex) {
    if (!bacteriaEntity || !bacteriaVisible || !camera) return;

    const playerX = camera.position.x;
    const playerZ = camera.position.z;
    const dx = playerX - bacteriaEntity.position.x;
    const dz = playerZ - bacteriaEntity.position.z;
    const distanceToPlayer = Math.hypot(dx, dz);

    if (distanceToPlayer < ENTITY_DISAPPEAR_DISTANCE) {
        hideBacteriaEntity(materials);
        return;
    }

    if (!hasLineOfSight(playerX, playerZ, bacteriaEntity.position.x, bacteriaEntity.position.z, walls, wallSpatialIndex)) {
        hideBacteriaEntity(materials);
        return;
    }

    const time = performance.now() / 1000;

    if (bacteriaEntity.userData.distortionMaterial) {
        bacteriaEntity.userData.distortionMaterial.uniforms.time.value = time;
        bacteriaEntity.userData.distortionMaterial.uniforms.glitchIntensity.value = 0.5 + sanityFactor * 0.5;
    }

    entityWorldPosition.set(
        bacteriaEntity.position.x,
        bacteriaEntity.position.y + 1,
        bacteriaEntity.position.z,
    );

    const darknessIntensity = 0.5 + sanityFactor * 0.4;
    const darknessRadius = 4.0 + sanityFactor * 3.0;

    updateEnvironmentDarkness(entityWorldPosition, true, darknessRadius, darknessIntensity, materials);

    bacteriaEntity.scale.set(0.5, 0.5, 0.5);

    const angle = Math.atan2(dx, dz);
    bacteriaEntity.rotation.set(0, angle, 0);

    const baseY = bacteriaEntity.userData.floorOffset || 0;
    const bobAmount = sanityFactor * 0.1;
    bacteriaEntity.position.y = baseY + Math.sin(time * 4) * bobAmount;
}

export function updateBacteriaEntity(bacteriaModel, camera, scene, walls, wallSpatialIndex, materials, isStarted, playerSanity, debugSanityOverride) {
    if (!bacteriaModel || !camera || !isStarted) return;

    const currentTime = performance.now();
    const effectiveSanity = debugSanityOverride >= 0 ? DEBUG_SANITY_LEVELS[debugSanityOverride] : playerSanity;

    if (effectiveSanity > 65) {
        if (bacteriaEntity && bacteriaVisible) {
            hideBacteriaEntity(materials);
        }
        return;
    }

    const sanityFactor = 1 - (effectiveSanity / 65);

    const minDelay = 500 + (1 - sanityFactor) * 2500;
    const maxDelay = 1500 + (1 - sanityFactor) * 4500;

    const minDuration = 500 + sanityFactor * 1000;
    const maxDuration = 1500 + sanityFactor * 1500;

    const minDist = ENTITY_DISAPPEAR_DISTANCE + 1 + (1 - sanityFactor) * 16;
    const maxDist = ENTITY_DISAPPEAR_DISTANCE + 7 + (1 - sanityFactor) * 25;

    if (bacteriaVisible) {
        const visibleTime = currentTime - bacteriaSpawnStartTime;
        if (visibleTime >= bacteriaVisibleDuration) {
            hideBacteriaEntity(materials);
            bacteriaNextSpawnDelay = randomBetween(minDelay, maxDelay);
            bacteriaLastSpawnTime = currentTime;
        } else {
            updateBacteriaDistortion(visibleTime / bacteriaVisibleDuration, sanityFactor, camera, walls, materials, wallSpatialIndex);
        }
    } else {
        if (currentTime - bacteriaLastSpawnTime >= bacteriaNextSpawnDelay) {
            const spawnChance = 0.6 + sanityFactor * 0.35;
            if (randomFloat() < spawnChance) {
                spawnBacteriaEntity(minDist, maxDist, bacteriaModel, camera, scene, walls, wallSpatialIndex);
                bacteriaVisibleDuration = randomBetween(minDuration, maxDuration);
                bacteriaSpawnStartTime = currentTime;
            } else {
                bacteriaLastSpawnTime = currentTime;
                bacteriaNextSpawnDelay = randomBetween(300, 1000);
            }
        }
    }
}

// Demo entity for testing
export function spawnDemoBacteriaEntity(bacteriaModel, scene, debugMode, debugNormals) {
    if (!bacteriaModel || !scene) {
        console.warn('Cannot spawn demo entity - bacteriaModel:', !!bacteriaModel, 'scene:', !!scene);
        return;
    }

    demoBacteriaEntity = bacteriaModel.clone();

    const distortionMaterial = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(ENTITY_DISTORTION_SHADER.uniforms),
        vertexShader: ENTITY_DISTORTION_SHADER.vertexShader,
        fragmentShader: ENTITY_DISTORTION_SHADER.fragmentShader,
        side: THREE.DoubleSide
    });

    demoBacteriaEntity.traverse((child) => {
        if (child.isMesh) {
            child.material = distortionMaterial;
        }
    });

    demoBacteriaEntity.userData.distortionMaterial = distortionMaterial;

    demoBacteriaEntity.position.set(-4, 0, 0);
    demoBacteriaEntity.scale.set(0.5, 0.5, 0.5);

    demoBacteriaEntity.updateMatrixWorld(true);

    const tempBox = new THREE.Box3().setFromObject(demoBacteriaEntity);
    const lowestY = tempBox.min.y;

    demoBacteriaEntity.position.y = -lowestY;
    demoBacteriaEntity.userData.baseY = -lowestY;
    scene.add(demoBacteriaEntity);

    const boxHelper = new THREE.BoxHelper(demoBacteriaEntity, 0x00ff00);
    boxHelper.name = 'demoBacteriaBoxHelper';
    boxHelper.visible = debugMode;
    scene.add(boxHelper);
    debugNormals.push(boxHelper);

    const axesHelper = new THREE.AxesHelper(1);
    axesHelper.visible = debugMode;
    demoBacteriaEntity.add(axesHelper);
    debugNormals.push(axesHelper);

}

export function updateDemoBacteriaEntity(camera, scene) {
    if (!demoBacteriaEntity || !camera) return;

    const playerX = camera.position.x;
    const playerZ = camera.position.z;

    const dx = playerX - demoBacteriaEntity.position.x;
    const dz = playerZ - demoBacteriaEntity.position.z;
    const angle = Math.atan2(dx, dz);

    demoBacteriaEntity.rotation.set(0, angle, 0);

    if (demoBacteriaEntity.userData.distortionMaterial) {
        demoBacteriaEntity.userData.distortionMaterial.uniforms.time.value = performance.now() / 1000;
    }

    const boxHelper = scene.getObjectByName('demoBacteriaBoxHelper');
    if (boxHelper) {
        boxHelper.update();
    }
}
