import * as THREE from 'three';
import { CHUNK_SIZE, RENDER_DIST, PRELOAD_DIST, PHONE_EXCLUSION_DIST } from './constants.js';

/**
 * World generation and chunk management
 */

const frustum = new THREE.Frustum();
const frustumMatrix = new THREE.Matrix4();
const tempChunkBounds = new THREE.Box3();
const tempChunkMin = new THREE.Vector3();
const tempChunkMax = new THREE.Vector3();
const tempWallBounds = new THREE.Box3();
const tempShuffleArray = [];

function seededRandom(seed) {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

function createCellSides(x, z) {
    return [
        { type: 'h', i: z + 1, j: x },
        { type: 'h', i: z, j: x },
        { type: 'v', i: x + 1, j: z },
        { type: 'v', i: x, j: z },
    ];
}

function getWallArray(side, horizontalWalls, verticalWalls) {
    return side.type === 'h' ? horizontalWalls : verticalWalls;
}

function countOpenSides(sides, horizontalWalls, verticalWalls) {
    let openSides = 0;

    for (const side of sides) {
        const walls = getWallArray(side, horizontalWalls, verticalWalls);
        if (!walls[side.i][side.j]) {
            openSides++;
        }
    }

    return openSides;
}

function countWalls(sides, horizontalWalls, verticalWalls) {
    let wallCount = 0;

    for (const side of sides) {
        const walls = getWallArray(side, horizontalWalls, verticalWalls);
        if (walls[side.i][side.j]) {
            wallCount++;
        }
    }

    return wallCount;
}

function getShuffledSides(sides, random) {
    tempShuffleArray.length = 0;
    tempShuffleArray.push(...sides);

    for (let index = tempShuffleArray.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(random() * (index + 1));
        [tempShuffleArray[index], tempShuffleArray[swapIndex]] = [tempShuffleArray[swapIndex], tempShuffleArray[index]];
    }

    return tempShuffleArray;
}

function openRandomWallsUntilBalanced(sides, horizontalWalls, verticalWalls, random, minOpenSides, maxWalls) {
    let openSides = countOpenSides(sides, horizontalWalls, verticalWalls);
    let wallCount = countWalls(sides, horizontalWalls, verticalWalls);

    while (openSides < minOpenSides || wallCount > maxWalls) {
        const shuffledSides = getShuffledSides(sides, random);

        for (const side of shuffledSides) {
            const walls = getWallArray(side, horizontalWalls, verticalWalls);
            if (!walls[side.i][side.j]) {
                continue;
            }

            walls[side.i][side.j] = false;
            openSides++;
            wallCount--;

            if (openSides >= minOpenSides && wallCount <= maxWalls) {
                return;
            }
        }
    }
}

function removeBoundaryWalls(horizontalWalls, verticalWalls, gridSize) {
    const midPoint = Math.floor(gridSize / 2);

    for (let index = 0; index < gridSize; index++) {
        if (index !== midPoint) {
            continue;
        }

        horizontalWalls[gridSize][index] = false;
        horizontalWalls[0][index] = false;
        verticalWalls[gridSize][index] = false;
        verticalWalls[0][index] = false;
    }
}

function generateWallGrid(cx, cz, gridSize) {
    const seed = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
    const random = seededRandom(seed);
    const horizontalWalls = [];
    const verticalWalls = [];

    for (let row = 0; row <= gridSize; row++) {
        horizontalWalls[row] = [];
        verticalWalls[row] = [];

        for (let column = 0; column < gridSize; column++) {
            horizontalWalls[row][column] = random() > 0.45;
            verticalWalls[row][column] = random() > 0.45;
        }
    }

    removeBoundaryWalls(horizontalWalls, verticalWalls, gridSize);

    for (let z = 0; z < gridSize; z++) {
        for (let x = 0; x < gridSize; x++) {
            openRandomWallsUntilBalanced(createCellSides(x, z), horizontalWalls, verticalWalls, random, 2, 2);
        }
    }

    return { horizontalWalls, verticalWalls };
}

function createNormalLine(origin, direction, material) {
    const points = [
        origin.clone(),
        origin.clone().add(direction.clone().multiplyScalar(1.5)),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, material);
}

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

    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    group.visible = debugMode;

    return group;
}

function createChunkState() {
    return {
        border: null,
        lightPanels: [],
        phoneMeshes: [],
        phonePositions: [],
        raycastTargets: [],
        walls: [],
    };
}

