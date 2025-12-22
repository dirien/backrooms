import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * BACKROOMS - Level 0: The Lobby
 */

let scene, camera, renderer, composer, clock;
let wakeupPass = null;
let wakeupStartTime = -1;
const WAKEUP_DURATION = 2.0; // seconds
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let velocity = new THREE.Vector3();
let chunks = new Map();
let walls = [];
let lightPanels = [];
let phonePositions = []; // Track phone positions for audio
let playerSanity = 100;
let isStarted = false;
let debugMode = false;
let debugNormals = [];
let chunkBorders = [];
let debugSanityOverride = -1; // -1 means no override, 0-4 are the sanity levels

let fpsFrames = 0;
let fpsPrevTime = performance.now();

// Shared Resources
let wallMat, floorMat, ceilingMat;
let wallGeoV, wallGeoH, floorGeo, ceilingGeo, lightPanelGeo, lightPanelMat;
let outletModel = null;
let wallPhoneModel = null;
let gltfLoader;

const CHUNK_SIZE = 24;
const RENDER_DIST = 2;
const PRELOAD_DIST = 4; // Larger distance for preloading potentially visible chunks
const PLAYER_RADIUS = 0.5;
const PHONE_EXCLUSION_DIST = 4; // No phones within this many chunks from spawn (0,0)

// Frustum for visibility checks
let frustum = new THREE.Frustum();
let frustumMatrix = new THREE.Matrix4();

let audioCtx;

