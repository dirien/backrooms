import * as THREE from 'three';
import { createFixtureBakeContext, FIXTURE_LIGHT_RANGE } from '../../lighting.js';
import { isPhoneChunk } from '../../world-layout.js';
import { CHUNK_SIZE } from '../../constants.js';
import {
    addDebugHelpers,
    addDebugNormals,
    addMergedMesh,
    addStaticMesh,
    createChunkState,
    createFixtureRecord,
    createWallRecord,
    registerPhone,
    seededNoise,
} from '../../chunk-kit.js';
import { CELL_SIZE, GRID_SIZE, WALL_HEIGHT, WALL_LENGTH_H, WALL_LENGTH_V, WALL_THICKNESS, generateWallGrid, isFixturePowered } from './layout.js';
import { getLobbyResources } from './resources.js';
import { dressChunk } from './scenery.js';

const tempPanelMatrix = new THREE.Matrix4();
const tempPanelPosition = new THREE.Vector3();
const tempPanelQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const tempPanelScale = new THREE.Vector3(1, 1, 1);

function addFloorAndCeiling(group, resources) {
    const floor = new THREE.Mesh(resources.floorGeo, resources.floorMat);
    floor.rotation.x = -Math.PI / 2;
    addStaticMesh(group, floor, { receiveShadow: true });

    const ceiling = new THREE.Mesh(resources.ceilingGeo, resources.ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 3.01, 0);
    addStaticMesh(group, ceiling);
}

function addMergedWallsToChunk(group, wallMaterial, wallGeometry, positions) {
    const geometries = positions.map((position) => wallGeometry.clone().translate(position.x, position.y, position.z));
    addMergedMesh(group, geometries, wallMaterial, { castShadow: true, receiveShadow: true });
}

function addWallCollisionRecords(state, positions, cx, cz, sizeX, sizeZ) {
    for (const position of positions) {
        state.walls.push(createWallRecord(cx, cz, position.x, position.y, position.z, sizeX, WALL_HEIGHT, sizeZ));
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

function addLightPanels(group, state, resources, cx, cz) {
    const panels = new THREE.InstancedMesh(resources.lightPanelGeo, resources.lightPanelMat, GRID_SIZE * GRID_SIZE);
    panels.matrixAutoUpdate = false;
    panels.frustumCulled = false;

    let panelIndex = 0;

    for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            tempPanelPosition.set(
                -CHUNK_SIZE / 2 + x * CELL_SIZE + CELL_SIZE / 2,
                2.99,
                -CHUNK_SIZE / 2 + z * CELL_SIZE + CELL_SIZE / 2,
            );
            tempPanelMatrix.compose(tempPanelPosition, tempPanelQuaternion, tempPanelScale);
            panels.setMatrixAt(panelIndex, tempPanelMatrix);
            const powered = isFixturePowered(cx, cz, panelIndex);
            const brightness = powered ? 1 : 0.005;
            panels.setColorAt(panelIndex, new THREE.Color(brightness, brightness * 0.97, brightness * 0.83));
            state.lightPanels.push(createFixtureRecord(
                cx * CHUNK_SIZE + tempPanelPosition.x,
                tempPanelPosition.y,
                cz * CHUNK_SIZE + tempPanelPosition.z,
                powered,
            ));
            panelIndex++;
        }
    }

    panels.instanceMatrix.needsUpdate = true;
    group.add(panels);
}

function buildWallsInChunk(horizontalWalls, verticalWalls, group, debugNormals) {
    const normalMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const wallsInChunk = [];

    for (let index = 0; index <= GRID_SIZE; index++) {
        const posX = -CHUNK_SIZE / 2 + index * CELL_SIZE;
        const posZ = -CHUNK_SIZE / 2 + index * CELL_SIZE;

        for (let offset = 0; offset < GRID_SIZE; offset++) {
            if (verticalWalls[index][offset]) {
                const wallCenter = new THREE.Vector3(posX, 1.5, -CHUNK_SIZE / 2 + offset * CELL_SIZE + CELL_SIZE / 2);
                addDebugNormals(group, debugNormals, wallCenter, [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)], normalMaterial);
                wallsInChunk.push({ center: wallCenter, type: 'V', normals: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)] });
            }

            if (horizontalWalls[index][offset]) {
                const wallCenter = new THREE.Vector3(-CHUNK_SIZE / 2 + offset * CELL_SIZE + CELL_SIZE / 2, 1.5, posZ);
                addDebugNormals(group, debugNormals, wallCenter, [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)], normalMaterial);
                wallsInChunk.push({ center: wallCenter, type: 'H', normals: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)] });
            }
        }
    }

    return wallsInChunk;
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

