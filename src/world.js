import * as THREE from 'three';
import { CHUNK_SIZE, RENDER_DIST, PRELOAD_DIST, PHONE_EXCLUSION_DIST } from './constants.js';

/**
 * World generation and chunk management
 */

// Frustum for visibility checks
let frustum = new THREE.Frustum();
let frustumMatrix = new THREE.Matrix4();

// Seeded random number generator for deterministic chunk generation
function seededRandom(seed) {
    let s = seed;
    return function() {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

// Generate wall placement that guarantees connectivity (no dead ends)
function generateWallGrid(cx, cz, gSize) {
    const seed = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
    const rng = seededRandom(seed);

    const hWalls = [];
    const vWalls = [];

    for (let i = 0; i <= gSize; i++) {
        hWalls[i] = [];
        vWalls[i] = [];
        for (let j = 0; j < gSize; j++) {
            hWalls[i][j] = rng() > 0.45;
            vWalls[i][j] = rng() > 0.45;
        }
    }

    // Remove walls on chunk boundaries
    for (let j = 0; j < gSize; j++) {
        if (j === Math.floor(gSize / 2)) hWalls[gSize][j] = false;
        if (j === Math.floor(gSize / 2)) hWalls[0][j] = false;
        if (j === Math.floor(gSize / 2)) vWalls[gSize][j] = false;
        if (j === Math.floor(gSize / 2)) vWalls[0][j] = false;
    }

    // Ensure each interior cell has at least 2 open sides
    for (let z = 0; z < gSize; z++) {
        for (let x = 0; x < gSize; x++) {
            let openSides = 0;
            const sides = [
                { type: 'h', i: z + 1, j: x },
                { type: 'h', i: z, j: x },
                { type: 'v', i: x + 1, j: z },
                { type: 'v', i: x, j: z }
            ];

            for (const side of sides) {
                const walls = side.type === 'h' ? hWalls : vWalls;
                if (!walls[side.i][side.j]) openSides++;
            }

            while (openSides < 2) {
                const shuffled = [...sides].sort(() => rng() - 0.5);
                for (const side of shuffled) {
                    const walls = side.type === 'h' ? hWalls : vWalls;
                    if (walls[side.i][side.j]) {
                        walls[side.i][side.j] = false;
                        openSides++;
                        if (openSides >= 2) break;
                    }
                }
            }
        }
    }

    // Ensure no cell has more than 2 walls
    for (let z = 0; z < gSize; z++) {
        for (let x = 0; x < gSize; x++) {
            let wallCount = 0;
            const sides = [
                { type: 'h', i: z + 1, j: x },
                { type: 'h', i: z, j: x },
                { type: 'v', i: x + 1, j: z },
                { type: 'v', i: x, j: z }
            ];

            for (const side of sides) {
                const walls = side.type === 'h' ? hWalls : vWalls;
                if (walls[side.i][side.j]) wallCount++;
            }

            while (wallCount > 2) {
                const shuffled = [...sides].sort(() => rng() - 0.5);
                for (const side of shuffled) {
                    const walls = side.type === 'h' ? hWalls : vWalls;
                    if (walls[side.i][side.j]) {
                        walls[side.i][side.j] = false;
                        wallCount--;
                        if (wallCount <= 2) break;
                    }
                }
            }
        }
    }

    return { hWalls, vWalls };
}

// Create a line showing a normal vector from a point
function createNormalLine(origin, direction, material) {
    const points = [
        origin.clone(),
        origin.clone().add(direction.clone().multiplyScalar(1.5))
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, material);
}

// Create chunk border visualization
export function createChunkBorder(cx, cz, debugMode) {
    const group = new THREE.Group();
    const borderMat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    const height = 3;
    const halfSize = CHUNK_SIZE / 2;

    const northGeo = new THREE.PlaneGeometry(CHUNK_SIZE, height);
    const north = new THREE.Mesh(northGeo, borderMat);
    north.position.set(0, height / 2, halfSize);
    group.add(north);

    const south = new THREE.Mesh(northGeo, borderMat);
    south.position.set(0, height / 2, -halfSize);
    south.rotation.y = Math.PI;
    group.add(south);

    const eastGeo = new THREE.PlaneGeometry(CHUNK_SIZE, height);
    const east = new THREE.Mesh(eastGeo, borderMat);
    east.position.set(halfSize, height / 2, 0);
    east.rotation.y = -Math.PI / 2;
    group.add(east);

    const west = new THREE.Mesh(eastGeo, borderMat);
    west.position.set(-halfSize, height / 2, 0);
    west.rotation.y = Math.PI / 2;
    group.add(west);

    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    group.visible = debugMode;

    return group;
}

export function generateChunk(cx, cz, scene, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes) {
    const { wallMat, wallGeoV, wallGeoH, floorGeo, floorMat, ceilingGeo, ceilingMat, lightPanelGeo, lightPanelMat, outletModel, wallPhoneModel } = resources;

    const group = new THREE.Group();
    const seed = (cx * 12345) ^ (cz * 54321);
    const rnd = (s) => (Math.abs(Math.sin(s) * 10000) % 1);

    // Floor tile
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();
    floor.receiveShadow = true;
    group.add(floor);

    // Ceiling tile
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 3.01, 0);
    ceiling.matrixAutoUpdate = false;
    ceiling.updateMatrix();
    group.add(ceiling);

    // Generate wall placement grid
    const gSize = 3;
    const cellSize = CHUNK_SIZE / gSize;
    const { hWalls, vWalls } = generateWallGrid(cx, cz, gSize);

    // Place walls
    for (let i = 0; i <= gSize; i++) {
        const posX = -CHUNK_SIZE / 2 + i * cellSize;
        for (let j = 0; j < gSize; j++) {
            if (vWalls[i][j]) {
                const wall = new THREE.Mesh(wallGeoV, wallMat);
                wall.position.set(posX, 1.5, -CHUNK_SIZE / 2 + j * cellSize + cellSize / 2);
                wall.matrixAutoUpdate = false;
                wall.updateMatrix();
                wall.castShadow = true;
                wall.receiveShadow = true;
                group.add(wall);
                walls.push(wall);
            }
        }
    }

    for (let i = 0; i <= gSize; i++) {
        const posZ = -CHUNK_SIZE / 2 + i * cellSize;
        for (let j = 0; j < gSize; j++) {
            if (hWalls[i][j]) {
                const wall = new THREE.Mesh(wallGeoH, wallMat);
                wall.position.set(-CHUNK_SIZE / 2 + j * cellSize + cellSize / 2, 1.5, posZ);
                wall.matrixAutoUpdate = false;
                wall.updateMatrix();
                wall.castShadow = true;
                wall.receiveShadow = true;
                group.add(wall);
                walls.push(wall);
            }
        }
    }

    // Light panels
    for (let x = 0; x < gSize; x++) {
        for (let z = 0; z < gSize; z++) {
            const lx = -CHUNK_SIZE / 2 + x * cellSize + cellSize / 2;
            const lz = -CHUNK_SIZE / 2 + z * cellSize + cellSize / 2;
            const panel = new THREE.Mesh(lightPanelGeo, lightPanelMat);
            panel.position.set(lx, 2.99, lz);
            panel.rotation.x = Math.PI / 2;
            panel.matrixAutoUpdate = false;
            panel.updateMatrix();
            group.add(panel);
            lightPanels.push(panel);
        }
    }

    // Debug normals and wall tracking
    const normalLineMat = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const wallsInChunk = [];

    // Vertical walls debug
    for (let i = 0; i <= gSize; i++) {
        const posX = -CHUNK_SIZE / 2 + i * cellSize;
        for (let j = 0; j < gSize; j++) {
            if (vWalls[i][j]) {
                const wallZ = -CHUNK_SIZE / 2 + j * cellSize + cellSize / 2;
                const wallCenter = new THREE.Vector3(posX, 1.5, wallZ);

                const normalPlusX = createNormalLine(wallCenter, new THREE.Vector3(1, 0, 0), normalLineMat);
                normalPlusX.visible = false;
                group.add(normalPlusX);
                debugNormals.push(normalPlusX);

                const normalMinusX = createNormalLine(wallCenter, new THREE.Vector3(-1, 0, 0), normalLineMat);
                normalMinusX.visible = false;
                group.add(normalMinusX);
                debugNormals.push(normalMinusX);

                wallsInChunk.push({ center: wallCenter, type: 'V', normals: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)] });
            }
        }
    }

    // Horizontal walls debug
    for (let i = 0; i <= gSize; i++) {
        const posZ = -CHUNK_SIZE / 2 + i * cellSize;
        for (let j = 0; j < gSize; j++) {
            if (hWalls[i][j]) {
                const wallX = -CHUNK_SIZE / 2 + j * cellSize + cellSize / 2;
                const wallCenter = new THREE.Vector3(wallX, 1.5, posZ);

                const normalPlusZ = createNormalLine(wallCenter, new THREE.Vector3(0, 0, 1), normalLineMat);
                normalPlusZ.visible = false;
                group.add(normalPlusZ);
                debugNormals.push(normalPlusZ);

                const normalMinusZ = createNormalLine(wallCenter, new THREE.Vector3(0, 0, -1), normalLineMat);
                normalMinusZ.visible = false;
                group.add(normalMinusZ);
                debugNormals.push(normalMinusZ);

                wallsInChunk.push({ center: wallCenter, type: 'H', normals: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)] });
            }
        }
    }

    // Add outlets randomly
    if (outletModel) {
        for (const wallInfo of wallsInChunk) {
            const wallSeed = seed + wallInfo.center.x * 1000 + wallInfo.center.z * 2000;
            if (rnd(wallSeed) > 0.05) continue;

            const normalIndex = rnd(wallSeed + 1) > 0.5 ? 0 : 1;
            const normal = wallInfo.normals[normalIndex];

            const outlet = outletModel.clone();
            const outletHeight = 0.2;

            let offsetX = 0, offsetZ = 0;
            if (wallInfo.type === 'V') {
                offsetZ = (rnd(wallSeed + 3) - 0.5) * 6;
            } else {
                offsetX = (rnd(wallSeed + 3) - 0.5) * 6;
            }

            outlet.position.set(
                wallInfo.center.x + offsetX + normal.x * 0.16,
                outletHeight,
                wallInfo.center.z + offsetZ + normal.z * 0.16
            );

            if (normal.x > 0.5) {
                outlet.rotation.y = Math.PI / 2;
            } else if (normal.x < -0.5) {
                outlet.rotation.y = -Math.PI / 2;
            } else if (normal.z > 0.5) {
                outlet.rotation.y = 0;
            } else {
                outlet.rotation.y = Math.PI;
            }

            group.add(outlet);

            const outletBoxHelper = new THREE.BoxHelper(outlet, 0xff00ff);
            outletBoxHelper.visible = debugMode;
            group.add(outletBoxHelper);
            debugNormals.push(outletBoxHelper);

            const axes = new THREE.AxesHelper(0.5);
            axes.visible = debugMode;
            outlet.add(axes);
            debugNormals.push(axes);
        }
    }

    // Add wall phones
    const chunkDistFromSpawn = Math.max(Math.abs(cx), Math.abs(cz));
    const phonesAllowed = chunkDistFromSpawn >= PHONE_EXCLUSION_DIST;

    if (wallPhoneModel && phonesAllowed) {
        for (const wallInfo of wallsInChunk) {
            const phoneSeed = seed + wallInfo.center.x * 3000 + wallInfo.center.z * 4000 + 12345;
            if (rnd(phoneSeed) > 0.005) continue;

            const normalIndex = rnd(phoneSeed + 1) > 0.5 ? 0 : 1;
            const normal = wallInfo.normals[normalIndex];

            const phone = wallPhoneModel.clone();
            const phoneHeight = 1.7;

            let offsetX = 0, offsetZ = 0;
            if (wallInfo.type === 'V') {
                offsetZ = (rnd(phoneSeed + 3) - 0.5) * 5;
            } else {
                offsetX = (rnd(phoneSeed + 3) - 0.5) * 5;
            }

            const phoneX = wallInfo.center.x + offsetX + normal.x * 0.15;
            const phoneZ = wallInfo.center.z + offsetZ + normal.z * 0.15;

            phone.position.set(phoneX, phoneHeight, phoneZ);
            phone.rotation.z = -Math.PI / 2;

            if (normal.x > 0.5) {
                phone.rotation.y = 0;
            } else if (normal.x < -0.5) {
                phone.rotation.y = Math.PI;
            } else if (normal.z > 0.5) {
                phone.rotation.y = -Math.PI / 2;
            } else {
                phone.rotation.y = Math.PI / 2;
            }

            group.add(phone);

            const phoneBoxHelper = new THREE.BoxHelper(phone, 0x00ffff);
            phoneBoxHelper.visible = debugMode;
            group.add(phoneBoxHelper);
            debugNormals.push(phoneBoxHelper);

            const phoneAxes = new THREE.AxesHelper(0.5);
            phoneAxes.visible = debugMode;
            phone.add(phoneAxes);
            debugNormals.push(phoneAxes);

            const worldPhonePos = new THREE.Vector3(
                cx * CHUNK_SIZE + phoneX,
                phoneHeight,
                cz * CHUNK_SIZE + phoneZ
            );
            phonePositions.push(worldPhonePos);
            if (!group.userData.phonePositions) group.userData.phonePositions = [];
            group.userData.phonePositions.push(worldPhonePos);

            // Track phone mesh for raycasting (mobile tap interaction)
            if (phoneMeshes) {
                phoneMeshes.push(phone);
                if (!group.userData.phoneMeshes) group.userData.phoneMeshes = [];
                group.userData.phoneMeshes.push(phone);
            }
        }
    }

    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    scene.add(group);

    const border = createChunkBorder(cx, cz, debugMode);
    scene.add(border);
    chunkBorders.push(border);
    group.userData.border = border;

    return group;
}