function addStaticMesh(group, mesh, collection, options = {}) {
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    if (options.castShadow) {
        mesh.castShadow = true;
    }

    if (options.receiveShadow) {
        mesh.receiveShadow = true;
    }

    group.add(mesh);
    collection.push(mesh);
    return mesh;
}

function addFloorAndCeiling(group, resources) {
    const floor = new THREE.Mesh(resources.floorGeo, resources.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    addStaticMesh(group, floor, [], { receiveShadow: true });

    const ceiling = new THREE.Mesh(resources.ceilingGeo, resources.ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 3.01, 0);
    addStaticMesh(group, ceiling, []);
}

function addWallsToChunk(group, chunkState, wallMaterial, wallGeometry, positions) {
    for (const position of positions) {
        const wall = new THREE.Mesh(wallGeometry, wallMaterial);
        wall.position.copy(position);
        addStaticMesh(group, wall, chunkState.walls, { castShadow: true, receiveShadow: true });
    }
}

function buildWallPositions(horizontalWalls, verticalWalls, gridSize, cellSize) {
    const horizontalPositions = [];
    const verticalPositions = [];

    for (let column = 0; column <= gridSize; column++) {
        const posX = -CHUNK_SIZE / 2 + column * cellSize;

        for (let row = 0; row < gridSize; row++) {
            if (verticalWalls[column][row]) {
                verticalPositions.push(new THREE.Vector3(posX, 1.5, -CHUNK_SIZE / 2 + row * cellSize + cellSize / 2));
            }
        }
    }

    for (let row = 0; row <= gridSize; row++) {
        const posZ = -CHUNK_SIZE / 2 + row * cellSize;

        for (let column = 0; column < gridSize; column++) {
            if (horizontalWalls[row][column]) {
                horizontalPositions.push(new THREE.Vector3(-CHUNK_SIZE / 2 + column * cellSize + cellSize / 2, 1.5, posZ));
            }
        }
    }

    return { horizontalPositions, verticalPositions };
}

function addLightPanels(group, chunkState, resources, gridSize, cellSize) {
    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            const panel = new THREE.Mesh(resources.lightPanelGeo, resources.lightPanelMat);
            panel.position.set(
                -CHUNK_SIZE / 2 + x * cellSize + cellSize / 2,
                2.99,
                -CHUNK_SIZE / 2 + z * cellSize + cellSize / 2,
            );
            panel.rotation.x = Math.PI / 2;
            addStaticMesh(group, panel, chunkState.lightPanels);
        }
    }
}

function buildWallsInChunk(horizontalWalls, verticalWalls, gridSize, cellSize, group, debugNormals) {
    const normalMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const wallsInChunk = [];

    for (let index = 0; index <= gridSize; index++) {
        const posX = -CHUNK_SIZE / 2 + index * cellSize;
        const posZ = -CHUNK_SIZE / 2 + index * cellSize;

        for (let offset = 0; offset < gridSize; offset++) {
            if (verticalWalls[index][offset]) {
                const wallCenter = new THREE.Vector3(posX, 1.5, -CHUNK_SIZE / 2 + offset * cellSize + cellSize / 2);
                addDebugNormals(group, debugNormals, wallCenter, [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)], normalMaterial);
                wallsInChunk.push({ center: wallCenter, type: 'V', normals: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)] });
            }

            if (horizontalWalls[index][offset]) {
                const wallCenter = new THREE.Vector3(-CHUNK_SIZE / 2 + offset * cellSize + cellSize / 2, 1.5, posZ);
                addDebugNormals(group, debugNormals, wallCenter, [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)], normalMaterial);
                wallsInChunk.push({ center: wallCenter, type: 'H', normals: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)] });
            }
        }
    }

    return wallsInChunk;
}

function addDebugNormals(group, debugNormals, center, normals, material) {
    for (const normal of normals) {
        const normalLine = createNormalLine(center, normal, material);
        normalLine.visible = false;
        group.add(normalLine);
        debugNormals.push(normalLine);
    }
}

function seededNoise(seed) {
    return Math.abs(Math.sin(seed) * 10000) % 1;
}

function getWallAttachmentOffset(wallInfo, seed, spread) {
    if (wallInfo.type === 'V') {
        return { offsetX: 0, offsetZ: (seededNoise(seed) - 0.5) * spread };
    }

    return { offsetX: (seededNoise(seed) - 0.5) * spread, offsetZ: 0 };
}

function applyWallFacingRotation(object, normal, axisRotation = 0) {
    object.rotation.z = axisRotation;

    if (normal.x > 0.5) {
        object.rotation.y = 0;
        return;
    }

    if (normal.x < -0.5) {
        object.rotation.y = Math.PI;
        return;
    }

    object.rotation.y = normal.z > 0.5 ? -Math.PI / 2 : Math.PI / 2;
}