// Wall shader with baked ambient occlusion at edges
const WALL_SHADER = {
    uniforms: {
        "wallTexture": { value: null },
        "aoStrength": { value: 0.4 }  // How dark the edges get
    },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;
        void main() {
            vUv = uv;
            vLocalPos = position;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D wallTexture;
        uniform float aoStrength;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;

        void main() {
            vec4 texColor = texture2D(wallTexture, vUv);

            // Calculate AO based on distance from top/bottom edges
            // Wall geometry is centered, so local y goes from -1.5 to +1.5
            // Normalize to 0-1 range
            float heightNorm = (vLocalPos.y + 1.5) / 3.0;  // 0 at bottom, 1 at top

            // Darken near floor (heightNorm=0) and ceiling (heightNorm=1)
            float floorAO = smoothstep(0.0, 0.2, heightNorm);   // Dark at bottom 20%
            float ceilAO = smoothstep(1.0, 0.8, heightNorm);    // Dark at top 20%
            float ao = min(floorAO, ceilAO);

            // Apply AO - darker at edges
            vec3 finalColor = texColor.rgb * mix(1.0 - aoStrength, 1.0, ao);

            gl_FragColor = vec4(finalColor, texColor.a);
        }
    `
};

// Wake-up eye opening shader effect
const WAKEUP_SHADER = {
    uniforms: {
        "tDiffuse": { value: null },
        "eyeOpen": { value: 0.0 },  // 0 = closed, 1 = fully open
        "blurAmount": { value: 1.0 },  // 1 = full blur, 0 = no blur
        "effectOpacity": { value: 1.0 }  // 1 = full effect, 0 = no effect (passthrough)
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float eyeOpen;
        uniform float blurAmount;
        uniform float effectOpacity;
        varying vec2 vUv;

        void main() {
            vec2 uv = vUv;
            vec2 center = vec2(0.5, 0.5);
            vec2 centered = uv - center;

            // Get original color for blending at the end
            vec4 original = texture2D(tDiffuse, uv);

            // Blur effect (simple box blur approximation)
            vec4 col = vec4(0.0);
            float blurSize = blurAmount * 0.02;
            col += texture2D(tDiffuse, uv + vec2(-blurSize, -blurSize)) * 0.0625;
            col += texture2D(tDiffuse, uv + vec2(0.0, -blurSize)) * 0.125;
            col += texture2D(tDiffuse, uv + vec2(blurSize, -blurSize)) * 0.0625;
            col += texture2D(tDiffuse, uv + vec2(-blurSize, 0.0)) * 0.125;
            col += texture2D(tDiffuse, uv) * 0.25;
            col += texture2D(tDiffuse, uv + vec2(blurSize, 0.0)) * 0.125;
            col += texture2D(tDiffuse, uv + vec2(-blurSize, blurSize)) * 0.0625;
            col += texture2D(tDiffuse, uv + vec2(0.0, blurSize)) * 0.125;
            col += texture2D(tDiffuse, uv + vec2(blurSize, blurSize)) * 0.0625;

            // Eye shape - elliptical opening
            // Aspect ratio correction for eye shape (wider than tall)
            float aspectRatio = 2.5;
            vec2 eyeCoord = vec2(centered.x, centered.y * aspectRatio);
            float eyeDist = length(eyeCoord);

            // Create eyelid curve - eye opening grows with eyeOpen
            // The visible area is an ellipse that grows from center
            float eyeRadius = eyeOpen * 0.8;  // Max radius when fully open

            // Smooth edge for eyelids
            float edgeSoftness = 0.05 + (1.0 - eyeOpen) * 0.1;
            float eyeMask = smoothstep(eyeRadius, eyeRadius - edgeSoftness, eyeDist);

            // Darken everything outside the eye opening
            col.rgb = mix(vec3(0.0), col.rgb, eyeMask);

            // Add slight darkening at the edges of the eye opening (eyelid shadow)
            float shadowMask = smoothstep(eyeRadius - edgeSoftness * 2.0, eyeRadius, eyeDist);
            col.rgb *= mix(1.0, 0.7, shadowMask * (1.0 - eyeOpen * 0.5));

            // Blend between effect and original based on effectOpacity
            gl_FragColor = mix(original, col, effectOpacity);
        }
    `
};

const POST_SHADER = {
    uniforms: {
        "tDiffuse": { value: null },
        "time": { value: 0.0 },
        "sanity": { value: 1.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float sanity;
        varying vec2 vUv;

        float random(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = random(i);
            float b = random(i + vec2(1.0, 0.0));
            float c = random(i + vec2(0.0, 1.0));
            float d = random(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
            vec2 uv = vUv;
            float sFac = clamp(1.0 - sanity, 0.0, 1.0);
            vec2 centeredUv = uv - 0.5;
            float d = length(centeredUv);

            // === LEVEL 1: sanity <= 80% - Subtle wave distortion ===
            float level1 = smoothstep(0.8, 0.7, sanity);
            float wave1 = sin(uv.y * 15.0 + time * 2.0) * 0.003 * level1;
            uv.x += wave1;

            // === LEVEL 2: sanity <= 50% - Chromatic aberration + stronger waves ===
            float level2 = smoothstep(0.5, 0.4, sanity);
            float wave2 = sin(uv.x * 20.0 + time * 3.0) * cos(uv.y * 10.0 + time) * 0.006 * level2;
            uv += vec2(wave2, wave2 * 0.5);

            // === LEVEL 3: sanity <= 30% - Tunnel vision + pulsing + heavy distortion ===
            float level3 = smoothstep(0.3, 0.2, sanity);
            float pulse = sin(time * 4.0) * 0.5 + 0.5;
            float tunnel = d * d * 0.15 * level3 * (1.0 + pulse * 0.3);
            uv += centeredUv * tunnel;

            // Spiral distortion
            float angle = atan(centeredUv.y, centeredUv.x);
            float spiral = sin(angle * 3.0 + time * 2.0 + d * 10.0) * 0.008 * level3;
            uv += vec2(cos(angle), sin(angle)) * spiral;

            // === LEVEL 4: sanity <= 10% - Complete insanity ===
            float level4 = smoothstep(0.1, 0.0, sanity);

            // Violent screen shake
            float shake = level4 * 0.02;
            uv.x += (random(vec2(time * 10.0, 0.0)) - 0.5) * shake;
            uv.y += (random(vec2(0.0, time * 10.0)) - 0.5) * shake;

            // Reality fracturing - multiple image displacement
            float fracture = sin(time * 8.0 + uv.y * 30.0) * 0.015 * level4;
            uv.x += fracture;

            // Kaleidoscope effect
            if (level4 > 0.5) {
                float kAngle = atan(centeredUv.y, centeredUv.x);
                float kDist = length(centeredUv);
                kAngle = mod(kAngle + time * 0.5, 3.14159 / 3.0) - 3.14159 / 6.0;
                vec2 kUv = vec2(cos(kAngle), sin(kAngle)) * kDist + 0.5;
                uv = mix(uv, kUv, level4 * 0.3);
            }

            // Base barrel distortion
            uv += centeredUv * d * d * 0.04;

            // Base sanity warp (original)
            float warp = sin(uv.x * 10.0 + time) * 0.002 * sFac;
            uv.y += warp;

            // Sample the texture
            vec4 col = texture2D(tDiffuse, uv);

            // === Chromatic aberration (levels 2-4) ===
            float chromaStrength = level2 * 0.008 + level3 * 0.015 + level4 * 0.03;
            if (chromaStrength > 0.0) {
                vec2 chromaDir = normalize(centeredUv) * chromaStrength;
                col.r = texture2D(tDiffuse, uv + chromaDir).r;
                col.b = texture2D(tDiffuse, uv - chromaDir).b;
            }

            // === Film grain (increases with insanity) ===
            float grain = (random(uv + time) - 0.5) * (0.05 + sFac * 0.15);
            col.rgb += grain;

            // === Color shifts ===
            // Level 2+: Slight color desaturation and green tint
            float gray = dot(col.rgb, vec3(0.299, 0.587, 0.114));
            col.rgb = mix(col.rgb, vec3(gray), sFac * 0.4);
            col.g += level2 * 0.03; // Sickly green tint

            // Level 3+: Color cycling
            if (level3 > 0.0) {
                vec3 tint = vec3(
                    sin(time * 1.5) * 0.5 + 0.5,
                    sin(time * 1.5 + 2.094) * 0.5 + 0.5,
                    sin(time * 1.5 + 4.188) * 0.5 + 0.5
                );
                col.rgb = mix(col.rgb, col.rgb * tint, level3 * 0.2);
            }

            // Level 4: Intense color inversion flashes
            if (level4 > 0.0) {
                float flash = step(0.95, random(vec2(floor(time * 8.0), 0.0)));
                col.rgb = mix(col.rgb, 1.0 - col.rgb, flash * level4);
            }

            // === Vignette (gets stronger and pulses) ===
            float vignetteBase = smoothstep(1.0, 0.35, d);
            float vignettePulse = level3 > 0.0 ? (sin(time * 3.0) * 0.1 + 0.9) : 1.0;
            float vignetteStrength = vignetteBase * vignettePulse;
            vignetteStrength = mix(vignetteStrength, vignetteStrength * 0.7, level4); // Darker at low sanity
            col.rgb *= vignetteStrength;

            // === Scan lines (level 4) ===
            if (level4 > 0.0) {
                float scanline = sin(vUv.y * 400.0 + time * 50.0) * 0.5 + 0.5;
                col.rgb *= 1.0 - scanline * 0.15 * level4;
            }

            // === Double vision (level 3+) ===
            if (level3 > 0.0) {
                vec2 offset = vec2(0.01 + level4 * 0.02, 0.005) * (sin(time * 2.0) * 0.5 + 0.5);
                vec4 ghost = texture2D(tDiffuse, uv + offset);
                col.rgb = mix(col.rgb, ghost.rgb, level3 * 0.25);
            }

            gl_FragColor = col;
        }
    `
};

// Create wall geometry with proper UV mapping based on real-world dimensions
function createWallGeometry(width, height, depth) {
    const geo = new THREE.BoxGeometry(width, height, depth);
    const uvAttribute = geo.attributes.uv;
    const posAttribute = geo.attributes.position;
    const normalAttribute = geo.attributes.normal;

    // Scale factor for texture (how many units per texture repeat)
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
            // Left/Right faces (X normal) - use Z and Y
            u = (z + depth / 2) / texScale;
            v = (y + height / 2) / texScale;
        } else if (Math.abs(nz) > 0.5) {
            // Front/Back faces (Z normal) - use X and Y
            u = (x + width / 2) / texScale;
            v = (y + height / 2) / texScale;
        } else {
            // Top/Bottom faces (Y normal) - use X and Z
            u = (x + width / 2) / texScale;
            v = (z + depth / 2) / texScale;
        }

        uvAttribute.setXY(i, u, v);
    }

    uvAttribute.needsUpdate = true;
    return geo;
}

// Procedural carpet shader - creates fiber texture pattern
const CARPET_SHADER = {
    uniforms: {
        "baseColor": { value: new THREE.Color(0xa9a865) },  // Yellow-green base
        "fiberScale": { value: 80.0 },  // Density of carpet fibers
        "fiberIntensity": { value: 0.15 }  // How visible the fibers are
    },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
            vUv = uv;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 baseColor;
        uniform float fiberScale;
        uniform float fiberIntensity;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        // Hash functions for procedural noise
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float hash2(vec2 p) {
            return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453);
        }

        // Value noise
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
            // Use world position for seamless tiling across chunks
            vec2 carpetUv = vWorldPos.xz * fiberScale;

            // Create carpet fiber pattern - multiple layers of noise
            float fiber1 = noise(carpetUv);
            float fiber2 = noise(carpetUv * 2.3 + 17.0);
            float fiber3 = noise(carpetUv * 4.7 + 31.0);

            // Combine for carpet texture
            float fibers = fiber1 * 0.5 + fiber2 * 0.3 + fiber3 * 0.2;

            // Add slight color variation to simulate different fiber directions
            float colorVar = noise(carpetUv * 0.5) * 0.08;

            // Apply fiber darkness/lightness variation
            vec3 carpetColor = baseColor;
            carpetColor *= 1.0 + (fibers - 0.5) * fiberIntensity;
            carpetColor *= 1.0 + (colorVar - 0.04);

            gl_FragColor = vec4(carpetColor, 1.0);
        }
    `
};

// Load ceiling tile texture from image file
function loadCeilingTexture(textureLoader) {
    const ceilTex = textureLoader.load('/graphics/ceiling-tile.png');
    ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;
    // The image shows a 2x2 grid of tiles, so we scale accordingly
    // Each tile in the image represents one ceiling panel
    return ceilTex;
}

function createGlobalResources() {
    // WALL TEXTURE - Load from file
    const textureLoader = new THREE.TextureLoader();
    const wallTex = textureLoader.load('/graphics/wallpaper.png');
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(1, 1);

    // Load ceiling tile texture from image (per-chunk tiling)
    const ceilTex = loadCeilingTexture(textureLoader);
    const tileWorldSize = 1.5;
    ceilTex.repeat.set(CHUNK_SIZE / tileWorldSize, CHUNK_SIZE / tileWorldSize);

    // Wall material - Lambert is faster and less finicky than Standard
    wallMat = new THREE.MeshLambertMaterial({
        map: wallTex,
        side: THREE.FrontSide
    });

    // Floor material
    floorMat = new THREE.MeshLambertMaterial({
        color: 0xa9a865, 
        side: THREE.FrontSide
    });

    // Ceiling tiles
    ceilingMat = new THREE.MeshStandardMaterial({
        map: ceilTex,
        roughness: 0.95,
        metalness: 0,
        color: 0xbbbbbb,
        side: THREE.DoubleSide
    });
    lightPanelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const gSize = 3;
    const cellSize = CHUNK_SIZE / gSize;
    lightPanelGeo = new THREE.PlaneGeometry(cellSize * 0.4, cellSize * 0.2);

    // Create wall geometries with proper UV mapping
    const wallThickness = 0.3;
    const wallHeight = 3;
    const wallLengthV = cellSize + 0.31;
    const wallLengthH = cellSize - 0.01;

    wallGeoV = createWallGeometry(wallThickness, wallHeight, wallLengthV);
    wallGeoH = createWallGeometry(wallLengthH, wallHeight, wallThickness);

    // Floor and ceiling geometry for per-chunk tiles
    floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    ceilingGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);

    // Initialize GLTF loader
    gltfLoader = new GLTFLoader();
}

// Load outlet model - returns a promise
function loadOutletModel() {
    return new Promise((resolve) => {
        gltfLoader.load('/models/wall_outlet_american.glb', (gltf) => {
            outletModel = gltf.scene;
            outletModel.scale.set(0.75, 0.75, 0.75);

            // Apply bright white material to all meshes, preserving texture if present
            outletModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
                    if (child.material.map) {
                        // Preserve texture
                        child.material.metalness = 0;
                        child.material.roughness = 0.4;
                        child.material.color = new THREE.Color(0xffffff);
                        child.material.emissive = new THREE.Color(0x222222); // Subtle glow to show texture
                        child.material.needsUpdate = true;
                    } else {
                        // No texture, use bright white material
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
            resolve(); // Resolve anyway so game can continue without outlets
        });
    });
}

// Load wall phone model - returns a promise
function loadWallPhoneModel() {
    return new Promise((resolve) => {
        gltfLoader.load('/models/corded_public_phone_-_low_poly.glb', (gltf) => {
            wallPhoneModel = gltf.scene;
            wallPhoneModel.scale.set(0.05, 0.05, 0.05);

            // Enable shadows and fix materials
            wallPhoneModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // Preserve texture if it exists, but reset PBR values
                    if (child.material.map) {
                        child.material.metalness = 0;
                        child.material.roughness = 0.5;
                        child.material.emissive = new THREE.Color(0x222222); // Subtle glow
                        child.material.needsUpdate = true;
                    }
                }
            });

            console.log('Wall phone model loaded');
            resolve();
        }, undefined, (error) => {
            console.warn('Failed to load wall phone model:', error);
            resolve(); // Resolve anyway so game can continue without phones
        });
    });
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

// Toggle debug mode visibility
function toggleDebugMode() {
    debugMode = !debugMode;
    debugNormals.forEach(line => {
        line.visible = debugMode;
    });
    chunkBorders.forEach(border => {
        border.visible = debugMode;
    });
    if (!debugMode) {
        debugSanityOverride = -1; // Reset sanity override when exiting debug mode
    }
    console.log('Debug mode:', debugMode ? 'ON' : 'OFF');
}

// Cycle through sanity levels for debugging (only works in debug mode)
const DEBUG_SANITY_LEVELS = [100, 80, 50, 30, 10, 0]; // Normal, then thresholds
function cycleSanityLevel(direction) {
    if (!debugMode) return;

    if (debugSanityOverride === -1) {
        // First time cycling - find closest level to current sanity
        debugSanityOverride = 0;
    } else {
        debugSanityOverride += direction;
        if (debugSanityOverride < 0) debugSanityOverride = DEBUG_SANITY_LEVELS.length - 1;
        if (debugSanityOverride >= DEBUG_SANITY_LEVELS.length) debugSanityOverride = 0;
    }

    playerSanity = DEBUG_SANITY_LEVELS[debugSanityOverride];
    console.log('Debug sanity level:', playerSanity + '%');
}

// Create chunk border visualization (transparent red walls)
function createChunkBorder(cx, cz) {
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

    // Create 4 walls for the chunk border
    // North wall (positive Z edge)
    const northGeo = new THREE.PlaneGeometry(CHUNK_SIZE, height);
    const north = new THREE.Mesh(northGeo, borderMat);
    north.position.set(0, height / 2, halfSize);
    group.add(north);

    // South wall (negative Z edge)
    const south = new THREE.Mesh(northGeo, borderMat);
    south.position.set(0, height / 2, -halfSize);
    south.rotation.y = Math.PI;
    group.add(south);

    // East wall (positive X edge)
    const eastGeo = new THREE.PlaneGeometry(CHUNK_SIZE, height);
    const east = new THREE.Mesh(eastGeo, borderMat);
    east.position.set(halfSize, height / 2, 0);
    east.rotation.y = -Math.PI / 2;
    group.add(east);

    // West wall (negative X edge)
    const west = new THREE.Mesh(eastGeo, borderMat);
    west.position.set(-halfSize, height / 2, 0);
    west.rotation.y = Math.PI / 2;
    group.add(west);

    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    group.visible = debugMode;

    return group;
}

function generateChunk(cx, cz) {
    const group = new THREE.Group();
    const seed = (cx * 12345) ^ (cz * 54321);
    const rnd = (s) => (Math.abs(Math.sin(s) * 10000) % 1);

    // Floor tile for this chunk
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();
    floor.receiveShadow = true; // Floor receives shadows
    group.add(floor);

    // Ceiling tile for this chunk
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 3.01, 0); // Slightly above light panels (at 2.99)
    ceiling.matrixAutoUpdate = false;
    ceiling.updateMatrix();
    group.add(ceiling);

    // Walls and lights
    const gSize = 3;
    const cellSize = CHUNK_SIZE / gSize;
    for (let i = 0; i <= gSize; i++) {
        const pos = -CHUNK_SIZE / 2 + i * cellSize;
        for (let j = 0; j < gSize; j++) {
            if (rnd(seed + i * 7 + j) > 0.65) {
                const wall = new THREE.Mesh(wallGeoV, wallMat);
                wall.position.set(pos, 1.5, -CHUNK_SIZE / 2 + j * cellSize + cellSize / 2);
                wall.matrixAutoUpdate = false;
                wall.updateMatrix();
                wall.castShadow = true;    // Walls cast shadows
                wall.receiveShadow = true; // Walls receive shadows
                group.add(wall); walls.push(wall);
            }
            if (rnd(seed + i * 13 + j) > 0.65) {
                const wall = new THREE.Mesh(wallGeoH, wallMat);
                wall.position.set(-CHUNK_SIZE / 2 + j * cellSize + cellSize / 2, 1.5, pos);
                wall.matrixAutoUpdate = false;
                wall.updateMatrix();
                wall.castShadow = true;
                wall.receiveShadow = true;
                group.add(wall); walls.push(wall);
            }
        }
    }

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

    // Simplified: No per-chunk lights. Rely on Ambient + Camera Light.
    // This fixes the 12 FPS issue and the "pitch black" shadows.

    // Create debug normal lines for walls (visible when debug mode is on)
    const normalLineMat = new THREE.LineBasicMaterial({ color: 0xff0000 });

    // Store wall info for outlet placement later
    const wallsInChunk = [];

    // Re-iterate to create debug normals and track walls
    for (let i = 0; i <= gSize; i++) {
        const pos = -CHUNK_SIZE / 2 + i * cellSize;
        for (let j = 0; j < gSize; j++) {
            // wallGeoV: thin in X (0.3), tall in Y (3), long in Z (~8)
            // Normals point +X and -X
            if (rnd(seed + i * 7 + j) > 0.65) {
                const wallZ = -CHUNK_SIZE / 2 + j * cellSize + cellSize / 2;
                const wallCenter = new THREE.Vector3(pos, 1.5, wallZ);

                // +X normal (right side of wall)
                const normalPlusX = createNormalLine(wallCenter, new THREE.Vector3(1, 0, 0), normalLineMat);
                normalPlusX.visible = false;
                group.add(normalPlusX);
                debugNormals.push(normalPlusX);

                // -X normal (left side of wall)
                const normalMinusX = createNormalLine(wallCenter, new THREE.Vector3(-1, 0, 0), normalLineMat);
                normalMinusX.visible = false;
                group.add(normalMinusX);
                debugNormals.push(normalMinusX);

                // Store wall info
                wallsInChunk.push({ center: wallCenter, type: 'V', normals: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)] });
            }

            // wallGeoH: long in X (~8), tall in Y (3), thin in Z (0.3)
            // Normals point +Z and -Z
            if (rnd(seed + i * 13 + j) > 0.65) {
                const wallX = -CHUNK_SIZE / 2 + j * cellSize + cellSize / 2;
                const wallCenter = new THREE.Vector3(wallX, 1.5, pos);

                // +Z normal (front side of wall)
                const normalPlusZ = createNormalLine(wallCenter, new THREE.Vector3(0, 0, 1), normalLineMat);
                normalPlusZ.visible = false;
                group.add(normalPlusZ);
                debugNormals.push(normalPlusZ);

                // -Z normal (back side of wall)
                const normalMinusZ = createNormalLine(wallCenter, new THREE.Vector3(0, 0, -1), normalLineMat);
                normalMinusZ.visible = false;
                group.add(normalMinusZ);
                debugNormals.push(normalMinusZ);

                // Store wall info
                wallsInChunk.push({ center: wallCenter, type: 'H', normals: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)] });
            }
        }
    }

    // Add outlets randomly to walls (max one per wall)
    if (outletModel) {
        for (const wallInfo of wallsInChunk) {
            // 5% chance to add an outlet to this wall
            const wallSeed = seed + wallInfo.center.x * 1000 + wallInfo.center.z * 2000;
            if (rnd(wallSeed) > 0.05) continue;

            // Pick one side of the wall only
            const normalIndex = rnd(wallSeed + 1) > 0.5 ? 0 : 1;
            const normal = wallInfo.normals[normalIndex];

            const outlet = outletModel.clone();

            // Position outlet at fixed height from ground
            const outletHeight = 0.2;

            // Offset along wall length
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

            // Rotate so Blue axis (Z) aligns with wall normal, Green axis (Y) stays up
            // Default: red=+X, green=+Y, blue=+Z
            if (normal.x > 0.5) {
                // Normal +X: rotate +90° around Y (Blue points to +X)
                outlet.rotation.y = Math.PI / 2;
            } else if (normal.x < -0.5) {
                // Normal -X: rotate -90° around Y (Blue points to -X)
                outlet.rotation.y = -Math.PI / 2;
            } else if (normal.z > 0.5) {
                // Normal +Z: no rotation needed (Blue points to +Z)
                outlet.rotation.y = 0;
            } else {
                // Normal -Z: rotate 180° around Y (Blue points to -Z)
                outlet.rotation.y = Math.PI;
            }

            // Add axes helper for debugging
            const axes = new THREE.AxesHelper(0.5);
            axes.visible = debugMode;
            outlet.add(axes);
            debugNormals.push(axes);

            group.add(outlet);
        }
    }

    // Add wall phones very rarely to walls (0.5% chance - very rare!)
    // Phones never spawn within PHONE_EXCLUSION_DIST chunks of the start point (0,0)
    const chunkDistFromSpawn = Math.max(Math.abs(cx), Math.abs(cz));
    const phonesAllowed = chunkDistFromSpawn >= PHONE_EXCLUSION_DIST;

    if (wallPhoneModel && phonesAllowed) {
        for (const wallInfo of wallsInChunk) {
            // Use different seed offset to avoid correlation with outlet placement
            const phoneSeed = seed + wallInfo.center.x * 3000 + wallInfo.center.z * 4000 + 12345;
            // 0.5% chance - very rare
            if (rnd(phoneSeed) > 0.005) continue;

            // Pick one side of the wall only
            const normalIndex = rnd(phoneSeed + 1) > 0.5 ? 0 : 1;
            const normal = wallInfo.normals[normalIndex];

            const phone = wallPhoneModel.clone();

            // Position phone at eye level on wall
            const phoneHeight = 1.7;

            // Offset along wall length
            let offsetX = 0, offsetZ = 0;
            if (wallInfo.type === 'V') {
                offsetZ = (rnd(phoneSeed + 3) - 0.5) * 5;
            } else {
                offsetX = (rnd(phoneSeed + 3) - 0.5) * 5;
            }

            const phoneX = wallInfo.center.x + offsetX + normal.x * 0.15;
            const phoneZ = wallInfo.center.z + offsetZ + normal.z * 0.15;

            phone.position.set(phoneX, phoneHeight, phoneZ);

            // Rotate phone: first stand upright (Z rotation), then align with wall normal (Y rotation)
            phone.rotation.z = -Math.PI / 2; // Stand upright

            // Rotate Y to align green axis with wall normal direction
            if (normal.x > 0.5) {
                // Normal +X
                phone.rotation.y = 0;
            } else if (normal.x < -0.5) {
                // Normal -X
                phone.rotation.y = Math.PI;
            } else if (normal.z > 0.5) {
                // Normal +Z
                phone.rotation.y = -Math.PI / 2;
            } else {
                // Normal -Z
                phone.rotation.y = Math.PI / 2;
            }

            group.add(phone);

            // Track phone world position for audio (chunk offset + local position)
            const worldPhonePos = new THREE.Vector3(
                cx * CHUNK_SIZE + phoneX,
                phoneHeight,
                cz * CHUNK_SIZE + phoneZ
            );
            phonePositions.push(worldPhonePos);
            // Store reference to remove when chunk unloads
            if (!group.userData.phonePositions) group.userData.phonePositions = [];
            group.userData.phonePositions.push(worldPhonePos);
        }
    }

    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    scene.add(group);

    // Create and add chunk border visualization
    const border = createChunkBorder(cx, cz);
    scene.add(border);
    chunkBorders.push(border);
    group.userData.border = border;

    return group;
}