function isChunkPotentiallyVisible(cx, cz) {
    const chunkCenterX = cx * CHUNK_SIZE;
    const chunkCenterZ = cz * CHUNK_SIZE;

    const halfSize = CHUNK_SIZE / 2;
    const chunkBox = new THREE.Box3(
        new THREE.Vector3(chunkCenterX - halfSize, 0, chunkCenterZ - halfSize),
        new THREE.Vector3(chunkCenterX + halfSize, 3, chunkCenterZ + halfSize)
    );

    return frustum.intersectsBox(chunkBox);
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

export function updateChunks(camera, scene, chunks, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes) {
    const px = Math.floor(camera.position.x / CHUNK_SIZE);
    const pz = Math.floor(camera.position.z / CHUNK_SIZE);

    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(frustumMatrix);

    let activeKeys = new Set();

    for (let x = px - PRELOAD_DIST; x <= px + PRELOAD_DIST; x++) {
        for (let z = pz - PRELOAD_DIST; z <= pz + PRELOAD_DIST; z++) {
            const k = `${x},${z}`;

            const isNearby = isChunkNearby(x, z, px, pz);
            const isPotentiallyVisible = isChunkPotentiallyVisible(x, z);
            const inPreloadRange = isChunkInPreloadRange(x, z, px, pz);

            if (isNearby || (isPotentiallyVisible && inPreloadRange)) {
                activeKeys.add(k);
                if (!chunks.has(k)) {
                    chunks.set(k, generateChunk(x, z, scene, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes));
                }
            }
        }
    }

    for (const [key, obj] of chunks.entries()) {
        if (!activeKeys.has(key)) {
            scene.remove(obj);
            walls.length = 0;
            for (const [k, c] of chunks.entries()) {
                if (k !== key) {
                    c.children.forEach(child => {
                        if (child.isMesh && child.geometry === resources.wallGeoV || child.geometry === resources.wallGeoH) {
                            walls.push(child);
                        }
                    });
                }
            }
            lightPanels.length = 0;
            for (const [k, c] of chunks.entries()) {
                if (k !== key) {
                    c.children.forEach(child => {
                        if (child.isMesh && child.geometry === resources.lightPanelGeo) {
                            lightPanels.push(child);
                        }
                    });
                }
            }
            if (obj.userData.phonePositions) {
                for (const pos of obj.userData.phonePositions) {
                    const idx = phonePositions.indexOf(pos);
                    if (idx !== -1) phonePositions.splice(idx, 1);
                }
            }
            // Clean up phone meshes
            if (obj.userData.phoneMeshes && phoneMeshes) {
                for (const mesh of obj.userData.phoneMeshes) {
                    const idx = phoneMeshes.indexOf(mesh);
                    if (idx !== -1) phoneMeshes.splice(idx, 1);
                }
            }
            if (obj.userData.border) {
                scene.remove(obj.userData.border);
                const idx = chunkBorders.indexOf(obj.userData.border);
                if (idx !== -1) chunkBorders.splice(idx, 1);
            }
            chunks.delete(key);
        }
    }
}

// Check if there's a clear line of sight between two points
export function hasLineOfSight(fromX, fromZ, toX, toZ, walls) {
    const dirX = toX - fromX;
    const dirZ = toZ - fromZ;
    const rayLength = Math.sqrt(dirX * dirX + dirZ * dirZ);

    if (rayLength < 0.01) return true;

    const normX = dirX / rayLength;
    const normZ = dirZ / rayLength;

    for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        const wPos = new THREE.Vector3();
        wall.getWorldPosition(wPos);

        const wBox = new THREE.Box3().setFromObject(wall);
        const minX = wBox.min.x;
        const maxX = wBox.max.x;
        const minZ = wBox.min.z;
        const maxZ = wBox.max.z;

        let tMin = 0;
        let tMax = rayLength;

        if (Math.abs(normX) > 0.0001) {
            const t1 = (minX - fromX) / normX;
            const t2 = (maxX - fromX) / normX;
            const tNear = Math.min(t1, t2);
            const tFar = Math.max(t1, t2);
            tMin = Math.max(tMin, tNear);
            tMax = Math.min(tMax, tFar);
        } else {
            if (fromX < minX || fromX > maxX) continue;
        }

        if (Math.abs(normZ) > 0.0001) {
            const t1 = (minZ - fromZ) / normZ;
            const t2 = (maxZ - fromZ) / normZ;
            const tNear = Math.min(t1, t2);
            const tFar = Math.max(t1, t2);
            tMin = Math.max(tMin, tNear);
            tMax = Math.min(tMax, tFar);
        } else {
            if (fromZ < minZ || fromZ > maxZ) continue;
        }

        if (tMin <= tMax && tMin < rayLength && tMax > 0) {
            return false;
        }
    }

    return true;
}
