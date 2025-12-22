import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * BACKROOMS - Level 0: The Lobby
 */

let scene, camera, renderer, composer, clock;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let velocity = new THREE.Vector3();
let chunks = new Map();
let walls = [];
let lightAnchors = [];
let activeLights = [];
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
const MAX_ACTIVE_LIGHTS = 32;

let audioCtx, whiteNoiseBuffer;

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

function createGlobalResources() {
    // SEAMLESS WALL TEXTURE
    const wallCanvas = document.createElement('canvas');
    wallCanvas.width = wallCanvas.height = 512;
    const wCtx = wallCanvas.getContext('2d');
    wCtx.fillStyle = '#ccb370';
    wCtx.fillRect(0, 0, 512, 512);

    wCtx.strokeStyle = 'rgba(0,0,0,0.06)';
    wCtx.lineWidth = 1;
    const step = 32;
    for (let y = 0; y <= 512 + step; y += step) {
        for (let x = 0; x <= 512 + step; x += step) {
            wCtx.beginPath();
            wCtx.moveTo(x, y - 10); wCtx.lineTo(x + 8, y); wCtx.lineTo(x + 10, y); wCtx.lineTo(x - 8, y);
            wCtx.closePath(); wCtx.stroke();
        }
    }

    const wallData = wCtx.getImageData(0, 0, 512, 512);
    const wD = wallData.data;
    for (let i = 0; i < wD.length; i += 4) {
        const n = (Math.random() - 0.5) * 12;
        wD[i] += n; wD[i + 1] += n; wD[i + 2] += n;
    }
    wCtx.putImageData(wallData, 0, 0);

    const wallTex = new THREE.CanvasTexture(wallCanvas);
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;

    // SEAMLESS CARPET
    const carpetCanvas = document.createElement('canvas');
    carpetCanvas.width = carpetCanvas.height = 1024;
    const cCtx = carpetCanvas.getContext('2d');
    cCtx.fillStyle = '#5c4d36';
    cCtx.fillRect(0, 0, 1024, 1024);

    for (let i = 0; i < 150; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        const r = 100 + Math.random() * 250;
        const g = cCtx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(30, 20, 10, ${0.1 + Math.random() * 0.1})`);
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

    // CEILING
    const ceilCanvas = document.createElement('canvas');
    ceilCanvas.width = ceilCanvas.height = 512;
    const ceCtx = ceilCanvas.getContext('2d');
    ceCtx.fillStyle = '#dbd2b8';
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

    wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1.0, metalness: 0, color: 0x999999 });
    floorMat = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1.0, metalness: 0, color: 0xcccccc });
    ceilingMat = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1.0, metalness: 0, color: 0xeeeeee });
    lightPanelMat = new THREE.MeshBasicMaterial({ color: 0xffffee });

    const gSize = 3;
    const cellSize = CHUNK_SIZE / gSize;
    wallGeoV = new THREE.BoxGeometry(0.3, 3, cellSize);
    wallGeoH = new THREE.BoxGeometry(cellSize, 3, 0.3);
    floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    ceilingGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    lightPanelGeo = new THREE.PlaneGeometry(cellSize * 0.4, cellSize * 0.2);

    // Generate Noise Buffer for slams
    const bufferSize = audioCtx.sampleRate * 2.0;
    whiteNoiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = whiteNoiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
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
            lightAnchors.push(new THREE.Vector3(lx + (cx * CHUNK_SIZE), 2.5, lz + (cz * CHUNK_SIZE)));
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
            lightAnchors = lightAnchors.filter(a => {
                const ax = Math.floor(a.x / CHUNK_SIZE); const az = Math.floor(a.z / CHUNK_SIZE);
                return Math.abs(ax - px) <= RENDER_DIST && Math.abs(az - pz) <= RENDER_DIST;
            });
            chunks.delete(key);
        }
    }
}

// --- PHANTOM SLAM SYSTEM ---

function playAmbientSlamSound() {
    if (!isStarted || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = (Math.random() * 2) - 1;
    panner.connect(audioCtx.destination);

    const intensity = Math.random();
    const duration = 0.6 + intensity * 0.4;

    const osc = audioCtx.createOscillator();
    const noise = audioCtx.createBufferSource();
    noise.buffer = whiteNoiseBuffer;

    const g = audioCtx.createGain();
    const f = audioCtx.createBiquadFilter();

    osc.frequency.setValueAtTime(35 + intensity * 20, audioCtx.currentTime);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(150 + intensity * 250, audioCtx.currentTime);

    const vol = 0.05 + intensity * 0.3;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    osc.connect(f); noise.connect(f); f.connect(g); g.connect(panner);
    osc.start(); noise.start();
    osc.stop(audioCtx.currentTime + duration); noise.stop(audioCtx.currentTime + duration);

    const nextDoor = 12000 + Math.random() * 20000;
    setTimeout(playAmbientSlamSound, nextDoor);
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

    const sorted = lightAnchors.map(a => ({ a, d: a.distanceToSquared(camera.position) })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < MAX_ACTIVE_LIGHTS; i++) {
        if (i < sorted.length) {
            activeLights[i].position.copy(sorted[i].a);
            activeLights[i].intensity = 80;
            activeLights[i].decay = 2;
            activeLights[i].distance = 20;
        } else activeLights[i].intensity = 0;
    }

    composer.passes[1].uniforms.time.value = clock.elapsedTime;
    composer.passes[1].uniforms.sanity.value = playerSanity / 100;
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
    const effect = new ShaderPass(POST_SHADER);
    composer.addPass(effect);

    clock = new THREE.Clock();
    scene.add(new THREE.AmbientLight(0xd1c28c, 0.5));

    for (let i = 0; i < MAX_ACTIVE_LIGHTS; i++) {
        const p = new THREE.PointLight(0xffffdd, 0, 15);
        scene.add(p); activeLights.push(p);
    }

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

    // HUM
    const humOsc = audioCtx.createOscillator();
    const humGain = audioCtx.createGain();
    const humFilter = audioCtx.createBiquadFilter();
    humOsc.type = 'sawtooth'; humOsc.frequency.value = 60;
    humFilter.frequency.value = 140;
    humGain.gain.value = 0.008;
    humOsc.connect(humFilter); humFilter.connect(humGain); humGain.connect(audioCtx.destination);
    humOsc.start();

    // Audio Presence
    setTimeout(playAmbientSlamSound, 8000);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });

    isStarted = true; updateChunks(); animate();
}

// Expose initGame globally for the HTML button
window.initGame = initGame;