function handleCollision(target) {
    const pBox = new THREE.Box3().setFromCenterAndSize(target, new THREE.Vector3(PLAYER_RADIUS * 2, 1.8, PLAYER_RADIUS * 2));
    for (let i = 0; i < walls.length; i++) {
        const wBox = new THREE.Box3().setFromObject(walls[i]);
        if (pBox.intersectsBox(wBox)) {
            const overlap = new THREE.Box3().copy(pBox).intersect(wBox);
            const size = new THREE.Vector3(); overlap.getSize(size);
            const wPos = new THREE.Vector3(); walls[i].getWorldPosition(wPos);
            if (size.x < size.z) target.x += (target.x > wPos.x ? 1 : -1) * size.x;
            else target.z += (target.z > wPos.z ? 1 : -1) * size.z;
        }
    }
}

// Check if a chunk could potentially be visible
// Uses a bounding box for the chunk and checks against the camera frustum
function isChunkPotentiallyVisible(cx, cz) {
    const chunkCenterX = cx * CHUNK_SIZE;
    const chunkCenterZ = cz * CHUNK_SIZE;

    // Create bounding box for the chunk (full height from floor to ceiling)
    const halfSize = CHUNK_SIZE / 2;
    const chunkBox = new THREE.Box3(
        new THREE.Vector3(chunkCenterX - halfSize, 0, chunkCenterZ - halfSize),
        new THREE.Vector3(chunkCenterX + halfSize, 3, chunkCenterZ + halfSize)
    );

    return frustum.intersectsBox(chunkBox);
}

