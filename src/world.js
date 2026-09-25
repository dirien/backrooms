import { bakeFixtureLighting } from './lighting.js';
import { createChunkState } from './chunk-kit.js';
import * as THREE from 'three';
import { CHUNK_SIZE, RENDER_DIST, PRELOAD_DIST } from './constants.js';

/**
 * Level-agnostic chunk streaming, resource disposal, wall spatial index, and
 * line of sight. The active level definition builds each chunk's contents.
 */

const frustum = new THREE.Frustum();
const frustumMatrix = new THREE.Matrix4();
const tempChunkBounds = new THREE.Box3();
const tempChunkMin = new THREE.Vector3();
const tempChunkMax = new THREE.Vector3();
const tempWallBounds = new THREE.Box3();
const tempLineWalls = [];

const WALL_HEIGHT = 3;
const SPATIAL_CELL_SIZE = CHUNK_SIZE / 3;
// Furniture below this height (consoles, luggage) blocks movement but not sight.
const SIGHT_LINE_HEIGHT = 1.2;

export function createChunkBorder(cx, cz, debugMode) {
    const group = new THREE.Group();
    const borderMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    const height = 3;
    const halfSize = CHUNK_SIZE / 2;
    const northGeometry = new THREE.PlaneGeometry(CHUNK_SIZE, height);
    const eastGeometry = new THREE.PlaneGeometry(CHUNK_SIZE, height);

    const north = new THREE.Mesh(northGeometry, borderMaterial);
    north.position.set(0, height / 2, halfSize);
    group.add(north);

    const south = new THREE.Mesh(northGeometry, borderMaterial);
    south.position.set(0, height / 2, -halfSize);
    south.rotation.y = Math.PI;
    group.add(south);

    const east = new THREE.Mesh(eastGeometry, borderMaterial);
    east.position.set(halfSize, height / 2, 0);
    east.rotation.y = -Math.PI / 2;
    group.add(east);

    const west = new THREE.Mesh(eastGeometry, borderMaterial);
    west.position.set(-halfSize, height / 2, 0);
    west.rotation.y = Math.PI / 2;
    group.add(west);

    for (const mesh of group.children) {
        mesh.userData.ownsGeometry = true;
        mesh.userData.ownsMaterial = true;
    }

    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    group.visible = debugMode;

    return group;
}

function attachChunkState(group, chunkState, border) {
    group.userData.border = border;
    group.userData.lightPanels = chunkState.lightPanels;
    group.userData.phoneMeshes = chunkState.phoneMeshes;
    group.userData.phonePositions = chunkState.phonePositions;
    group.userData.raycastTargets = chunkState.raycastTargets;
    group.userData.walls = chunkState.walls;
}

function mergeChunkCollections(chunkState, walls, lightPanels, phonePositions, phoneMeshes) {
    walls.push(...chunkState.walls);
    lightPanels.push(...chunkState.lightPanels);
    phonePositions.push(...chunkState.phonePositions);
    phoneMeshes.push(...chunkState.raycastTargets);
}

export function generateChunk(level, cx, cz, scene, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes, phoneSeed = 0) {
    const group = new THREE.Group();
    const chunkState = createChunkState();

    level.buildChunk({ cx, cz, group, state: chunkState, debugMode, debugNormals, phoneSeed });

    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    scene.add(group);
    group.userData.fixtureLighting = level.createLightingContext(cx, cz);
    bakeFixtureLighting(group, group.userData.fixtureLighting);

    const border = createChunkBorder(cx, cz, debugMode);
    scene.add(border);
    chunkBorders.push(border);

    attachChunkState(group, chunkState, border);
    mergeChunkCollections(chunkState, walls, lightPanels, phonePositions, phoneMeshes);

    return group;
}

function isChunkPotentiallyVisible(cx, cz) {
    const chunkCenterX = cx * CHUNK_SIZE;
    const chunkCenterZ = cz * CHUNK_SIZE;
    const halfSize = CHUNK_SIZE / 2;

    tempChunkMin.set(chunkCenterX - halfSize, 0, chunkCenterZ - halfSize);
    tempChunkMax.set(chunkCenterX + halfSize, 3, chunkCenterZ + halfSize);
    tempChunkBounds.min.copy(tempChunkMin);
    tempChunkBounds.max.copy(tempChunkMax);

    return frustum.intersectsBox(tempChunkBounds);
}

