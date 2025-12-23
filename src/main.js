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
let hudScene, hudCamera;
let sanityBarBg, sanityBarFill, sanityLabelMesh, sanityPercentMesh;
let sanityLabelCanvas, sanityLabelCtx, sanityLabelTexture;
let sanityPercentCanvas, sanityPercentCtx, sanityPercentTexture;
let wakeupPass = null;
let wakeupStartTime = -1;
const WAKEUP_DURATION = 2.0; // seconds
let fadePass = null;
let fadeStartTime = -1;
const FADE_DURATION = 2.0; // seconds for fade to black
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

// Mobile touch controls
let isMobile = false;
let joystickInput = { x: 0, y: 0 };
let joystickActive = false;
let joystickTouchId = null;
let lookTouchId = null;
let lastLookPos = { x: 0, y: 0 };

// Shared Resources
let wallMat, floorMat, ceilingMat;
let wallGeoV, wallGeoH, floorGeo, ceilingGeo, lightPanelGeo, lightPanelMat;
let outletModel = null;
let wallPhoneModel = null;
let bacteriaModel = null; // Bacteria entity for horror appearances
let gltfLoader;

// Bacteria entity system
let bacteriaEntity = null; // The actual entity instance in the scene
let bacteriaVisible = false;
let bacteriaLastSpawnTime = 0;
let bacteriaNextSpawnDelay = 5000; // Time until next spawn attempt
let bacteriaVisibleDuration = 0; // How long entity stays visible
let bacteriaSpawnStartTime = 0;
let demoBacteriaEntity = null; // Demo entity for testing

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