// Check if chunk is within immediate proximity (always render regardless of view direction)
function isChunkNearby(cx, cz, playerChunkX, playerChunkZ) {
    const dx = Math.abs(cx - playerChunkX);
    const dz = Math.abs(cz - playerChunkZ);
    return dx <= RENDER_DIST && dz <= RENDER_DIST;
}

// Check if chunk is within preload distance (load but may not always render)
function isChunkInPreloadRange(cx, cz, playerChunkX, playerChunkZ) {
    const dx = Math.abs(cx - playerChunkX);
    const dz = Math.abs(cz - playerChunkZ);
    return dx <= PRELOAD_DIST && dz <= PRELOAD_DIST;
}

function updateChunks() {
    const px = Math.floor(camera.position.x / CHUNK_SIZE);
    const pz = Math.floor(camera.position.z / CHUNK_SIZE);

    // Update the frustum for visibility checks
    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(frustumMatrix);

    let activeKeys = new Set();

    // First pass: load all chunks within preload distance
    // This ensures chunks are ready before they become visible
    for (let x = px - PRELOAD_DIST; x <= px + PRELOAD_DIST; x++) {
        for (let z = pz - PRELOAD_DIST; z <= pz + PRELOAD_DIST; z++) {
            const k = `${x},${z}`;

            // Determine if this chunk should be loaded/kept
            const isNearby = isChunkNearby(x, z, px, pz);
            const isPotentiallyVisible = isChunkPotentiallyVisible(x, z);
            const inPreloadRange = isChunkInPreloadRange(x, z, px, pz);

            // Load chunk if:
            // 1. It's within immediate render distance (always load nearby chunks)
            // 2. It's potentially visible AND within preload range
            if (isNearby || (isPotentiallyVisible && inPreloadRange)) {
                activeKeys.add(k);
                if (!chunks.has(k)) {
                    chunks.set(k, generateChunk(x, z));
                }
            }
        }
    }

    // Second pass: unload chunks that are no longer needed
    for (const [key, obj] of chunks.entries()) {
        if (!activeKeys.has(key)) {
            scene.remove(obj);
            walls = walls.filter(w => !obj.children.includes(w));
            lightPanels = lightPanels.filter(p => !obj.children.includes(p));
            // Clean up phone positions from this chunk
            if (obj.userData.phonePositions) {
                phonePositions = phonePositions.filter(p => !obj.userData.phonePositions.includes(p));
            }
            // Clean up chunk border
            if (obj.userData.border) {
                scene.remove(obj.userData.border);
                chunkBorders = chunkBorders.filter(b => b !== obj.userData.border);
            }
            chunks.delete(key);
        }
    }
}