function maybeAddOutlet(group, wallInfo, seed, debugNormals, debugMode, outletModel) {
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

function addPhone(group, wallInfo, seed, cx, cz, state, debugNormals, debugMode, wallPhoneModel) {
    if (!wallPhoneModel) {
        return;
    }

    const normal = wallInfo.normals[seededNoise(seed + 1) > 0.5 ? 0 : 1];
    const { offsetX, offsetZ } = getWallAttachmentOffset(wallInfo, seed + 3, 5);
    const phoneHeight = 1.7;
    const phoneX = wallInfo.center.x + offsetX + normal.x * 0.23;
    const phoneZ = wallInfo.center.z + offsetZ + normal.z * 0.23;
    const phone = wallPhoneModel.clone();

    phone.position.set(phoneX, phoneHeight, phoneZ);
    applyWallFacingRotation(phone, normal, -Math.PI / 2);
    registerPhone(group, state, phone, cx, cz, phoneX, phoneZ, phoneHeight);
    addDebugHelpers(phone, group, debugNormals, debugMode, 0x00ffff, 0.5);
}

function addPropsToChunk(group, state, wallsInChunk, cx, cz, resources, debugNormals, debugMode, phoneSeed) {
    const phonesAllowed = isPhoneChunk(cx, cz, phoneSeed);
    const seed = (cx * 12345) ^ (cz * 54321);
    const phoneLayoutSeed = (seed ^ phoneSeed) >>> 0;

    const phoneWall = wallsInChunk[Math.floor(seededNoise(phoneLayoutSeed + 73) * wallsInChunk.length)];
    for (const wallInfo of wallsInChunk) {
        const wallSeed = seed + wallInfo.center.x * 1000 + wallInfo.center.z * 2000;
        maybeAddOutlet(group, wallInfo, wallSeed, debugNormals, debugMode, resources.outletModel);

        if (phonesAllowed && wallInfo === phoneWall) {
            const attachmentSeed = phoneLayoutSeed + wallInfo.center.x * 3000 + wallInfo.center.z * 4000 + 12345;
            addPhone(group, wallInfo, attachmentSeed, cx, cz, state, debugNormals, debugMode, resources.wallPhoneModel);
        }
    }
}

export function buildLobbyChunk({ cx, cz, group, state, debugMode, debugNormals, phoneSeed }) {
    const resources = getLobbyResources();
    const { horizontalWalls, verticalWalls } = generateWallGrid(cx, cz, GRID_SIZE);
    const { horizontalPositions, verticalPositions } = buildWallPositions(horizontalWalls, verticalWalls, GRID_SIZE, CELL_SIZE);

    addFloorAndCeiling(group, resources);
    addMergedWallsToChunk(group, resources.wallMat, resources.wallGeoV, verticalPositions);
    addMergedWallsToChunk(group, resources.wallMat, resources.wallGeoH, horizontalPositions);
    addWallCollisionRecords(state, verticalPositions, cx, cz, WALL_THICKNESS, WALL_LENGTH_V);
    addWallCollisionRecords(state, horizontalPositions, cx, cz, WALL_LENGTH_H, WALL_THICKNESS);
    addLightPanels(group, state, resources, cx, cz);

    const wallsInChunk = buildWallsInChunk(horizontalWalls, verticalWalls, group, debugNormals);
    addPropsToChunk(group, state, wallsInChunk, cx, cz, resources, debugNormals, debugMode, phoneSeed);
    dressChunk(group, wallsInChunk, horizontalPositions, verticalPositions, cx, cz);
}

// Lighting uses walls and fixtures from the neighbouring chunks too, so both
// sides of a chunk border bake identical light before either chunk has loaded.
export function createChunkLightingContext(cx, cz) {
    const lightingState = createChunkState();
    for (let nx = cx - 1; nx <= cx + 1; nx++) {
        for (let nz = cz - 1; nz <= cz + 1; nz++) {
            const grid = generateWallGrid(nx, nz, GRID_SIZE);
            const positions = buildWallPositions(grid.horizontalWalls, grid.verticalWalls, GRID_SIZE, CELL_SIZE);
            addWallCollisionRecords(lightingState, positions.verticalPositions, nx, nz, WALL_THICKNESS, WALL_LENGTH_V);
            addWallCollisionRecords(lightingState, positions.horizontalPositions, nx, nz, WALL_LENGTH_H, WALL_THICKNESS);
            for (let x = 0; x < GRID_SIZE; x++) {
                for (let z = 0; z < GRID_SIZE; z++) {
                    const px = nx * CHUNK_SIZE - 8 + x * CELL_SIZE;
                    const pz = nz * CHUNK_SIZE - 8 + z * CELL_SIZE;
                    const reach = CHUNK_SIZE / 2 + FIXTURE_LIGHT_RANGE;
                    if (Math.abs(px - cx * CHUNK_SIZE) > reach || Math.abs(pz - cz * CHUNK_SIZE) > reach) continue;
                    lightingState.lightPanels.push(createFixtureRecord(px, 2.99, pz, isFixturePowered(nx, nz, x * GRID_SIZE + z)));
                }
            }
        }
    }
    return createFixtureBakeContext(lightingState.lightPanels, lightingState.walls);
}