// Fade to black shader for phone interaction
const FADE_SHADER = {
    uniforms: {
        "tDiffuse": { value: null },
        "fadeAmount": { value: 0.0 }  // 0 = no fade, 1 = fully black
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
        uniform float fadeAmount;
        varying vec2 vUv;

        void main() {
            vec4 col = texture2D(tDiffuse, vUv);
            col.rgb = mix(col.rgb, vec3(0.0), fadeAmount);
            gl_FragColor = col;
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

// Entity distortion shader - Digital glitch effect in black
const ENTITY_DISTORTION_SHADER = {
    uniforms: {
        "time": { value: 0.0 },
        "glitchIntensity": { value: 1.0 }
    },
    vertexShader: `
        uniform float time;
        uniform float glitchIntensity;

        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;

        float random(float x) {
            return fract(sin(x * 12.9898) * 43758.5453);
        }

        void main() {
            vNormal = normalMatrix * normal;
            vPosition = position;

            vec3 pos = position;

            // Horizontal slice glitch - random slices shift horizontally
            float sliceY = floor(pos.y * 20.0);
            float glitchTime = floor(time * 10.0);
            float sliceRand = random(sliceY + glitchTime);

            if (sliceRand > 0.88) {
                float offset = (random(sliceY * glitchTime) - 0.5) * 0.4 * glitchIntensity;
                pos.x += offset;
            }

            // Vertical slice glitch
            float sliceX = floor(pos.x * 15.0);
            float sliceRandX = random(sliceX + glitchTime * 1.3);
            if (sliceRandX > 0.92) {
                pos.y += (random(sliceX * glitchTime) - 0.5) * 0.2 * glitchIntensity;
            }

            // Random vertex displacement
            float dispTime = floor(time * 15.0);
            float disp = step(0.95, random(dispTime + pos.y * 50.0 + pos.x * 30.0));
            pos += normal * disp * 0.15 * glitchIntensity;

            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPosition = worldPos.xyz;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float time;
        uniform float glitchIntensity;

        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;

        float random(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            // Base pure black
            vec3 color = vec3(0.0);

            // Dark gray tones for depth
            vec3 darkGray = vec3(0.08);
            vec3 midGray = vec3(0.15);

            // Scan lines - horizontal
            float scanLine = step(0.5, fract(vPosition.y * 60.0));
            color += darkGray * scanLine * 0.5;

            // Digital block noise
            vec2 blockUV = floor(vPosition.xy * 25.0);
            float blockNoise = random(blockUV + floor(time * 12.0));
            float block = step(0.92, blockNoise);
            color += midGray * block;

            // Horizontal glitch lines - bright white flashes
            float glitchLine = step(0.97, random(vec2(floor(vPosition.y * 40.0), floor(time * 20.0))));
            color += vec3(0.3) * glitchLine * glitchIntensity;

            // Vertical tearing effect
            float tear = step(0.985, random(vec2(floor(vPosition.x * 30.0), floor(time * 8.0))));
            color += vec3(0.2) * tear;

            // Static noise
            float staticNoise = random(vPosition.xy * 100.0 + time * 50.0);
            color += vec3(staticNoise * 0.05);

            // Edge highlight - subtle dark gray outline
            vec3 viewDir = normalize(cameraPosition - vWorldPosition);
            float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 3.0);
            color += vec3(0.12) * fresnel;

            // Random full black-out flicker
            float blackout = step(0.98, random(vec2(floor(time * 25.0), 0.0)));
            color *= (1.0 - blackout * 0.8);

            // Occasional bright pixel glitch
            float pixelGlitch = step(0.997, random(vPosition.xy * 200.0 + floor(time * 30.0)));
            color += vec3(0.4) * pixelGlitch;

            // RGB split on glitch frames
            float rgbSplit = step(0.96, random(vec2(floor(time * 15.0), 1.0)));
            if (rgbSplit > 0.5) {
                float offset = sin(vPosition.y * 30.0) * 0.02;
                color.r += offset * 0.3;
                color.b -= offset * 0.3;
            }

            gl_FragColor = vec4(color, 1.0);
        }
    `
};

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

// Create HUD scene for sanity bar rendered in Three.js
function createHUD() {
    hudScene = new THREE.Scene();

    // Orthographic camera for HUD (screen space coordinates)
    const aspect = window.innerWidth / window.innerHeight;
    hudCamera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
    hudCamera.position.z = 1;

    // HUD dimensions (in normalized screen space, -1 to 1)
    const barWidth = 0.7;
    const barHeight = 0.05;
    const padding = 0.06;

    // Position in top-left corner
    const barX = -aspect + padding + barWidth / 2;
    const barY = 1 - padding - barHeight / 2 - 0.04; // Leave room for label

    // Sanity bar background
    const bgGeo = new THREE.PlaneGeometry(barWidth + 0.01, barHeight + 0.01);
    const bgMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.7
    });
    sanityBarBg = new THREE.Mesh(bgGeo, bgMat);
    sanityBarBg.position.set(barX, barY, 0);
    hudScene.add(sanityBarBg);

    // Border
    const borderGeo = new THREE.PlaneGeometry(barWidth + 0.02, barHeight + 0.02);
    const borderMat = new THREE.MeshBasicMaterial({
        color: 0xd1c28c,
        transparent: true,
        opacity: 0.4
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.set(barX, barY, -0.01);
    hudScene.add(border);

    // Sanity bar fill (will be scaled based on sanity)
    const fillGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const fillMat = new THREE.MeshBasicMaterial({
        color: 0xd1c28c,
        transparent: true,
        opacity: 0.9
    });
    sanityBarFill = new THREE.Mesh(fillGeo, fillMat);
    sanityBarFill.position.set(barX, barY, 0.01);
    hudScene.add(sanityBarFill);

    // Store original bar properties for updates
    sanityBarFill.userData.originalWidth = barWidth;
    sanityBarFill.userData.originalX = barX;

    // Create canvas texture for "SANITY" label
    sanityLabelCanvas = document.createElement('canvas');
    sanityLabelCanvas.width = 512;
    sanityLabelCanvas.height = 128;
    sanityLabelCtx = sanityLabelCanvas.getContext('2d');

    sanityLabelTexture = new THREE.CanvasTexture(sanityLabelCanvas);
    sanityLabelTexture.minFilter = THREE.LinearFilter;

    // Draw "SANITY" label
    sanityLabelCtx.fillStyle = 'rgba(0, 0, 0, 0)';
    sanityLabelCtx.fillRect(0, 0, 512, 128);
    sanityLabelCtx.font = '700 48px "Courier New", Courier, monospace';
    sanityLabelCtx.fillStyle = 'rgba(209, 194, 140, 0.9)';
    sanityLabelCtx.letterSpacing = '8px';
    sanityLabelCtx.fillText('S A N I T Y', 15, 75);
    sanityLabelTexture.needsUpdate = true;

    const labelGeo = new THREE.PlaneGeometry(0.38, 0.1);
    const labelMat = new THREE.MeshBasicMaterial({
        map: sanityLabelTexture,
        transparent: true
    });
    sanityLabelMesh = new THREE.Mesh(labelGeo, labelMat);
    sanityLabelMesh.position.set(barX - barWidth / 2 + 0.19, barY + barHeight / 2 + 0.035, 0.01);
    hudScene.add(sanityLabelMesh);

    // Create canvas texture for percentage
    sanityPercentCanvas = document.createElement('canvas');
    sanityPercentCanvas.width = 256;
    sanityPercentCanvas.height = 128;
    sanityPercentCtx = sanityPercentCanvas.getContext('2d');

    sanityPercentTexture = new THREE.CanvasTexture(sanityPercentCanvas);
    sanityPercentTexture.minFilter = THREE.LinearFilter;

    const percentGeo = new THREE.PlaneGeometry(0.18, 0.08);
    const percentMat = new THREE.MeshBasicMaterial({
        map: sanityPercentTexture,
        transparent: true
    });
    sanityPercentMesh = new THREE.Mesh(percentGeo, percentMat);
    sanityPercentMesh.position.set(barX + barWidth / 2 + 0.12, barY, 0.01);
    hudScene.add(sanityPercentMesh);

    // Create "Press E to interact" prompt for phone interaction
    phoneInteractCanvas = document.createElement('canvas');
    phoneInteractCanvas.width = 512;
    phoneInteractCanvas.height = 128;
    phoneInteractCtx = phoneInteractCanvas.getContext('2d');

    phoneInteractTexture = new THREE.CanvasTexture(phoneInteractCanvas);
    phoneInteractTexture.minFilter = THREE.LinearFilter;

    // Draw the prompt text
    phoneInteractCtx.fillStyle = 'rgba(0, 0, 0, 0)';
    phoneInteractCtx.fillRect(0, 0, 512, 128);
    phoneInteractCtx.font = '700 36px "Courier New", Courier, monospace';
    phoneInteractCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    phoneInteractCtx.textAlign = 'center';
    phoneInteractCtx.fillText('Press E to answer', 256, 70);
    phoneInteractTexture.needsUpdate = true;

    const promptGeo = new THREE.PlaneGeometry(0.6, 0.15);
    const promptMat = new THREE.MeshBasicMaterial({
        map: phoneInteractTexture,
        transparent: true
    });
    phoneInteractPromptMesh = new THREE.Mesh(promptGeo, promptMat);
    phoneInteractPromptMesh.position.set(0, -0.3, 0); // Bottom center of screen
    phoneInteractPromptMesh.visible = false; // Hidden by default
    hudScene.add(phoneInteractPromptMesh);

    // Initially hidden
    hudScene.visible = false;
}

// Update HUD sanity bar
function updateHUDSanity(sanity) {
    if (!hudScene) return;

    const percent = sanity / 100;
    const originalWidth = sanityBarFill.userData.originalWidth;
    const originalX = sanityBarFill.userData.originalX;

    // Scale bar fill from left side
    sanityBarFill.scale.x = Math.max(0.001, percent);
    sanityBarFill.position.x = originalX - (originalWidth / 2) * (1 - percent);

    // Update color based on sanity level
    let barColor;
    if (sanity <= 10) {
        barColor = new THREE.Color(0xff4444);
    } else if (sanity <= 30) {
        barColor = new THREE.Color(0xff8844);
    } else if (sanity <= 50) {
        barColor = new THREE.Color(0xffcc44);
    } else {
        barColor = new THREE.Color(0xd1c28c);
    }
    sanityBarFill.material.color = barColor;

    // Update percentage text
    sanityPercentCtx.clearRect(0, 0, 256, 128);

    let textColor;
    if (sanity <= 10) {
        textColor = 'rgba(255, 68, 68, 1)';
    } else if (sanity <= 30) {
        textColor = 'rgba(255, 136, 68, 1)';
    } else if (sanity <= 50) {
        textColor = 'rgba(255, 204, 68, 1)';
    } else {
        textColor = 'rgba(209, 194, 140, 0.9)';
    }

    sanityPercentCtx.font = '700 52px "Courier New", Courier, monospace';
    sanityPercentCtx.fillStyle = textColor;
    sanityPercentCtx.fillText(Math.round(sanity) + '%', 15, 75);
    sanityPercentTexture.needsUpdate = true;

    // Add pulsing effect at low sanity
    if (sanity <= 10) {
        const pulse = Math.sin(Date.now() * 0.01) * 0.3 + 0.7;
        sanityBarFill.material.opacity = pulse;
    } else if (sanity <= 30) {
        const pulse = Math.sin(Date.now() * 0.005) * 0.15 + 0.85;
        sanityBarFill.material.opacity = pulse;
    } else {
        sanityBarFill.material.opacity = 0.9;
    }
}

// Update HUD camera on resize
function updateHUDCamera() {
    if (!hudCamera) return;
    const aspect = window.innerWidth / window.innerHeight;
    hudCamera.left = -aspect;
    hudCamera.right = aspect;
    hudCamera.updateProjectionMatrix();

    // Reposition HUD elements for new aspect ratio
    const barWidth = 0.7;
    const barHeight = 0.05;
    const padding = 0.06;
    const barX = -aspect + padding + barWidth / 2;
    const barY = 1 - padding - barHeight / 2 - 0.04;

    sanityBarBg.position.x = barX;
    sanityBarBg.position.y = barY;

    // Find and update border
    hudScene.children.forEach(child => {
        if (child !== sanityBarBg && child !== sanityBarFill &&
            child !== sanityLabelMesh && child !== sanityPercentMesh &&
            child.geometry && child.geometry.parameters.width > 0.7) {
            child.position.x = barX;
            child.position.y = barY;
        }
    });

    sanityBarFill.userData.originalX = barX;
    sanityBarFill.position.y = barY;

    sanityLabelMesh.position.x = barX - barWidth / 2 + 0.19;
    sanityLabelMesh.position.y = barY + barHeight / 2 + 0.035;

    sanityPercentMesh.position.x = barX + barWidth / 2 + 0.12;
    sanityPercentMesh.position.y = barY;

    // Update fill position based on current sanity
    updateHUDSanity(playerSanity);
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

// Load bacteria entity model - returns a promise
function loadBacteriaModel() {
    return new Promise((resolve) => {
        gltfLoader.load('/models/bacteria_-_kane_pixels_backrooms.glb', (gltf) => {
            bacteriaModel = gltf.scene;
            bacteriaModel.scale.set(0.12, 0.12, 0.12); // smaller scale

            // Apply black material to all meshes
            bacteriaModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    // Replace with black material
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
            resolve(); // Resolve anyway so game can continue without entity
        });
    });
}

// Spawn a demo bacteria entity near spawn point for testing
function spawnDemoBacteriaEntity() {
    if (!bacteriaModel || !scene) {
        console.warn('Cannot spawn demo entity - bacteriaModel:', !!bacteriaModel, 'scene:', !!scene);
        return;
    }

    demoBacteriaEntity = bacteriaModel.clone();

    // Apply distortion shader material to all meshes
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

    // Store material reference for time updates
    demoBacteriaEntity.userData.distortionMaterial = distortionMaterial;

    // Position it to the LEFT of spawn point (negative X), in an open area
    // Player spawns at (0, 1.7, 0) looking down -Z axis
    // Turn left (positive X is right, negative X is left when facing -Z)
    demoBacteriaEntity.position.set(-4, 0, 0); // Temporary position
    demoBacteriaEntity.scale.set(0.5, 0.5, 0.5); // Demo scale

    // Update matrices before calculating bounding box
    demoBacteriaEntity.updateMatrixWorld(true);

    // Get bounding box of entire entity
    const tempBox = new THREE.Box3().setFromObject(demoBacteriaEntity);
    const lowestY = tempBox.min.y;

    // Adjust position so lowest point is at floor level (y=0)
    demoBacteriaEntity.position.y = -lowestY;
    // Store the base Y position for later use
    demoBacteriaEntity.userData.baseY = -lowestY;
    console.log('Adjusted entity Y by', -lowestY, 'to align feet with floor. BBox min:', tempBox.min.y, 'max:', tempBox.max.y);

    scene.add(demoBacteriaEntity);

    // Add bounding box wireframe helper BEFORE adding axes helper (so axes don't affect bbox)
    const boxHelper = new THREE.BoxHelper(demoBacteriaEntity, 0x00ff00); // Green wireframe
    boxHelper.name = 'demoBacteriaBoxHelper';
    boxHelper.visible = debugMode;
    scene.add(boxHelper);
    debugNormals.push(boxHelper);

    // Add axes helper for debugging AFTER bounding box (Red=X, Green=Y, Blue=Z) - only visible in debug mode
    const axesHelper = new THREE.AxesHelper(1);
    axesHelper.visible = debugMode;
    demoBacteriaEntity.add(axesHelper);
    debugNormals.push(axesHelper);

    console.log('Demo bacteria entity spawned at (-4, ' + demoBacteriaEntity.position.y + ', 0) - LEFT of player spawn, turn left to see it');
    console.log('Entity children count:', demoBacteriaEntity.children.length);
    console.log('Entity visible:', demoBacteriaEntity.visible);
}

// Update demo entity to face player (rotate on Y axis only)
function updateDemoBacteriaEntity() {
    if (!demoBacteriaEntity || !camera) return;

    // Get player position (only X and Z, ignore Y)
    const playerX = camera.position.x;
    const playerZ = camera.position.z;

    // Calculate angle to player on Y axis (green axis)
    const dx = playerX - demoBacteriaEntity.position.x;
    const dz = playerZ - demoBacteriaEntity.position.z;
    const angle = Math.atan2(dx, dz);

    // Only rotate on Y axis to face player
    demoBacteriaEntity.rotation.set(0, angle, 0);

    // Update distortion shader time uniform
    if (demoBacteriaEntity.userData.distortionMaterial) {
        demoBacteriaEntity.userData.distortionMaterial.uniforms.time.value = performance.now() / 1000;
    }

    // Update bounding box helper to follow the entity
    const boxHelper = scene.getObjectByName('demoBacteriaBoxHelper');
    if (boxHelper) {
        boxHelper.update();
    }
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
// Detect mobile/touch devices
function detectMobile() {
    return (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    );
}

// Initialize touch controls for mobile
function initTouchControls() {
    const touchControls = document.getElementById('touch-controls');
    const joystickZone = document.getElementById('joystick-zone');
    const joystickStick = document.getElementById('joystick-stick');
    const joystickBase = document.getElementById('joystick-base');
    const lookZone = document.getElementById('look-zone');

    if (!touchControls) return;

    touchControls.classList.add('active');

    const joystickRect = joystickBase.getBoundingClientRect();
    const joystickCenterX = joystickRect.left + joystickRect.width / 2;
    const joystickCenterY = joystickRect.top + joystickRect.height / 2;
    const maxJoystickDist = joystickRect.width / 2 - 25; // Account for stick size

    // Joystick touch handlers
    joystickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (joystickTouchId !== null) return;

        const touch = e.changedTouches[0];
        joystickTouchId = touch.identifier;
        joystickActive = true;
        joystickStick.classList.add('active');
        updateJoystick(touch.clientX, touch.clientY);
    }, { passive: false });

    joystickZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier === joystickTouchId) {
                updateJoystick(touch.clientX, touch.clientY);
                break;
            }
        }
    }, { passive: false });

    joystickZone.addEventListener('touchend', (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier === joystickTouchId) {
                joystickTouchId = null;
                joystickActive = false;
                joystickInput = { x: 0, y: 0 };
                joystickStick.classList.remove('active');
                joystickStick.style.transform = 'translate(-50%, -50%)';
                break;
            }
        }
    });

    joystickZone.addEventListener('touchcancel', (e) => {
        joystickTouchId = null;
        joystickActive = false;
        joystickInput = { x: 0, y: 0 };
        joystickStick.classList.remove('active');
        joystickStick.style.transform = 'translate(-50%, -50%)';
    });

    function updateJoystick(touchX, touchY) {
        const rect = joystickBase.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        let dx = touchX - centerX;
        let dy = touchY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Clamp to max distance
        if (dist > maxJoystickDist) {
            dx = (dx / dist) * maxJoystickDist;
            dy = (dy / dist) * maxJoystickDist;
        }

        // Update stick position
        joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

        // Normalize input (-1 to 1)
        joystickInput.x = dx / maxJoystickDist;
        joystickInput.y = dy / maxJoystickDist;
    }

    // Look zone touch handlers (right side of screen for camera rotation)
    lookZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (lookTouchId !== null) return;

        const touch = e.changedTouches[0];
        lookTouchId = touch.identifier;
        lastLookPos = { x: touch.clientX, y: touch.clientY };
    }, { passive: false });

    lookZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier === lookTouchId) {
                const dx = touch.clientX - lastLookPos.x;
                const dy = touch.clientY - lastLookPos.y;

                // Apply camera rotation (sensitivity adjusted for touch)
                if (camera) {
                    camera.rotation.order = 'YXZ';
                    camera.rotation.y -= dx * 0.003;
                    camera.rotation.x -= dy * 0.003;
                    camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
                }

                lastLookPos = { x: touch.clientX, y: touch.clientY };
                break;
            }
        }
    }, { passive: false });

    lookZone.addEventListener('touchend', (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier === lookTouchId) {
                lookTouchId = null;
                break;
            }
        }
    });

    lookZone.addEventListener('touchcancel', () => {
        lookTouchId = null;
    });
}

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

    // When switching to 50% or below, immediately play the kids laughing sound for testing
    if (playerSanity <= 50 && kidsLaughBuffer) {
        console.log('Triggering kids laugh sound for testing (sanity: ' + playerSanity + '%)');
        playAmbientDoorClose(); // This will play kids laugh since sanity <= 50%
    }
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