// --- PHANTOM SOUNDS SYSTEM ---

let footstepsBuffer = null;
let doorCloseBuffer = null;
let humBuffer = null;
let humGainNode = null;
let humSource = null;

// Phone ringing audio
let phoneRingBuffer = null;
let phoneRingSource = null;
let phoneRingGainNode = null;
const PHONE_AUDIO_CLOSE_DIST = 5; // Distance for maximum volume (very close)
const PHONE_AUDIO_MAX_DIST = CHUNK_SIZE * 3; // Maximum hearing distance (3 chunks)

async function loadAmbientSounds() {
    try {
        const [footstepsResponse, doorResponse, humResponse, phoneRingResponse] = await Promise.all([
            fetch('/sounds/footsteps.mp3'),
            fetch('/sounds/door-close.mp3'),
            fetch('/sounds/light-hum.mp3'),
            fetch('/sounds/phone-ring.mp3')
        ]);
        const [footstepsArrayBuffer, doorArrayBuffer, humArrayBuffer, phoneRingArrayBuffer] = await Promise.all([
            footstepsResponse.arrayBuffer(),
            doorResponse.arrayBuffer(),
            humResponse.arrayBuffer(),
            phoneRingResponse.arrayBuffer()
        ]);
        footstepsBuffer = await audioCtx.decodeAudioData(footstepsArrayBuffer);
        doorCloseBuffer = await audioCtx.decodeAudioData(doorArrayBuffer);
        humBuffer = await audioCtx.decodeAudioData(humArrayBuffer);
        phoneRingBuffer = await audioCtx.decodeAudioData(phoneRingArrayBuffer);
        console.log('Ambient sounds loaded successfully');

        // Start the looping hum sound
        startHumSound();
        // Start the phone ringing sound (will only play when near phones)
        startPhoneRingSound();
    } catch (e) {
        console.warn('Failed to load ambient sounds:', e);
    }
}

