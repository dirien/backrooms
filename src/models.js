import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHUNK_SIZE } from './constants.js';

/**
 * Model loading and global resources
 */

let wallMat = null;
let floorMat = null;
let ceilingMat = null;
let lightPanelMat = null;
let wallGeoV = null;
let wallGeoH = null;
let floorGeo = null;
let ceilingGeo = null;
let lightPanelGeo = null;
let wallTexture = null;
let ceilingTexture = null;
let outletModel = null;
let wallPhoneModel = null;
let bacteriaModel = null;
let gltfLoader = null;
let textureLoader = null;

export function getResources() {
    return {
        wallMat,
        floorMat,
        ceilingMat,
        lightPanelMat,
        wallGeoV,
        wallGeoH,
        floorGeo,
        ceilingGeo,
        lightPanelGeo,
        outletModel,
        wallPhoneModel,
        bacteriaModel
    };
}

export function getMaterials() {
    return [wallMat, floorMat, ceilingMat, lightPanelMat];
}

export function getBacteriaModel() {
    return bacteriaModel;
}

// Create wall geometry with proper UV mapping
function createWallGeometry(width, height, depth) {
    const geo = new THREE.BoxGeometry(width, height, depth, Math.ceil(width * 2), Math.ceil(height * 2), Math.ceil(depth * 2));
    const uvAttribute = geo.attributes.uv;
    const posAttribute = geo.attributes.position;
    const normalAttribute = geo.attributes.normal;

    const texScale = 2.0;

    for (let i = 0; i < uvAttribute.count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i);
        const z = posAttribute.getZ(i);

        const nx = normalAttribute.getX(i);
        const nz = normalAttribute.getZ(i);

        let u, v;

        if (Math.abs(nx) > 0.5) {
            u = (z + depth / 2) / texScale;
            v = (y + height / 2) / texScale;
        } else if (Math.abs(nz) > 0.5) {
            u = (x + width / 2) / texScale;
            v = (y + height / 2) / texScale;
        } else {
            u = (x + width / 2) / texScale;
            v = (z + depth / 2) / texScale;
        }

        uvAttribute.setXY(i, u, v);
    }

    uvAttribute.needsUpdate = true;
    return geo;
}

