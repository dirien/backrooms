import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Shared asset library. Levels load their own textures and models through
 * these cached helpers; the bacteria entity is shared by every level.
 */

let bacteriaModel = null;
let gltfLoader = null;
let textureLoader = null;
const gltfCache = new Map();
const textureCache = new Map();

export function getBacteriaModel() {
    return bacteriaModel;
}

function getGltfLoader() {
    gltfLoader ??= new GLTFLoader();
    return gltfLoader;
}

// Resolves to the loaded scene, or null (with a warning) so a missing prop never blocks a level.
export function loadGltfScene(url) {
    if (!gltfCache.has(url)) {
        gltfCache.set(url, new Promise((resolve) => {
            getGltfLoader().load(url, (gltf) => resolve(gltf.scene), undefined, (error) => {
                console.warn(`Failed to load model ${url}:`, error);
                resolve(null);
            });
        }));
    }
    return gltfCache.get(url);
}

export function loadTexture(url, { srgb = true, repeat = true } = {}) {
    if (!textureCache.has(url)) {
        textureLoader ??= new THREE.TextureLoader();
        const texture = textureLoader.load(url, undefined, undefined, (error) => console.warn(`Failed to load texture ${url}:`, error));
        if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
        textureCache.set(url, texture);
    }
    return textureCache.get(url);
}

// Adds the entity's local darkness plus wall/floor shading to a level material.
export function enhanceMaterialWithDarkness(material) {
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

export async function loadBacteriaModel() {
    if (bacteriaModel) return;
    const scene = await loadGltfScene('/models/bacteria_-_kane_pixels_backrooms.glb');
    if (!scene) return;
    bacteriaModel = scene;
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
}