function startHumSound() {
    if (!humBuffer || !audioCtx) return;

    humSource = audioCtx.createBufferSource();
    humSource.buffer = humBuffer;
    humSource.loop = true;

    humGainNode = audioCtx.createGain();
    humGainNode.gain.value = 0.1; // Base volume (quieter when not near lights)

    humSource.connect(humGainNode);
    humGainNode.connect(audioCtx.destination);
    humSource.start();
}

function startPhoneRingSound() {
    if (!phoneRingBuffer || !audioCtx) return;

    phoneRingSource = audioCtx.createBufferSource();
    phoneRingSource.buffer = phoneRingBuffer;
    phoneRingSource.loop = true;

    phoneRingGainNode = audioCtx.createGain();
    phoneRingGainNode.gain.value = 0; // Start silent, will increase when near phones

    phoneRingSource.connect(phoneRingGainNode);
    phoneRingGainNode.connect(audioCtx.destination);
    phoneRingSource.start();
}

function updatePhoneRingVolume() {
    if (!phoneRingGainNode || !camera || phonePositions.length === 0) {
        // No phones nearby, ensure silence
        if (phoneRingGainNode) {
            phoneRingGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        }
        return;
    }

    // Find distance to nearest phone
    let minDist = Infinity;
    const playerPos = camera.position;

    for (const phonePos of phonePositions) {
        const dist = playerPos.distanceTo(phonePos);
        if (dist < minDist) minDist = dist;
    }

    // Calculate volume with smooth distance falloff
    // Very quiet far away, only loud when very close
    let volume = 0;

    if (minDist > PHONE_AUDIO_MAX_DIST) {
        // Too far, no sound
        volume = 0;
    } else if (minDist <= PHONE_AUDIO_CLOSE_DIST) {
        // Very close - full volume
        volume = 1.0;
    } else {
        // Use inverse-square-like falloff for realistic audio attenuation
        // Normalized distance from close range to max range
        const normalizedDist = (minDist - PHONE_AUDIO_CLOSE_DIST) / (PHONE_AUDIO_MAX_DIST - PHONE_AUDIO_CLOSE_DIST);
        // Inverse square falloff: volume drops quickly with distance
        // Using (1 - normalizedDist)^3 for even more dramatic falloff
        volume = Math.pow(1 - normalizedDist, 3);
    }

    phoneRingGainNode.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.1);
}

