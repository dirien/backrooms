import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * BACKROOMS - Level 0: The Lobby
 */

let scene, camera, renderer, composer, clock;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let velocity = new THREE.Vector3();
let chunks = new Map();
let walls = [];
let lightPanels = [];
let playerSanity = 100;
let isStarted = false;

let fpsFrames = 0;
let fpsPrevTime = performance.now();

// Shared Resources
let wallMat, floorMat, ceilingMat;
let wallGeoV, wallGeoH, floorGeo, lightPanelGeo, lightPanelMat;
let infiniteCeiling;

const CHUNK_SIZE = 24;
const RENDER_DIST = 2;
const PLAYER_RADIUS = 0.5;

let audioCtx;

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

        void main() {
            vec2 uv = vUv;
            float sFac = clamp(1.0 - sanity, 0.0, 1.0);

            vec2 centeredUv = uv - 0.5;
            float d = length(centeredUv);
            uv += centeredUv * d * d * 0.04;

            float warp = sin(uv.x * 10.0 + time) * 0.0015 * sFac;
            uv.y += warp;

            vec4 col = texture2D(tDiffuse, uv);
            col.rgb += (random(uv + time) - 0.5) * 0.05;

            float gray = dot(col.rgb, vec3(0.299, 0.587, 0.114));
            col.rgb = mix(col.rgb, vec3(gray), sFac * 0.5);

            col.rgb *= smoothstep(1.0, 0.35, d);

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

    // Load ceiling tile texture from image
    const ceilTex = loadCeilingTexture(textureLoader);
    const planeSize = CHUNK_SIZE * (RENDER_DIST * 2 + 2);
    const tileWorldSize = 1.5;
    ceilTex.repeat.set(planeSize / tileWorldSize, planeSize / tileWorldSize);

    wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1.0, metalness: 0, color: 0xffffff });

    // Floor with procedural carpet shader
    floorMat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(CARPET_SHADER.uniforms),
        vertexShader: CARPET_SHADER.vertexShader,
        fragmentShader: CARPET_SHADER.fragmentShader,
        side: THREE.FrontSide
    });
    // Ceiling tiles - whiter look
    ceilingMat = new THREE.MeshStandardMaterial({
        map: ceilTex,
        roughness: 0.95,
        metalness: 0,
        color: 0xbbbbbb,  // Whiter ceiling
        side: THREE.DoubleSide  // Render both sides - simpler than fighting rotations
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

    // Floor geometry for per-chunk floor tiles
    floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
}

// Create fixed ceiling only (floor is per-chunk)
function createInfiniteCeiling() {
    const planeSize = CHUNK_SIZE * (RENDER_DIST * 2 + 2);  // 144 units (24 * 6)

    // Ceiling - fixed at origin
    const ceilingGeo = new THREE.PlaneGeometry(planeSize, planeSize);
    infiniteCeiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    infiniteCeiling.rotation.x = -Math.PI / 2;
    // Position ceiling slightly above light panels (which are at 2.99) to avoid z-fighting
    infiniteCeiling.position.set(0, 3.01, 0);  // Fixed at origin

    scene.add(infiniteCeiling);
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
    group.add(floor);

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
                group.add(wall); walls.push(wall);
            }
            if (rnd(seed + i * 13 + j) > 0.65) {
                const wall = new THREE.Mesh(wallGeoH, wallMat);
                wall.position.set(-CHUNK_SIZE / 2 + j * cellSize + cellSize / 2, 1.5, pos);
                wall.matrixAutoUpdate = false;
                wall.updateMatrix();
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

    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    scene.add(group);
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

function updateChunks() {
    const px = Math.floor(camera.position.x / CHUNK_SIZE);
    const pz = Math.floor(camera.position.z / CHUNK_SIZE);
    let activeKeys = new Set();
    for (let x = px - RENDER_DIST; x <= px + RENDER_DIST; x++) {
        for (let z = pz - RENDER_DIST; z <= pz + RENDER_DIST; z++) {
            const k = `${x},${z}`; activeKeys.add(k);
            if (!chunks.has(k)) chunks.set(k, generateChunk(x, z));
        }
    }
    for (const [key, obj] of chunks.entries()) {
        if (!activeKeys.has(key)) {
            scene.remove(obj);
            walls = walls.filter(w => !obj.children.includes(w));
            lightPanels = lightPanels.filter(p => !obj.children.includes(p));
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

async function loadAmbientSounds() {
    try {
        const [footstepsResponse, doorResponse, humResponse] = await Promise.all([
            fetch('/sounds/footsteps.mp3'),
            fetch('/sounds/door-close.mp3'),
            fetch('/sounds/light-hum.mp3')
        ]);
        const [footstepsArrayBuffer, doorArrayBuffer, humArrayBuffer] = await Promise.all([
            footstepsResponse.arrayBuffer(),
            doorResponse.arrayBuffer(),
            humResponse.arrayBuffer()
        ]);
        footstepsBuffer = await audioCtx.decodeAudioData(footstepsArrayBuffer);
        doorCloseBuffer = await audioCtx.decodeAudioData(doorArrayBuffer);
        humBuffer = await audioCtx.decodeAudioData(humArrayBuffer);
        console.log('Ambient sounds loaded successfully');

        // Start the looping hum sound
        startHumSound();
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

        playerSanity -= delta * 0.08;
        document.getElementById('sanity-bar').style.width = Math.max(0, playerSanity) + '%';
    }

    updateChunks();
    updateHumVolume();

    composer.passes[2].uniforms.time.value = clock.elapsedTime;
    composer.passes[2].uniforms.sanity.value = playerSanity / 100;
    composer.render();
}

function initGame() {
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('ui-overlay').style.display = 'block';
    document.getElementById('fps-counter').style.display = 'block';
    document.getElementById('crosshair').style.display = 'block';

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    createGlobalResources();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050503);

    camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 400);
    camera.position.set(0, 1.7, 0);

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio > 1 ? 1 : window.devicePixelRatio);
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

    clock = new THREE.Clock();
    // Even ambient lighting - the main light source for backrooms look
    // Ambient light using backrooms palette (pale golden)
    scene.add(new THREE.AmbientLight(0xd7d3a2, 4.0));

    // Create infinite ceiling (floor is per-chunk)
    createInfiniteCeiling();

    document.addEventListener('keydown', (e) => {
        if (e.code === 'KeyW') moveForward = true; if (e.code === 'KeyA') moveLeft = true;
        if (e.code === 'KeyS') moveBackward = true; if (e.code === 'KeyD') moveRight = true;
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