function isChunkNearby(cx, cz, playerChunkX, playerChunkZ, renderDist) {
    const dx = Math.abs(cx - playerChunkX);
    const dz = Math.abs(cz - playerChunkZ);
    return dx <= renderDist && dz <= renderDist;
}

function isChunkInPreloadRange(cx, cz, playerChunkX, playerChunkZ, preloadDist) {
    const dx = Math.abs(cx - playerChunkX);
    const dz = Math.abs(cz - playerChunkZ);
    return dx <= preloadDist && dz <= preloadDist;
}

function getActiveChunkKeys(playerChunkX, playerChunkZ, renderDist, preloadDist) {
    const activeKeys = new Set();

    for (let x = playerChunkX - preloadDist; x <= playerChunkX + preloadDist; x++) {
        for (let z = playerChunkZ - preloadDist; z <= playerChunkZ + preloadDist; z++) {
            const isNearby = isChunkNearby(x, z, playerChunkX, playerChunkZ, renderDist);
            const isPotentiallyVisible = isChunkPotentiallyVisible(x, z);
            const inPreloadRange = isChunkInPreloadRange(x, z, playerChunkX, playerChunkZ, preloadDist);

            if (isNearby || (isPotentiallyVisible && inPreloadRange)) {
                activeKeys.add(`${x},${z}`);
            }
        }
    }

    return activeKeys;
}

function addMissingChunks(activeKeys, level, scene, chunks, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes, phoneSeed) {
    let changed = false;

    for (const key of activeKeys) {
        if (chunks.has(key)) {
            continue;
        }

        const [chunkX, chunkZ] = key.split(',').map(Number);
        chunks.set(
            key,
            generateChunk(level, chunkX, chunkZ, scene, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes, phoneSeed),
        );
        changed = true;
    }

    return changed;
}

function removeTrackedItems(list, items) {
    for (const item of items) {
        const index = list.indexOf(item);
        if (index !== -1) {
            list.splice(index, 1);
        }
    }
}

function disposeOwnedChildResources(child) {
    if (child.isInstancedMesh) {
        child.dispose();
    }

    if (child.userData.ownsGeometry) {
        child.geometry.dispose();
    }

    if (child.userData.ownsMaterial) {
        child.material.dispose();
    }
}

// Chunks own their merged geometry, instance buffers, border planes, and debug
// helpers. Prop clones share GLTF resources and levels cache shared geometry,
// so only tagged children and instanced meshes are disposed here.
export function disposeChunkResources(chunk) {
    chunk.traverse(disposeOwnedChildResources);

    if (chunk.userData.border) {
        chunk.userData.border.traverse(disposeOwnedChildResources);
    }
}

function removeChunk(scene, key, chunk, chunks, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes) {
    scene.remove(chunk);
    chunks.delete(key);
    disposeChunkResources(chunk);

    removeTrackedItems(walls, chunk.userData.walls || []);
    removeTrackedItems(lightPanels, chunk.userData.lightPanels || []);
    removeTrackedItems(phonePositions, chunk.userData.phonePositions || []);
    removeTrackedItems(phoneMeshes, chunk.userData.raycastTargets || []);

    if (chunk.userData.border) {
        scene.remove(chunk.userData.border);
        removeTrackedItems(chunkBorders, [chunk.userData.border]);
    }
}