function updateHumVolume() {
    if (!humGainNode || !camera || lightPanels.length === 0) return;

    // Find distance to nearest light panel
    let minDist = Infinity;
    const playerPos = camera.position;

    for (const panel of lightPanels) {
        const panelWorldPos = new THREE.Vector3();
        panel.getWorldPosition(panelWorldPos);
        const dist = playerPos.distanceTo(panelWorldPos);
        if (dist < minDist) minDist = dist;
    }

    // Volume increases when closer to light panels
    // Base volume: 0.15 (when far), max volume under light: 0.6
    const maxDist = 5; // Distance at which volume is at minimum
    const proximity = Math.max(0, 1 - (minDist / maxDist));
    const volume = 0.15 + proximity * 0.45;

    humGainNode.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.1);
}

function playAmbientFootsteps() {
    if (!isStarted || !audioCtx || !footstepsBuffer) {
        setTimeout(playAmbientFootsteps, 2000);
        return;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const source = audioCtx.createBufferSource();
    source.buffer = footstepsBuffer;

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = (Math.random() * 2) - 1;

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0.3 + Math.random() * 0.5;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600 + Math.random() * 800;

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(audioCtx.destination);

    source.start();

    const nextFootsteps = 8000 + Math.random() * 17000;
    setTimeout(playAmbientFootsteps, nextFootsteps);
}

function playAmbientDoorClose() {
    if (!isStarted || !audioCtx || !doorCloseBuffer) {
        setTimeout(playAmbientDoorClose, 2000);
        return;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const source = audioCtx.createBufferSource();
    source.buffer = doorCloseBuffer;

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = (Math.random() * 2) - 1;

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0.2 + Math.random() * 0.4; // Slightly quieter than footsteps

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400 + Math.random() * 600; // More muffled for distant door

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(audioCtx.destination);

    source.start();

    // Doors close less frequently than footsteps (15-40 seconds)
    const nextDoor = 15000 + Math.random() * 25000;
    setTimeout(playAmbientDoorClose, nextDoor);
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    fpsFrames++;
    const currentTime = performance.now();
    if (currentTime >= fpsPrevTime + 1000) {
        document.getElementById('fps-val').innerText = Math.round((fpsFrames * 1000) / (currentTime - fpsPrevTime));
        fpsFrames = 0;
        fpsPrevTime = currentTime;
    }

    if (document.pointerLockElement === renderer.domElement) {
        const speed = 4.0; const friction = 12.0;
        velocity.x -= velocity.x * friction * delta;
        velocity.z -= velocity.z * friction * delta;

        const input = new THREE.Vector3();
        if (moveForward) input.z -= 1; if (moveBackward) input.z += 1;
        if (moveLeft) input.x -= 1; if (moveRight) input.x += 1;
        input.normalize();

        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; fwd.normalize();
        const rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion); rgt.y = 0; rgt.normalize();

        const move = new THREE.Vector3().addScaledVector(fwd, -input.z).addScaledVector(rgt, input.x);
        velocity.addScaledVector(move, speed * friction * delta);

        const next = camera.position.clone().addScaledVector(velocity, delta);
        next.y = 1.7; handleCollision(next); camera.position.copy(next);

        // Only drain sanity if not in debug override mode
        if (debugSanityOverride === -1) {
            playerSanity -= delta * 0.5; // Much faster sanity drain
            playerSanity = Math.max(0, playerSanity);
        }

        // Update sanity bar
        const sanityBar = document.getElementById('sanity-bar');
        const sanityPercent = document.getElementById('sanity-percent');
        const uiOverlay = document.getElementById('ui-overlay');

        sanityBar.style.width = playerSanity + '%';
        sanityPercent.innerText = Math.round(playerSanity) + '%';

        // Shift gradient to show more red as sanity drops
        const gradientPos = 100 - (100 - playerSanity) * 1.5;
        sanityBar.style.backgroundPosition = Math.max(0, gradientPos) + '% 0';

        // Update CSS classes for visual effects
        uiOverlay.classList.remove('sanity-warning', 'sanity-low', 'sanity-critical');
        if (playerSanity <= 10) {
            uiOverlay.classList.add('sanity-critical');
        } else if (playerSanity <= 30) {
            uiOverlay.classList.add('sanity-low');
        } else if (playerSanity <= 50) {
            uiOverlay.classList.add('sanity-warning');
        }
    }

    updateChunks();
    updateHumVolume();
    updatePhoneRingVolume();

    composer.passes[2].uniforms.time.value = clock.elapsedTime;
    composer.passes[2].uniforms.sanity.value = playerSanity / 100;

    // Update wake-up eye opening animation
    if (wakeupPass && wakeupStartTime >= 0) {
        const elapsed = (performance.now() - wakeupStartTime) / 1000;
        const progress = Math.min(elapsed / WAKEUP_DURATION, 1.0);

        // Easing function with blink effect
        // Creates stuttering open-close-open pattern like struggling to wake up
        let eyeOpen;
        if (progress < 0.12) {
            // First blink attempt - opens slightly then closes
            eyeOpen = Math.sin(progress / 0.12 * Math.PI) * 0.2;
        } else if (progress < 0.25) {
            // Second attempt - opens more
            const p = (progress - 0.12) / 0.13;
            eyeOpen = Math.sin(p * Math.PI) * 0.35;
        } else if (progress < 0.45) {
            // Third attempt - opens wider then closes a bit
            const p = (progress - 0.25) / 0.2;
            eyeOpen = 0.25 + Math.sin(p * Math.PI) * 0.35;
        } else if (progress < 0.85) {
            // Final opening - smooth ease out to fully open
            const p = (progress - 0.45) / 0.4;
            const eased = 1 - Math.pow(1 - p, 3); // cubic ease out
            eyeOpen = 0.5 + eased * 0.5;
        } else {
            // Fade out phase - keep eye fully open, fade the effect
            eyeOpen = 1.0;
        }

        // Calculate effect opacity for smooth fade out at the end
        let effectOpacity = 1.0;
        if (progress > 0.7) {
            effectOpacity = 1.0 - ((progress - 0.7) / 0.3);
        }

        wakeupPass.uniforms.eyeOpen.value = eyeOpen;
        wakeupPass.uniforms.blurAmount.value = Math.max(0, (1.0 - progress * 1.5)) * effectOpacity;
        wakeupPass.uniforms.effectOpacity.value = effectOpacity;

        // Disable the pass once animation is complete
        if (progress >= 1.0) {
            wakeupPass.enabled = false;
            wakeupStartTime = -1;
        }
    }

    composer.render();
}

async function initGame() {
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('fps-counter').style.display = 'block';
    document.getElementById('crosshair').style.display = 'block';

    // Show UI after wake-up animation completes
    setTimeout(() => {
        document.getElementById('ui-overlay').style.display = 'block';
    }, WAKEUP_DURATION * 1000);

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    createGlobalResources();

    // Load models before generating chunks
    await Promise.all([
        loadOutletModel(),
        loadWallPhoneModel()
    ]);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050503);

    camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 400);
    camera.position.set(0, 1.7, 0);

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio > 1 ? 1 : window.devicePixelRatio);
    renderer.shadowMap.enabled = true; // Shadows enabled again
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    // Bloom pass for light panel glow effect
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.4,   // strength
        0.5,   // radius
        0.7    // threshold - only bright things (light panels) will bloom
    );
    composer.addPass(bloomPass);

    const effect = new ShaderPass(POST_SHADER);
    composer.addPass(effect);

    // Wake-up eye opening effect (added last so it's on top)
    wakeupPass = new ShaderPass(WAKEUP_SHADER);
    wakeupPass.uniforms.eyeOpen.value = 0.0;
    wakeupPass.uniforms.blurAmount.value = 1.0;
    wakeupPass.uniforms.effectOpacity.value = 1.0;
    composer.addPass(wakeupPass);

    // Start the wake-up animation
    wakeupStartTime = performance.now();

    clock = new THREE.Clock();
    
    // 1. Base Ambient Light - Significantly increased for high visibility
    scene.add(new THREE.AmbientLight(0xd7d3a2, 2.5));

    // 2. Player "Presence" Light - Subtler now that ambient is high
    const playerLight = new THREE.PointLight(0xffffee, 0.5, 10, 2);
    playerLight.position.set(0, 0, 0);
    camera.add(playerLight);
    scene.add(camera);

    // Fog: Reduced density and changed color to match the walls for a brighter look
    scene.fog = new THREE.FogExp2(0x333322, 0.02);

    document.addEventListener('keydown', (e) => {
        if (e.code === 'KeyW') moveForward = true; if (e.code === 'KeyA') moveLeft = true;
        if (e.code === 'KeyS') moveBackward = true; if (e.code === 'KeyD') moveRight = true;
        if (e.code === 'KeyO') toggleDebugMode();
        if (e.code === 'KeyN') cycleSanityLevel(-1); // Previous sanity level
        if (e.code === 'KeyM') cycleSanityLevel(1);  // Next sanity level
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'KeyW') moveForward = false; if (e.code === 'KeyA') moveLeft = false;
        if (e.code === 'KeyS') moveBackward = false; if (e.code === 'KeyD') moveRight = false;
    });

    const handleInteraction = () => {
        renderer.domElement.requestPointerLock();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    };
    document.addEventListener('mousedown', handleInteraction);

    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement === renderer.domElement) {
            camera.rotation.order = 'YXZ';
            camera.rotation.y -= e.movementX * 0.002;
            camera.rotation.x -= e.movementY * 0.002;
            camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
        }
    });

    // Audio Presence - Load all ambient sounds (hum starts automatically when loaded)
    loadAmbientSounds();
    setTimeout(playAmbientFootsteps, 3000);  // First footsteps after 3 seconds
    setTimeout(playAmbientDoorClose, 6000);  // First door close after 6 seconds

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });

    isStarted = true; updateChunks(); animate();
}

// Expose initGame globally for the HTML button
window.initGame = initGame;
