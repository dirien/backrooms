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
let wallGeoV, wallGeoH, floorGeo, ceilingGeo, lightPanelGeo, lightPanelMat;

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

function createGlobalResources() {
    // WALL TEXTURE - Load from file
    const textureLoader = new THREE.TextureLoader();
    const wallTex = textureLoader.load('/graphics/wallpaper.png');
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(1, 1);

    // SEAMLESS CARPET - using backrooms palette (yellow)
    const carpetCanvas = document.createElement('canvas');
    carpetCanvas.width = carpetCanvas.height = 1024;
    const cCtx = carpetCanvas.getContext('2d');
    cCtx.fillStyle = '#cfcca2';
    cCtx.fillRect(0, 0, 1024, 1024);

    for (let i = 0; i < 150; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        const r = 100 + Math.random() * 250;
        const g = cCtx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(100, 90, 50, ${0.05 + Math.random() * 0.05})`);
        g.addColorStop(1, 'rgba(30, 20, 10, 0)');
        cCtx.fillStyle = g;
        cCtx.beginPath(); cCtx.arc(x, y, r, 0, Math.PI * 2); cCtx.fill();
    }

    const imgData = cCtx.getImageData(0, 0, 1024, 1024);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const n = (Math.random() - 0.5) * 20;
        data[i] += n; data[i + 1] += n; data[i + 2] += n;
    }
    cCtx.putImageData(imgData, 0, 0);
    const carpetTex = new THREE.CanvasTexture(carpetCanvas);
    carpetTex.wrapS = carpetTex.wrapT = THREE.RepeatWrapping;

    // CEILING - using backrooms palette
    const ceilCanvas = document.createElement('canvas');
    ceilCanvas.width = ceilCanvas.height = 512;
    const ceCtx = ceilCanvas.getContext('2d');
    ceCtx.fillStyle = '#d7d3a2';
    ceCtx.fillRect(0, 0, 512, 512);
    ceCtx.strokeStyle = 'rgba(0,0,0,0.1)';
    ceCtx.lineWidth = 1;
    for (let i = 0; i <= 512; i += 64) {
        ceCtx.beginPath(); ceCtx.moveTo(i, 0); ceCtx.lineTo(i, 512); ceCtx.stroke();
        ceCtx.beginPath(); ceCtx.moveTo(0, i); ceCtx.lineTo(512, i); ceCtx.stroke();
    }
    const ceilTex = new THREE.CanvasTexture(ceilCanvas);
    ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;
    ceilTex.repeat.set(12, 12);

    wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1.0, metalness: 0, color: 0xffffff });
    floorMat = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1.0, metalness: 0, color: 0xffffff });
    ceilingMat = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1.0, metalness: 0, color: 0xaaaaaa });
    lightPanelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const gSize = 3;
    const cellSize = CHUNK_SIZE / gSize;
    floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    ceilingGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    lightPanelGeo = new THREE.PlaneGeometry(cellSize * 0.4, cellSize * 0.2);

    // Create wall geometries with proper UV mapping
    const wallThickness = 0.3;
    const wallHeight = 3;
    const wallLengthV = cellSize + 0.31;
    const wallLengthH = cellSize - 0.01;

    wallGeoV = createWallGeometry(wallThickness, wallHeight, wallLengthV);
    wallGeoH = createWallGeometry(wallLengthH, wallHeight, wallThickness);

}

function generateChunk(cx, cz) {
    const group = new THREE.Group();
    const seed = (cx * 12345) ^ (cz * 54321);
    const rnd = (s) => (Math.abs(Math.sin(s) * 10000) % 1);

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();
    group.add(floor);

    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 3;
    ceiling.matrixAutoUpdate = false;
    ceiling.updateMatrix();
    group.add(ceiling);

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