function applyOutletRotation(object, normal) {
    if (normal.x > 0.5) {
        object.rotation.y = Math.PI / 2;
        return;
    }

    if (normal.x < -0.5) {
        object.rotation.y = -Math.PI / 2;
        return;
    }

    object.rotation.y = normal.z > 0.5 ? 0 : Math.PI;
}

function addDebugHelpers(object, group, debugNormals, debugMode, color, size) {
    const boxHelper = new THREE.BoxHelper(object, color);
    boxHelper.visible = debugMode;
    group.add(boxHelper);
    debugNormals.push(boxHelper);

    const axes = new THREE.AxesHelper(size);
    axes.visible = debugMode;
    object.add(axes);
    debugNormals.push(axes);
}

function maybeAddOutlet(group, wallInfo, seed, chunkState, debugNormals, debugMode, outletModel) {
    if (!outletModel || seededNoise(seed) > 0.05) {
        return;
    }

    const normal = wallInfo.normals[seededNoise(seed + 1) > 0.5 ? 0 : 1];
    const { offsetX, offsetZ } = getWallAttachmentOffset(wallInfo, seed + 3, 6);
    const outlet = outletModel.clone();
    outlet.position.set(
        wallInfo.center.x + offsetX + normal.x * 0.16,
        0.2,
        wallInfo.center.z + offsetZ + normal.z * 0.16,
    );
    applyOutletRotation(outlet, normal);
    group.add(outlet);
    addDebugHelpers(outlet, group, debugNormals, debugMode, 0xff00ff, 0.5);
}

function maybeAddPhone(group, wallInfo, seed, cx, cz, chunkState, debugNormals, debugMode, wallPhoneModel) {
    if (!wallPhoneModel || seededNoise(seed) > 0.005) {
        return;
    }

    const normal = wallInfo.normals[seededNoise(seed + 1) > 0.5 ? 0 : 1];
    const { offsetX, offsetZ } = getWallAttachmentOffset(wallInfo, seed + 3, 5);
    const phoneHeight = 1.7;
    const phoneX = wallInfo.center.x + offsetX + normal.x * 0.15;
    const phoneZ = wallInfo.center.z + offsetZ + normal.z * 0.15;
    const phone = wallPhoneModel.clone();

    phone.position.set(phoneX, phoneHeight, phoneZ);
    applyWallFacingRotation(phone, normal, -Math.PI / 2);
    group.add(phone);
    chunkState.phoneMeshes.push(phone);
    chunkState.phonePositions.push(new THREE.Vector3(cx * CHUNK_SIZE + phoneX, phoneHeight, cz * CHUNK_SIZE + phoneZ));

    phone.traverse((child) => {
        if (child.isMesh) {
            chunkState.raycastTargets.push(child);
        }
    });

    addDebugHelpers(phone, group, debugNormals, debugMode, 0x00ffff, 0.5);
}

function addPropsToChunk(group, chunkState, wallsInChunk, cx, cz, resources, debugNormals, debugMode) {
    const chunkDistanceFromSpawn = Math.max(Math.abs(cx), Math.abs(cz));
    const phonesAllowed = chunkDistanceFromSpawn >= PHONE_EXCLUSION_DIST;
    const seed = (cx * 12345) ^ (cz * 54321);

    for (const wallInfo of wallsInChunk) {
        const wallSeed = seed + wallInfo.center.x * 1000 + wallInfo.center.z * 2000;
        maybeAddOutlet(group, wallInfo, wallSeed, chunkState, debugNormals, debugMode, resources.outletModel);

        if (phonesAllowed) {
            const phoneSeed = seed + wallInfo.center.x * 3000 + wallInfo.center.z * 4000 + 12345;
            maybeAddPhone(group, wallInfo, phoneSeed, cx, cz, chunkState, debugNormals, debugMode, resources.wallPhoneModel);
        }
    }
}