export function updateChunks(level, camera, scene, chunks, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes, settings = {}) {
    const playerChunkX = Math.floor((camera.position.x + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const playerChunkZ = Math.floor((camera.position.z + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const renderDist = settings.renderDist ?? RENDER_DIST;
    const preloadDist = settings.preloadDist ?? PRELOAD_DIST;
    let changed = false;

    camera.updateMatrixWorld();
    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(frustumMatrix);

    const activeKeys = getActiveChunkKeys(playerChunkX, playerChunkZ, renderDist, preloadDist);
    changed = addMissingChunks(activeKeys, level, scene, chunks, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes, settings.phoneSeed ?? 0);

    for (const [key, chunk] of chunks.entries()) {
        if (!activeKeys.has(key)) {
            const removedHelpers = new Set();
            chunk.traverse((child) => { if (child.isLine || child.isLineSegments) removedHelpers.add(child); });
            for (let index = debugNormals.length - 1; index >= 0; index--) {
                if (removedHelpers.has(debugNormals[index])) debugNormals.splice(index, 1);
            }
            removeChunk(scene, key, chunk, chunks, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes);
            changed = true;
        }
    }

    return {
        changed,
        playerChunkX,
        playerChunkZ,
    };
}

function getSpatialCellKey(cellX, cellZ) {
    return `${cellX},${cellZ}`;
}

function getSpatialCell(value, cellSize) {
    return Math.floor(value / cellSize);
}

function addWallToSpatialCell(index, cellX, cellZ, wall) {
    const key = getSpatialCellKey(cellX, cellZ);
    let cellWalls = index.cells.get(key);

    if (!cellWalls) {
        cellWalls = [];
        index.cells.set(key, cellWalls);
    }

    cellWalls.push(wall);
}

export function createWallSpatialIndex(cellSize = SPATIAL_CELL_SIZE) {
    return {
        cellSize,
        cells: new Map(),
    };
}

export function rebuildWallSpatialIndex(index, walls) {
    index.cells.clear();

    for (const wall of walls) {
        const box = wall.userData.worldBox;
        const minCellX = getSpatialCell(box.min.x, index.cellSize);
        const maxCellX = getSpatialCell(box.max.x, index.cellSize);
        const minCellZ = getSpatialCell(box.min.z, index.cellSize);
        const maxCellZ = getSpatialCell(box.max.z, index.cellSize);

        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
            for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
                addWallToSpatialCell(index, cellX, cellZ, wall);
            }
        }
    }
}

export function queryWallsNearBox(index, box, target = []) {
    target.length = 0;
    const seen = new Set();
    const minCellX = getSpatialCell(box.min.x, index.cellSize);
    const maxCellX = getSpatialCell(box.max.x, index.cellSize);
    const minCellZ = getSpatialCell(box.min.z, index.cellSize);
    const maxCellZ = getSpatialCell(box.max.z, index.cellSize);

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
            const cellWalls = index.cells.get(getSpatialCellKey(cellX, cellZ));
            if (!cellWalls) {
                continue;
            }

            for (const wall of cellWalls) {
                if (seen.has(wall)) {
                    continue;
                }

                seen.add(wall);
                target.push(wall);
            }
        }
    }

    return target;
}

export function queryWallsAlongSegment(index, fromX, fromZ, toX, toZ, target = []) {
    tempChunkMin.set(Math.min(fromX, toX), 0, Math.min(fromZ, toZ));
    tempChunkMax.set(Math.max(fromX, toX), WALL_HEIGHT, Math.max(fromZ, toZ));
    tempChunkBounds.min.copy(tempChunkMin);
    tempChunkBounds.max.copy(tempChunkMax);
    return queryWallsNearBox(index, tempChunkBounds, target);
}

export function hasLineOfSight(fromX, fromZ, toX, toZ, walls, wallSpatialIndex = null) {
    const dirX = toX - fromX;
    const dirZ = toZ - fromZ;
    const rayLength = Math.hypot(dirX, dirZ);

    if (rayLength < 0.01) {
        return true;
    }

    const normX = dirX / rayLength;
    const normZ = dirZ / rayLength;

    const wallsToCheck = wallSpatialIndex ? queryWallsAlongSegment(wallSpatialIndex, fromX, fromZ, toX, toZ, tempLineWalls) : walls;

    for (const wall of wallsToCheck) {
        tempWallBounds.copy(wall.userData.worldBox);
        if (tempWallBounds.max.y < SIGHT_LINE_HEIGHT) {
            continue;
        }

        const minX = tempWallBounds.min.x;
        const maxX = tempWallBounds.max.x;
        const minZ = tempWallBounds.min.z;
        const maxZ = tempWallBounds.max.z;

        let tMin = 0;
        let tMax = rayLength;

        if (Math.abs(normX) > 0.0001) {
            const t1 = (minX - fromX) / normX;
            const t2 = (maxX - fromX) / normX;
            tMin = Math.max(tMin, Math.min(t1, t2));
            tMax = Math.min(tMax, Math.max(t1, t2));
        } else if (fromX < minX || fromX > maxX) {
            continue;
        }

        if (Math.abs(normZ) > 0.0001) {
            const t1 = (minZ - fromZ) / normZ;
            const t2 = (maxZ - fromZ) / normZ;
            tMin = Math.max(tMin, Math.min(t1, t2));
            tMax = Math.min(tMax, Math.max(t1, t2));
        } else if (fromZ < minZ || fromZ > maxZ) {
            continue;
        }

        if (tMin <= tMax && tMin < rayLength && tMax > 0) {
            return false;
        }
    }

    return true;
}