// Seeded random number generator for deterministic chunk generation
function seededRandom(seed) {
    let s = seed;
    return function() {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

// Generate wall placement that guarantees connectivity (no dead ends)
// Uses a grid-based approach where each cell must have at least 2 open sides
function generateWallGrid(cx, cz, gSize) {
    const seed = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
    const rng = seededRandom(seed);

    // Wall grids: [row][col] for horizontal walls (blocking N-S movement)
    // and vertical walls (blocking E-W movement)
    // gSize+1 rows/cols of walls surround gSize cells

    // Initialize potential walls
    const hWalls = []; // Horizontal walls (block Z movement)
    const vWalls = []; // Vertical walls (block X movement)

    for (let i = 0; i <= gSize; i++) {
        hWalls[i] = [];
        vWalls[i] = [];
        for (let j = 0; j < gSize; j++) {
            // Start with random wall placement (55% chance)
            hWalls[i][j] = rng() > 0.45;
            vWalls[i][j] = rng() > 0.45;
        }
    }

    // Remove walls on chunk boundaries to ensure inter-chunk connectivity
    // This guarantees players can always move between chunks
    for (let j = 0; j < gSize; j++) {
        // Always open at least one path on each edge
        // Use deterministic selection based on chunk coordinates
        const edgeSeed = seededRandom(seed + j * 1000);

        // North edge (i = gSize) - always open middle passage
        if (j === Math.floor(gSize / 2)) hWalls[gSize][j] = false;
        // South edge (i = 0) - always open middle passage
        if (j === Math.floor(gSize / 2)) hWalls[0][j] = false;
        // East edge (i = gSize for vWalls) - always open middle passage
        if (j === Math.floor(gSize / 2)) vWalls[gSize][j] = false;
        // West edge (i = 0 for vWalls) - always open middle passage
        if (j === Math.floor(gSize / 2)) vWalls[0][j] = false;
    }

    // Ensure each interior cell has at least 2 open sides (no dead ends)
    // A cell at (x, z) is bounded by:
    // - North: hWalls[z+1][x]
    // - South: hWalls[z][x]
    // - East: vWalls[x+1][z]
    // - West: vWalls[x][z]

    for (let z = 0; z < gSize; z++) {
        for (let x = 0; x < gSize; x++) {
            let openSides = 0;
            const sides = [
                { type: 'h', i: z + 1, j: x },  // North
                { type: 'h', i: z, j: x },      // South
                { type: 'v', i: x + 1, j: z },  // East
                { type: 'v', i: x, j: z }       // West
            ];

            // Count open sides
            for (const side of sides) {
                const walls = side.type === 'h' ? hWalls : vWalls;
                if (!walls[side.i][side.j]) openSides++;
            }

            // If fewer than 2 open sides, remove walls until we have at least 2
            // Prefer removing interior walls over edge walls
            while (openSides < 2) {
                // Shuffle sides for random selection
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

    // Additional pass: ensure no cell has more than 2 walls (keeps it feeling open)
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

            // Remove excess walls if more than 2
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

    // Generate wall placement grid that guarantees connectivity
    const gSize = 3;
    const cellSize = CHUNK_SIZE / gSize;
    const { hWalls, vWalls } = generateWallGrid(cx, cz, gSize);

    // Place walls based on the generated grid
    // Vertical walls (block X movement) - placed along X grid lines
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
                group.add(wall); walls.push(wall);
            }
        }
    }

    // Horizontal walls (block Z movement) - placed along Z grid lines
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

    // Create debug normals and track walls based on the generated wall grid
    // Vertical walls (vWalls)
    for (let i = 0; i <= gSize; i++) {
        const posX = -CHUNK_SIZE / 2 + i * cellSize;
        for (let j = 0; j < gSize; j++) {
            if (vWalls[i][j]) {
                const wallZ = -CHUNK_SIZE / 2 + j * cellSize + cellSize / 2;
                const wallCenter = new THREE.Vector3(posX, 1.5, wallZ);

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
        }
    }

    // Horizontal walls (hWalls)
    for (let i = 0; i <= gSize; i++) {
        const posZ = -CHUNK_SIZE / 2 + i * cellSize;
        for (let j = 0; j < gSize; j++) {
            if (hWalls[i][j]) {
                const wallX = -CHUNK_SIZE / 2 + j * cellSize + cellSize / 2;
                const wallCenter = new THREE.Vector3(wallX, 1.5, posZ);

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

            group.add(outlet);

            // Add bounding box helper BEFORE axes helper (so axes don't affect bbox)
            const outletBoxHelper = new THREE.BoxHelper(outlet, 0xff00ff); // Magenta wireframe
            outletBoxHelper.visible = debugMode;
            group.add(outletBoxHelper);
            debugNormals.push(outletBoxHelper);

            // Add axes helper for debugging AFTER bounding box
            const axes = new THREE.AxesHelper(0.5);
            axes.visible = debugMode;
            outlet.add(axes);
            debugNormals.push(axes);
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

            // Add bounding box helper BEFORE axes helper (so axes don't affect bbox)
            const phoneBoxHelper = new THREE.BoxHelper(phone, 0x00ffff); // Cyan wireframe
            phoneBoxHelper.visible = debugMode;
            group.add(phoneBoxHelper);
            debugNormals.push(phoneBoxHelper);

            // Add axes helper for debugging AFTER bounding box
            const phoneAxes = new THREE.AxesHelper(0.5);
            phoneAxes.visible = debugMode;
            phone.add(phoneAxes);
            debugNormals.push(phoneAxes);

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
let kidsLaughBuffer = null; // Creepy kids laughing for low sanity
let humBuffer = null;
let humGainNode = null;
let humSource = null;

// Phone ringing audio
let phoneRingBuffer = null;
let phoneRingSource = null;
let phoneRingGainNode = null;
const PHONE_AUDIO_CLOSE_DIST = 5; // Distance for maximum volume (very close)
const PHONE_AUDIO_MAX_DIST = CHUNK_SIZE * 3; // Maximum hearing distance (3 chunks)

// Phone pick-up audio
let phonePickupBuffer = null;
const PHONE_INTERACT_DIST = 3; // Distance to interact with phone
let nearestPhoneDist = Infinity; // Track distance to nearest phone for HUD
let phoneInteractPromptMesh = null; // HUD mesh for "Press E" prompt
let phoneInteractCanvas = null;
let phoneInteractCtx = null;
let phoneInteractTexture = null;
let isInteractingWithPhone = false; // Prevent multiple interactions

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
    humGainNode.gain.value = 0.12; // Base volume (quieter when not near lights, 20% increase)

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

// Load phone pick-up sound from external URL
async function loadPhonePickupSound() {
    try {
        const response = await fetch('https://cdn.pixabay.com/download/audio/2022/03/10/audio_6650ed59b7.mp3?filename=phone-pick-up-46796.mp3');
        const arrayBuffer = await response.arrayBuffer();
        phonePickupBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        console.log('Phone pick-up sound loaded successfully');
    } catch (e) {
        console.warn('Failed to load phone pick-up sound:', e);
    }
}

// Load creepy kids laughing sound for low sanity moments
async function loadKidsLaughSound() {
    try {
        const response = await fetch('/sounds/kids-laugh.mp3');
        const arrayBuffer = await response.arrayBuffer();
        kidsLaughBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        console.log('Kids laughing sound loaded successfully');
    } catch (e) {
        console.warn('Failed to load kids laughing sound:', e);
    }
}

function updatePhoneRingVolume() {
    // Reset nearest phone distance
    nearestPhoneDist = Infinity;

    if (!phoneRingGainNode || !camera || phonePositions.length === 0) {
        // No phones nearby, ensure silence
        if (phoneRingGainNode) {
            phoneRingGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        }
        // Update HUD prompt visibility
        updatePhoneInteractPrompt();
        return;
    }

    // Find distance to nearest phone
    let minDist = Infinity;
    const playerPos = camera.position;

    for (const phonePos of phonePositions) {
        const dist = playerPos.distanceTo(phonePos);
        if (dist < minDist) minDist = dist;
    }

    // Store nearest phone distance for HUD
    nearestPhoneDist = minDist;

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

    // Update HUD prompt visibility
    updatePhoneInteractPrompt();
}

// Update phone interaction prompt visibility based on proximity
function updatePhoneInteractPrompt() {
    if (!phoneInteractPromptMesh || !hudScene.visible) return;

    // Show prompt when close enough to interact and not already interacting
    const shouldShow = nearestPhoneDist <= PHONE_INTERACT_DIST && !isInteractingWithPhone;
    phoneInteractPromptMesh.visible = shouldShow;

    // Add pulsing effect when visible
    if (shouldShow) {
        const pulse = Math.sin(Date.now() * 0.005) * 0.15 + 0.85;
        phoneInteractPromptMesh.material.opacity = pulse;
    }
}

// Handle phone interaction when E is pressed
function interactWithPhone() {
    if (isInteractingWithPhone || nearestPhoneDist > PHONE_INTERACT_DIST) return;

    isInteractingWithPhone = true;

    // Hide the interaction prompt immediately
    if (phoneInteractPromptMesh) {
        phoneInteractPromptMesh.visible = false;
    }

    // Stop the phone ringing sound completely
    if (phoneRingSource) {
        phoneRingSource.stop();
        phoneRingSource = null;
    }
    if (phoneRingGainNode) {
        phoneRingGainNode.gain.value = 0;
    }

    // Play phone pick-up sound
    if (phonePickupBuffer && audioCtx) {
        const source = audioCtx.createBufferSource();
        source.buffer = phonePickupBuffer;

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.8;

        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        source.start();
    }

    // Start fade to black
    if (fadePass) {
        fadePass.enabled = true;
        fadeStartTime = performance.now();
    }
}

// Reset game state for returning to start screen
function resetGameState() {
    // Hide game UI
    document.getElementById('fps-counter').style.display = 'none';
    document.getElementById('crosshair').style.display = 'none';

    // Hide touch controls if mobile
    const touchControls = document.getElementById('touch-controls');
    if (touchControls) {
        touchControls.classList.remove('active');
    }

    // Show start screen
    document.getElementById('start-screen').style.display = 'flex';

    // Exit pointer lock
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }

    // Reset game variables
    isStarted = false;
    isInteractingWithPhone = false;
    playerSanity = 100;
    fadeStartTime = -1;

    // Reset camera position
    if (camera) {
        camera.position.set(0, 1.7, 0);
        camera.rotation.set(0, 0, 0);
    }

    // Reset movement states
    moveForward = false;
    moveBackward = false;
    moveLeft = false;
    moveRight = false;
    velocity.set(0, 0, 0);

    // Reset joystick for mobile
    joystickInput = { x: 0, y: 0 };
    joystickActive = false;

    // Hide HUD
    if (hudScene) {
        hudScene.visible = false;
    }

    // Reset fade pass
    if (fadePass) {
        fadePass.enabled = false;
        fadePass.uniforms.fadeAmount.value = 0;
    }

    // Reset wakeup pass for next game start
    if (wakeupPass) {
        wakeupPass.enabled = false;
        wakeupPass.uniforms.eyeOpen.value = 0;
        wakeupPass.uniforms.blurAmount.value = 1.0;
        wakeupPass.uniforms.effectOpacity.value = 1.0;
    }

    // Clear all chunks and regenerate fresh on next start
    for (const [key, obj] of chunks.entries()) {
        scene.remove(obj);
        if (obj.userData.border) {
            scene.remove(obj.userData.border);
        }
        chunks.delete(key);
    }
    walls = [];
    lightPanels = [];
    phonePositions = [];
    chunkBorders = [];
    debugNormals = [];

    // Reset bacteria entity state
    if (bacteriaEntity) {
        bacteriaEntity.visible = false;
    }
    bacteriaVisible = false;
    bacteriaLastSpawnTime = 0;
    bacteriaNextSpawnDelay = 5000;
    bacteriaVisibleDuration = 0;
    bacteriaSpawnStartTime = 0;
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
    // Base volume: 0.18 (when far), max volume under light: 0.72 (20% increase)
    const maxDist = 5; // Distance at which volume is at minimum
    const proximity = Math.max(0, 1 - (minDist / maxDist));
    const volume = 0.18 + proximity * 0.54;

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

    // Get effective sanity (use debug override if active)
    const effectiveSanity = debugSanityOverride >= 0 ? [100, 80, 50, 30, 10, 0][debugSanityOverride] : playerSanity;

    // When sanity is 50% or below, play creepy kids laughing instead of door sounds
    const useKidsLaugh = effectiveSanity <= 50 && kidsLaughBuffer;

    console.log('playAmbientDoorClose - sanity:', effectiveSanity, '%, useKidsLaugh:', useKidsLaugh, ', kidsLaughBuffer:', !!kidsLaughBuffer);

    const source = audioCtx.createBufferSource();
    source.buffer = useKidsLaugh ? kidsLaughBuffer : doorCloseBuffer;

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = (Math.random() * 2) - 1;

    const gainNode = audioCtx.createGain();

    if (useKidsLaugh) {
        // Kids laughing gets louder and more frequent as sanity drops
        // At 50% sanity: quieter. At 0% sanity: much louder
        const sanityFactor = 1 - (effectiveSanity / 50); // 0 at 50%, 1 at 0%
        gainNode.gain.value = 0.15 + sanityFactor * 0.5 + Math.random() * 0.2;

        // Pitch distortion - gets more unsettling as sanity decreases
        // At low sanity, pitch shifts down for a demonic effect
        const basePitch = 1.0 - sanityFactor * 0.3; // Slows down at low sanity
        const pitchVariation = (Math.random() - 0.5) * 0.2 * (1 + sanityFactor);
        source.playbackRate.value = basePitch + pitchVariation;

        // Create distortion effect for scarier audio
        const distortion = audioCtx.createWaveShaper();
        const distortionAmount = sanityFactor * 50; // More distortion at lower sanity
        distortion.curve = makeDistortionCurve(distortionAmount);
        distortion.oversample = '4x';

        // Filter chain - more extreme processing at lower sanity
        const filter = audioCtx.createBiquadFilter();
        // At higher sanity: bandpass for eerie effect. At lower: lowpass for muffled demonic sound
        if (effectiveSanity <= 20) {
            filter.type = 'lowpass';
            filter.frequency.value = 600 + Math.random() * 400;
            filter.Q.value = 5 + sanityFactor * 10;
        } else {
            filter.type = 'bandpass';
            filter.frequency.value = 800 + Math.random() * 600;
            filter.Q.value = 2 + sanityFactor * 5;
        }

        // Add a subtle echo/reverb effect for creepiness
        const delay = audioCtx.createDelay();
        delay.delayTime.value = 0.1 + sanityFactor * 0.15;
        const delayGain = audioCtx.createGain();
        delayGain.gain.value = 0.2 + sanityFactor * 0.3;

        // Connect the audio chain: source -> distortion -> filter -> gain -> panner -> destination
        // Also add delayed feedback for echo
        source.connect(distortion);
        distortion.connect(filter);
        filter.connect(gainNode);
        filter.connect(delay);
        delay.connect(delayGain);
        delayGain.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(audioCtx.destination);
    } else {
        // Normal door close sound
        gainNode.gain.value = 0.2 + Math.random() * 0.4;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400 + Math.random() * 600;

        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(audioCtx.destination);
    }

    source.start();

    // Kids laughing plays more frequently at lower sanity
    let nextDoor;
    if (useKidsLaugh) {
        const sanityFactor = 1 - (effectiveSanity / 50);
        // At 50% sanity: 12-25 seconds. At 0% sanity: 4-10 seconds
        nextDoor = (12000 - sanityFactor * 8000) + Math.random() * (13000 - sanityFactor * 8000);
    } else {
        // Normal door sounds: 15-40 seconds
        nextDoor = 15000 + Math.random() * 25000;
    }
    setTimeout(playAmbientDoorClose, nextDoor);
}

// Create distortion curve for audio waveshaping
function makeDistortionCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
}

// Bacteria entity spawning system
// Spawns at sanity thresholds (80%, 50%, 30%, 10%) at unreachable distances
// Lower sanity = more frequent and longer appearances
function updateBacteriaEntity() {
    if (!bacteriaModel || !camera || !isStarted) return;

    const currentTime = performance.now();
    const effectiveSanity = debugSanityOverride >= 0 ? DEBUG_SANITY_LEVELS[debugSanityOverride] : playerSanity;

    // Only spawn at sanity thresholds: 80% and below
    if (effectiveSanity > 80) {
        // High sanity - remove entity if visible
        if (bacteriaEntity && bacteriaVisible) {
            hideBacteriaEntity();
        }
        return;
    }

    // Calculate spawn parameters based on sanity
    // Lower sanity = more frequent spawns, longer visibility, closer distance
    const sanityFactor = 1 - (effectiveSanity / 80); // 0 at 80%, 1 at 0%

    // Spawn delay: 8-15 seconds at 80%, 2-5 seconds at 0%
    const minDelay = 2000 + (1 - sanityFactor) * 6000;
    const maxDelay = 5000 + (1 - sanityFactor) * 10000;

    // Visible duration: 0.3-0.8 seconds at 80%, 1.5-4 seconds at 0%
    const minDuration = 300 + sanityFactor * 1200;
    const maxDuration = 800 + sanityFactor * 3200;

    // Spawn distance: 25-40 units at 80%, 15-30 units at 0% (always unreachable but closer at low sanity)
    const minDist = 15 + (1 - sanityFactor) * 10;
    const maxDist = 30 + (1 - sanityFactor) * 10;

    if (bacteriaVisible) {
        // Check if it's time to hide the entity
        const visibleTime = currentTime - bacteriaSpawnStartTime;
        if (visibleTime >= bacteriaVisibleDuration) {
            hideBacteriaEntity();
            // Set next spawn delay with some randomness
            bacteriaNextSpawnDelay = minDelay + Math.random() * (maxDelay - minDelay);
            bacteriaLastSpawnTime = currentTime;
        } else {
            // Update entity position and distortion while visible
            updateBacteriaDistortion(visibleTime / bacteriaVisibleDuration, sanityFactor);
        }
    } else {
        // Check if it's time to spawn the entity
        if (currentTime - bacteriaLastSpawnTime >= bacteriaNextSpawnDelay) {
            // Random chance to spawn (increases at lower sanity)
            const spawnChance = 0.3 + sanityFactor * 0.5; // 30-80% chance
            if (Math.random() < spawnChance) {
                spawnBacteriaEntity(minDist, maxDist);
                bacteriaVisibleDuration = minDuration + Math.random() * (maxDuration - minDuration);
                bacteriaSpawnStartTime = currentTime;
            } else {
                // Failed spawn check, try again soon
                bacteriaLastSpawnTime = currentTime;
                bacteriaNextSpawnDelay = 1000 + Math.random() * 2000;
            }
        }
    }
}

// Spawn the bacteria entity at a position the player can see but not reach
function spawnBacteriaEntity(minDist, maxDist) {
    if (!bacteriaModel || !camera || !scene) return;

    // Create entity if it doesn't exist
    if (!bacteriaEntity) {
        bacteriaEntity = bacteriaModel.clone();

        // Apply distortion shader material to all meshes
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

        // Store material reference for time updates
        bacteriaEntity.userData.distortionMaterial = distortionMaterial;

        // Set base scale
        bacteriaEntity.scale.set(0.5, 0.5, 0.5);

        // Calculate bounding box to get floor offset
        bacteriaEntity.updateMatrixWorld(true);
        const tempBox = new THREE.Box3().setFromObject(bacteriaEntity);
        bacteriaEntity.userData.floorOffset = -tempBox.min.y;

        scene.add(bacteriaEntity);
    }

    // Calculate spawn position in front of the player at an unreachable distance
    const playerPos = camera.position;
    const playerDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    playerDir.y = 0;
    playerDir.normalize();

    // Add some random angle offset (-60 to +60 degrees) so it's not always directly ahead
    const angleOffset = (Math.random() - 0.5) * Math.PI * 0.67;
    playerDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset);

    // Random distance within range
    const distance = minDist + Math.random() * (maxDist - minDist);

    // Set position with floor alignment
    bacteriaEntity.position.set(
        playerPos.x + playerDir.x * distance,
        bacteriaEntity.userData.floorOffset || 0, // Align bottom with floor
        playerPos.z + playerDir.z * distance
    );

    // Initial distortion state
    bacteriaEntity.visible = true;
    bacteriaVisible = true;

    // Reset scale for spawn animation
    bacteriaEntity.scale.set(0.01, 0.01, 0.01);
}

// Hide the bacteria entity
function hideBacteriaEntity() {
    if (bacteriaEntity) {
        bacteriaEntity.visible = false;
    }
    bacteriaVisible = false;
}

// Update entity distortion effect based on visibility progress and sanity
function updateBacteriaDistortion(progress, sanityFactor) {
    if (!bacteriaEntity || !bacteriaVisible || !camera) return;

    const time = performance.now() / 1000;

    // Update distortion shader time uniform
    if (bacteriaEntity.userData.distortionMaterial) {
        bacteriaEntity.userData.distortionMaterial.uniforms.time.value = time;
        // Increase glitch intensity at lower sanity
        bacteriaEntity.userData.distortionMaterial.uniforms.glitchIntensity.value = 0.5 + sanityFactor * 0.5;
    }

    // Spawn animation: quick scale up at start
    let scale = 0.5;
    if (progress < 0.1) {
        // Quick pop-in effect
        scale = 0.5 * (progress / 0.1);
    } else if (progress > 0.85) {
        // Fade out effect - shrink and flicker
        const fadeProgress = (progress - 0.85) / 0.15;
        scale = 0.5 * (1 - fadeProgress);

        // Flicker effect near the end
        if (Math.random() < 0.3) {
            bacteriaEntity.visible = !bacteriaEntity.visible;
        } else {
            bacteriaEntity.visible = true;
        }
    }

    bacteriaEntity.scale.set(scale, scale, scale);

    // Face the player - rotate on Y axis only
    const playerX = camera.position.x;
    const playerZ = camera.position.z;
    const dx = playerX - bacteriaEntity.position.x;
    const dz = playerZ - bacteriaEntity.position.z;
    const angle = Math.atan2(dx, dz);
    bacteriaEntity.rotation.set(0, angle, 0);

    // Keep entity aligned to floor with slight bobbing at low sanity
    const baseY = bacteriaEntity.userData.floorOffset || 0;
    const bobAmount = sanityFactor * 0.1;
    bacteriaEntity.position.y = baseY + Math.sin(time * 4) * bobAmount;

    // Random flickering at very low sanity
    if (sanityFactor > 0.7 && Math.random() < 0.05) {
        bacteriaEntity.visible = !bacteriaEntity.visible;
    }
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

    // Check if we should process movement (pointer lock on desktop, or mobile touch)
    const canMove = document.pointerLockElement === renderer.domElement || isMobile;

    if (canMove) {
        const speed = 4.0; const friction = 12.0;
        velocity.x -= velocity.x * friction * delta;
        velocity.z -= velocity.z * friction * delta;

        const input = new THREE.Vector3();

        // Handle keyboard input (desktop)
        if (moveForward) input.z -= 1; if (moveBackward) input.z += 1;
        if (moveLeft) input.x -= 1; if (moveRight) input.x += 1;

        // Handle joystick input (mobile) - add to keyboard input
        if (isMobile && joystickActive) {
            input.x += joystickInput.x;
            input.z += joystickInput.y; // Joystick Y maps to forward/backward
        }

        input.normalize();

        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; fwd.normalize();
        const rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion); rgt.y = 0; rgt.normalize();

        const move = new THREE.Vector3().addScaledVector(fwd, -input.z).addScaledVector(rgt, input.x);
        velocity.addScaledVector(move, speed * friction * delta);

        const next = camera.position.clone().addScaledVector(velocity, delta);
        next.y = 1.7; handleCollision(next); camera.position.copy(next);

        // Only drain sanity if not in debug override mode
        if (debugSanityOverride === -1) {
            // Sanity drain rate increases at insanity thresholds (30% faster than original)
            // Base drain: 0.195/sec, increases as sanity drops
            let drainRate = 0.195;
            if (playerSanity <= 10) {
                drainRate = 0.78; // 4x faster at critical insanity
            } else if (playerSanity <= 30) {
                drainRate = 0.52; // ~2.7x faster at severe insanity
            } else if (playerSanity <= 50) {
                drainRate = 0.325; // ~1.7x faster at moderate insanity
            } else if (playerSanity <= 80) {
                drainRate = 0.26; // ~1.3x faster at mild insanity
            }
            playerSanity -= delta * drainRate;
            playerSanity = Math.max(0, playerSanity);
        }

        // Update Three.js HUD sanity bar
        updateHUDSanity(playerSanity);
    }

    updateChunks();
    updateHumVolume();
    updatePhoneRingVolume();
    updateBacteriaEntity();

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

    // Update fade to black animation (for phone interaction)
    if (fadePass && fadeStartTime >= 0) {
        const elapsed = (performance.now() - fadeStartTime) / 1000;
        const progress = Math.min(elapsed / FADE_DURATION, 1.0);

        // Smooth ease-in for fade
        const eased = progress * progress;
        fadePass.uniforms.fadeAmount.value = eased;

        // When fade is complete, reset to start screen
        if (progress >= 1.0) {
            resetGameState();
        }
    }

    composer.render();

    // Render HUD on top (using autoClear = false to preserve the main scene)
    if (hudScene && hudScene.visible) {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(hudScene, hudCamera);
        renderer.autoClear = true;
    }
}

async function initGame() {
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('fps-counter').style.display = 'block';

    // Reset interaction state
    isInteractingWithPhone = false;
    playerSanity = 100;

    // Check if this is a restart (scene already exists)
    const isRestart = scene !== undefined && scene !== null;

    // Detect mobile device
    isMobile = detectMobile();

    // Show crosshair only on desktop (mobile uses touch controls)
    if (!isMobile) {
        document.getElementById('crosshair').style.display = 'block';
    }

    // Show HUD after wake-up animation completes
    setTimeout(() => {
        // Show Three.js HUD
        if (hudScene) {
            hudScene.visible = true;
            updateHUDSanity(playerSanity);
        }
        // Initialize touch controls after UI is shown (mobile only)
        if (isMobile) {
            initTouchControls();
        }
    }, WAKEUP_DURATION * 1000);

    if (isRestart) {
        // For restart, just reset camera and re-enable wakeup
        camera.position.set(0, 1.7, 0);
        camera.rotation.set(0, 0, 0);

        // Reset and enable wakeup pass
        wakeupPass.uniforms.eyeOpen.value = 0.0;
        wakeupPass.uniforms.blurAmount.value = 1.0;
        wakeupPass.uniforms.effectOpacity.value = 1.0;
        wakeupPass.enabled = true;
        wakeupStartTime = performance.now();

        // Make sure fade pass is disabled
        fadePass.enabled = false;
        fadePass.uniforms.fadeAmount.value = 0.0;

        // Resume audio context if suspended
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        // Regenerate initial chunks
        isStarted = true;
        updateChunks();
        return;
    }

    // First time initialization
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    createGlobalResources();

    // Load models before generating chunks
    await Promise.all([
        loadOutletModel(),
        loadWallPhoneModel(),
        loadBacteriaModel()
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

    // Fade to black effect for phone interaction
    fadePass = new ShaderPass(FADE_SHADER);
    fadePass.uniforms.fadeAmount.value = 0.0;
    fadePass.enabled = false; // Disabled by default, enabled when interacting with phone
    composer.addPass(fadePass);

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

    // Create HUD for sanity bar
    createHUD();

    document.addEventListener('keydown', (e) => {
        if (e.code === 'KeyW') moveForward = true; if (e.code === 'KeyA') moveLeft = true;
        if (e.code === 'KeyS') moveBackward = true; if (e.code === 'KeyD') moveRight = true;
        if (e.code === 'KeyO') toggleDebugMode();
        if (e.code === 'KeyN') cycleSanityLevel(-1); // Previous sanity level
        if (e.code === 'KeyM') cycleSanityLevel(1);  // Next sanity level
        if (e.code === 'KeyE') interactWithPhone();  // Interact with phone
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'KeyW') moveForward = false; if (e.code === 'KeyA') moveLeft = false;
        if (e.code === 'KeyS') moveBackward = false; if (e.code === 'KeyD') moveRight = false;
    });

    const handleInteraction = () => {
        // Only request pointer lock on desktop (mobile uses touch controls)
        if (!isMobile) {
            renderer.domElement.requestPointerLock();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    };
    document.addEventListener('mousedown', handleInteraction);
    // Also handle touch for audio context on mobile
    document.addEventListener('touchstart', () => {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: true });

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
    loadPhonePickupSound(); // Load phone pick-up sound for interaction
    loadKidsLaughSound(); // Load creepy kids laughing for low sanity horror
    setTimeout(playAmbientFootsteps, 3000);  // First footsteps after 3 seconds
    setTimeout(playAmbientDoorClose, 6000);  // First door close after 6 seconds

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
        updateHUDCamera();
    });

    isStarted = true; updateChunks();

    animate();
}

// Expose initGame globally for the HTML button
window.initGame = initGame;