function loadCeilingTexture(loader) {
    const texture = loader.load('/graphics/ceiling-tile.webp');
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

function enhanceMaterialWithDarkness(material) {
    material.userData.darknessUniforms = {
        entityWorldPos: { value: new THREE.Vector3() },
        entityVisible: { value: 0.0 },
        darknessRadius: { value: 5.0 },
        darknessIntensity: { value: 0.0 }
    };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.entityWorldPos = material.userData.darknessUniforms.entityWorldPos;
        shader.uniforms.entityVisible = material.userData.darknessUniforms.entityVisible;
        shader.uniforms.darknessRadius = material.userData.darknessUniforms.darknessRadius;
        shader.uniforms.darknessIntensity = material.userData.darknessUniforms.darknessIntensity;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            varying vec3 vWorldPosition;
            `
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform vec3 entityWorldPos;
            uniform float entityVisible;
            uniform float darknessRadius;
            uniform float darknessIntensity;
            varying vec3 vWorldPosition;
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `
            #include <dithering_fragment>
            float edgeShade = smoothstep(0.0, 0.5, vWorldPosition.y);
            if (vWorldPosition.y > 0.05 && vWorldPosition.y < 2.95) {
                gl_FragColor.rgb *= 0.76 + edgeShade * 0.24;
            }
            if (vWorldPosition.y < 0.05) {
                float fiber = fract(sin(dot(floor(vWorldPosition.xz * 170.0), vec2(12.9898, 78.233))) * 43758.5453);
                float stain = sin(vWorldPosition.x * 0.37) * sin(vWorldPosition.z * 0.23);
                gl_FragColor.rgb *= 0.86 + fiber * 0.20 + stain * 0.09;
            }
            if (entityVisible > 0.5) {
                float dist = distance(vWorldPosition, entityWorldPos);
                float darknessFactor = smoothstep(0.0, darknessRadius, dist);
                float darkMult = mix(1.0 - darknessIntensity, 1.0, darknessFactor);
                gl_FragColor.rgb *= darkMult;
            }
            `
        );
    };
}

export function createGlobalResources(theme) {
    if (!textureLoader) {
        textureLoader = new THREE.TextureLoader();
    }

    if (!wallTexture) {
        wallTexture = textureLoader.load('/graphics/wallpaper.webp');
        wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
        wallTexture.repeat.set(1, 1);
        wallTexture.colorSpace = THREE.SRGBColorSpace;
    }

    if (!ceilingTexture) {
        ceilingTexture = loadCeilingTexture(textureLoader);
        const tileWorldSize = 1.5;
        ceilingTexture.repeat.set(CHUNK_SIZE / tileWorldSize, CHUNK_SIZE / tileWorldSize);
    }

    createSharedMaterials();
    createSharedGeometry();
    applyTheme(theme);

    if (!gltfLoader) {
        gltfLoader = new GLTFLoader();
    }
}

function createSharedMaterials() {
    if (!wallMat) {
        wallMat = new THREE.MeshStandardMaterial({
            roughness: 0.95,
            map: wallTexture,
            side: THREE.FrontSide
        });
        enhanceMaterialWithDarkness(wallMat);
    }

    if (!floorMat) {
        floorMat = new THREE.MeshStandardMaterial({
            roughness: 1,
            side: THREE.FrontSide
        });
        enhanceMaterialWithDarkness(floorMat);
    }

    if (!ceilingMat) {
        ceilingMat = new THREE.MeshStandardMaterial({
            map: ceilingTexture,
            roughness: 0.95,
            metalness: 0,
            side: THREE.DoubleSide
        });
        enhanceMaterialWithDarkness(ceilingMat);
    }

    if (!lightPanelMat) {
        lightPanelMat = new THREE.MeshBasicMaterial();
        enhanceMaterialWithDarkness(lightPanelMat);
    }
}

function createSharedGeometry() {
    if (wallGeoV && wallGeoH && floorGeo && ceilingGeo && lightPanelGeo) {
        return;
    }

    const gSize = 3;
    const cellSize = CHUNK_SIZE / gSize;
    lightPanelGeo = new THREE.PlaneGeometry(cellSize * 0.4, cellSize * 0.2);

    const wallThickness = 0.3;
    const wallHeight = 3;
    const wallLengthV = cellSize + 0.31;
    const wallLengthH = cellSize - 0.01;

    wallGeoV = createWallGeometry(wallThickness, wallHeight, wallLengthV);
    wallGeoH = createWallGeometry(wallLengthH, wallHeight, wallThickness);

    floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE * 2);
    ceilingGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE * 2);
}

function applyTheme(theme) {
    wallMat.color.setHex(theme.wallColor);
    wallMat.map = wallTexture;
    wallMat.needsUpdate = true;

    floorMat.color.setHex(theme.floorColor);
    floorMat.needsUpdate = true;

    ceilingMat.color.setHex(theme.ceilingColor);
    ceilingMat.map = ceilingTexture;
    ceilingMat.needsUpdate = true;

    lightPanelMat.color.setHex(theme.lightPanelColor);
    lightPanelMat.needsUpdate = true;
}

export function loadOutletModel() {
    return new Promise((resolve) => {
        gltfLoader.load('/models/wall_outlet_american.glb', (gltf) => {
            outletModel = gltf.scene;
            outletModel.scale.set(0.75, 0.75, 0.75);

            outletModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    if (child.material.map) {
                        child.material.metalness = 0;
                        child.material.roughness = 0.4;
                        child.material.color = new THREE.Color(0xffffff);
                        child.material.emissive = new THREE.Color(0x222222);
                        child.material.needsUpdate = true;
                    } else {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0xffffff,
                            roughness: 0.4,
                            metalness: 0.0,
                            emissive: 0xbbbbbb
                        });
                    }
                }
            });

            resolve();
        }, undefined, (error) => {
            console.warn('Failed to load outlet model:', error);
            resolve();
        });
    });
}

export function loadWallPhoneModel() {
    return new Promise((resolve) => {
        gltfLoader.load('/models/corded_public_phone_-_low_poly.glb', (gltf) => {
            wallPhoneModel = gltf.scene;
            wallPhoneModel.scale.set(0.05, 0.05, 0.05);

            wallPhoneModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material.map) {
                        child.material.metalness = 0;
                        child.material.roughness = 0.5;
                        child.material.emissive = new THREE.Color(0x222222);
                        child.material.needsUpdate = true;
                    }
                }
            });

            resolve();
        }, undefined, (error) => {
            console.warn('Failed to load wall phone model:', error);
            resolve();
        });
    });
}

export function loadBacteriaModel() {
    return new Promise((resolve) => {
        gltfLoader.load('/models/bacteria_-_kane_pixels_backrooms.glb', (gltf) => {
            bacteriaModel = gltf.scene;
            bacteriaModel.scale.set(0.12, 0.12, 0.12);

            bacteriaModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x000000,
                        roughness: 0.8,
                        metalness: 0.2,
                        emissive: 0x111111,
                        emissiveIntensity: 0.1
                    });
                }
            });

            resolve();
        }, undefined, (error) => {
            console.warn('Failed to load bacteria model:', error);
            resolve();
        });
    });
}