function cacheChunkWorldData(group, chunkState) {
    group.updateMatrixWorld(true);

    for (const wall of chunkState.walls) {
        wall.userData.worldBox = new THREE.Box3().setFromObject(wall);
    }

    for (const panel of chunkState.lightPanels) {
        panel.userData.worldPosition = panel.getWorldPosition(new THREE.Vector3());
    }
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

export function generateChunk(cx, cz, scene, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes) {
    const group = new THREE.Group();
    const chunkState = createChunkState();
    const gridSize = 3;
    const cellSize = CHUNK_SIZE / gridSize;
    const { horizontalWalls, verticalWalls } = generateWallGrid(cx, cz, gridSize);
    const { horizontalPositions, verticalPositions } = buildWallPositions(horizontalWalls, verticalWalls, gridSize, cellSize);

    addFloorAndCeiling(group, resources);
    addWallsToChunk(group, chunkState, resources.wallMat, resources.wallGeoV, verticalPositions);
    addWallsToChunk(group, chunkState, resources.wallMat, resources.wallGeoH, horizontalPositions);
    addLightPanels(group, chunkState, resources, gridSize, cellSize);

    const wallsInChunk = buildWallsInChunk(horizontalWalls, verticalWalls, gridSize, cellSize, group, debugNormals);
    addPropsToChunk(group, chunkState, wallsInChunk, cx, cz, resources, debugNormals, debugMode);

    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    scene.add(group);

    const border = createChunkBorder(cx, cz, debugMode);
    scene.add(border);
    chunkBorders.push(border);

    cacheChunkWorldData(group, chunkState);
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

function isChunkNearby(cx, cz, playerChunkX, playerChunkZ) {
    const dx = Math.abs(cx - playerChunkX);
    const dz = Math.abs(cz - playerChunkZ);
    return dx <= RENDER_DIST && dz <= RENDER_DIST;
}

function isChunkInPreloadRange(cx, cz, playerChunkX, playerChunkZ) {
    const dx = Math.abs(cx - playerChunkX);
    const dz = Math.abs(cz - playerChunkZ);
    return dx <= PRELOAD_DIST && dz <= PRELOAD_DIST;
}

function getActiveChunkKeys(playerChunkX, playerChunkZ) {
    const activeKeys = new Set();

    for (let x = playerChunkX - PRELOAD_DIST; x <= playerChunkX + PRELOAD_DIST; x++) {
        for (let z = playerChunkZ - PRELOAD_DIST; z <= playerChunkZ + PRELOAD_DIST; z++) {
            const isNearby = isChunkNearby(x, z, playerChunkX, playerChunkZ);
            const isPotentiallyVisible = isChunkPotentiallyVisible(x, z);
            const inPreloadRange = isChunkInPreloadRange(x, z, playerChunkX, playerChunkZ);

            if (isNearby || (isPotentiallyVisible && inPreloadRange)) {
                activeKeys.add(`${x},${z}`);
            }
        }
    }

    return activeKeys;
}

function addMissingChunks(activeKeys, scene, chunks, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes) {
    for (const key of activeKeys) {
        if (chunks.has(key)) {
            continue;
        }

        const [chunkX, chunkZ] = key.split(',').map(Number);
        chunks.set(
            key,
            generateChunk(chunkX, chunkZ, scene, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes),
        );
    }
}

function removeTrackedItems(list, items) {
    for (const item of items) {
        const index = list.indexOf(item);
        if (index !== -1) {
            list.splice(index, 1);
        }
    }
}

function removeChunk(scene, key, chunk, chunks, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes) {
    scene.remove(chunk);
    chunks.delete(key);

    removeTrackedItems(walls, chunk.userData.walls || []);
    removeTrackedItems(lightPanels, chunk.userData.lightPanels || []);
    removeTrackedItems(phonePositions, chunk.userData.phonePositions || []);
    removeTrackedItems(phoneMeshes, chunk.userData.raycastTargets || []);

    if (chunk.userData.border) {
        scene.remove(chunk.userData.border);
        removeTrackedItems(chunkBorders, [chunk.userData.border]);
    }
}

export function updateChunks(camera, scene, chunks, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes) {
    const playerChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const playerChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(frustumMatrix);

    const activeKeys = getActiveChunkKeys(playerChunkX, playerChunkZ);
    addMissingChunks(activeKeys, scene, chunks, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes);

    for (const [key, chunk] of chunks.entries()) {
        if (!activeKeys.has(key)) {
            removeChunk(scene, key, chunk, chunks, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes);
        }
    }
}

export function hasLineOfSight(fromX, fromZ, toX, toZ, walls) {
    const dirX = toX - fromX;
    const dirZ = toZ - fromZ;
    const rayLength = Math.hypot(dirX, dirZ);

    if (rayLength < 0.01) {
        return true;
    }

    const normX = dirX / rayLength;
    const normZ = dirZ / rayLength;

    for (const wall of walls) {
        tempWallBounds.copy(wall.userData.worldBox);

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
