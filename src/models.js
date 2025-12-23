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
let outletModel = null;
let wallPhoneModel = null;
let bacteriaModel = null;
let gltfLoader = null;

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
    const geo = new THREE.BoxGeometry(width, height, depth);
    const uvAttribute = geo.attributes.uv;
    const posAttribute = geo.attributes.position;
    const normalAttribute = geo.attributes.normal;

    const texScale = 2.0;

    for (let i = 0; i < uvAttribute.count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i);
        const z = posAttribute.getZ(i);

        const nx = normalAttribute.getX(i);
        const ny = normalAttribute.getY(i);
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

function loadCeilingTexture(textureLoader) {
    const ceilTex = textureLoader.load('/graphics/ceiling-tile.png');
    ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;
    return ceilTex;
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

export function createGlobalResources() {
    const textureLoader = new THREE.TextureLoader();
    const wallTex = textureLoader.load('/graphics/wallpaper.png');
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(1, 1);

    const ceilTex = loadCeilingTexture(textureLoader);
    const tileWorldSize = 1.5;
    ceilTex.repeat.set(CHUNK_SIZE / tileWorldSize, CHUNK_SIZE / tileWorldSize);

    wallMat = new THREE.MeshLambertMaterial({
        map: wallTex,
        side: THREE.FrontSide
    });
    enhanceMaterialWithDarkness(wallMat);

    floorMat = new THREE.MeshLambertMaterial({
        color: 0xa9a865,
        side: THREE.FrontSide
    });
    enhanceMaterialWithDarkness(floorMat);

    ceilingMat = new THREE.MeshStandardMaterial({
        map: ceilTex,
        roughness: 0.95,
        metalness: 0,
        color: 0xbbbbbb,
        side: THREE.DoubleSide
    });
    enhanceMaterialWithDarkness(ceilingMat);

    lightPanelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    enhanceMaterialWithDarkness(lightPanelMat);

    const gSize = 3;
    const cellSize = CHUNK_SIZE / gSize;
    lightPanelGeo = new THREE.PlaneGeometry(cellSize * 0.4, cellSize * 0.2);

    const wallThickness = 0.3;
    const wallHeight = 3;
    const wallLengthV = cellSize + 0.31;
    const wallLengthH = cellSize - 0.01;

    wallGeoV = createWallGeometry(wallThickness, wallHeight, wallLengthV);
    wallGeoH = createWallGeometry(wallLengthH, wallHeight, wallThickness);

    floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    ceilingGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);

    gltfLoader = new GLTFLoader();
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

            console.log('Wall outlet model loaded');
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

            console.log('Wall phone model loaded');
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

            console.log('Bacteria entity model loaded (black, 50% scale)');
            resolve();
        }, undefined, (error) => {
            console.warn('Failed to load bacteria model:', error);
            resolve();
        });
    });
}
