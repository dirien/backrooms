import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE } from './constants.js';

/**
 * Shared building blocks for level chunk builders. A level's buildChunk()
 * fills a chunk state with plain records:
 * - walls: { userData: { worldBox, worldCenter } } for collision, sight and light occlusion
 * - lightPanels: { userData: { powered, worldPosition } } for baking and hum proximity
 * - phonePositions / phoneMeshes / raycastTargets for the phone objective
 * Rendered meshes are never collision objects.
 */

const tempCenter = new THREE.Vector3();
const tempSize = new THREE.Vector3();

export function seededNoise(seed) {
    return Math.abs(Math.sin(seed) * 10000) % 1;
}

export function createChunkState() {
    return {
        lightPanels: [],
        phoneMeshes: [],
        phonePositions: [],
        raycastTargets: [],
        walls: [],
    };
}

export function addStaticMesh(group, mesh, options = {}) {
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    if (options.castShadow) {
        mesh.castShadow = true;
    }

    if (options.receiveShadow) {
        mesh.receiveShadow = true;
    }

    group.add(mesh);
    return mesh;
}

// Merges per-chunk geometry into one owned mesh and disposes the parts.
export function addMergedMesh(group, geometries, material, options = {}) {
    if (geometries.length === 0) {
        return null;
    }

    const mergedGeometry = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());

    const mesh = new THREE.Mesh(mergedGeometry, material);
    mesh.userData.ownsGeometry = true;
    return addStaticMesh(group, mesh, options);
}

// Collision, sight, and light-occlusion record for an axis-aligned block in chunk-local space.
export function createWallRecord(cx, cz, x, y, z, sizeX, sizeY, sizeZ) {
    tempCenter.set(cx * CHUNK_SIZE + x, y, cz * CHUNK_SIZE + z);
    tempSize.set(sizeX, sizeY, sizeZ);

    return {
        userData: {
            worldBox: new THREE.Box3().setFromCenterAndSize(tempCenter, tempSize),
            worldCenter: tempCenter.clone(),
        },
    };
}

export function createFixtureRecord(worldX, worldY, worldZ, powered) {
    return {
        userData: {
            powered,
            worldPosition: new THREE.Vector3(worldX, worldY, worldZ),
        },
    };
}

// Registers a placed phone so the objective, prompt, and tap raycasts can find it.
export function registerPhone(group, state, phone, cx, cz, localX, localZ, height = 1.7) {
    group.add(phone);
    state.phoneMeshes.push(phone);
    state.phonePositions.push(new THREE.Vector3(cx * CHUNK_SIZE + localX, height, cz * CHUNK_SIZE + localZ));

    phone.traverse((child) => {
        if (child.isMesh) {
            state.raycastTargets.push(child);
        }
    });
}

export function createNormalLine(origin, direction, material) {
    const points = [
        origin.clone(),
        origin.clone().add(direction.clone().multiplyScalar(1.5)),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    line.userData.ownsGeometry = true;
    line.userData.ownsMaterial = true;
    return line;
}

export function addDebugNormals(group, debugNormals, center, normals, material) {
    for (const normal of normals) {
        const normalLine = createNormalLine(center, normal, material);
        normalLine.visible = false;
        group.add(normalLine);
        debugNormals.push(normalLine);
    }
}

export function addDebugHelpers(object, group, debugNormals, debugMode, color, size) {
    const boxHelper = new THREE.BoxHelper(object, color);
    boxHelper.visible = debugMode;
    boxHelper.userData.ownsGeometry = true;
    boxHelper.userData.ownsMaterial = true;
    group.add(boxHelper);
    debugNormals.push(boxHelper);

    const axes = new THREE.AxesHelper(size);
    axes.visible = debugMode;
    axes.userData.ownsGeometry = true;
    axes.userData.ownsMaterial = true;
    object.add(axes);
    debugNormals.push(axes);
}
