import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Import modules
import { CHUNK_SIZE, PLAYER_RADIUS, WAKEUP_DURATION, FADE_DURATION, GAME_OVER_DELAY, DEBUG_SANITY_LEVELS, PHONE_INTERACT_DIST } from './constants.js';
import { POST_SHADER, FADE_SHADER, WAKEUP_SHADER } from './shaders/index.js';
import {
    initAudioContext,
    resumeAudioContext,
    loadAmbientSounds,
    loadPhonePickupSound,
    loadKidsLaughSound,
    updateHumVolume,
    updatePhoneRingVolume,
    stopPhoneRing,
    playPhonePickup,
    playAmbientFootsteps,
    playAmbientDoorClose,
    updateMasterDistortion,
    updateKidsLaughDistortion,
    fadeAllAudioToSilence,
    resetAudioForStartScreen,
    startGameAudio
} from './audio.js';
import {
    createHUD,
    updateHUDSanity,
    updateHUDCamera,
    updatePhoneInteractPrompt,
    showHUD,
    hideHUD,
    getHudScene,
    getHudCamera,
    setMobileHUD
} from './hud.js';
import { updateChunks, generateChunk } from './world.js';
import { updateBacteriaEntity, resetBacteriaState } from './entity.js';
import {
    detectMobile,
    isMobileDevice,
    getMovementState,
    getJoystickInput,
    isJoystickActive,
    resetMovementState,
    initKeyboardControls,
    initMouseControls,
    initTouchControls
} from './input.js';
import {
    createGlobalResources,
    loadOutletModel,
    loadWallPhoneModel,
    loadBacteriaModel,
    getResources,
    getMaterials,
    getBacteriaModel
} from './models.js';

/**
 * BACKROOMS - Level 0: The Lobby
 */

let scene, camera, renderer, composer, clock;
let wakeupPass = null;
let wakeupStartTime = -1;
let fadePass = null;
let fadeStartTime = -1;
let velocity = new THREE.Vector3();
let chunks = new Map();
let walls = [];
let lightPanels = [];
let phonePositions = [];
let phoneMeshes = [];
let playerSanity = 100;
let isStarted = false;
let debugMode = false;
let debugNormals = [];
let chunkBorders = [];
let debugSanityOverride = -1;
let nearestPhoneDist = Infinity;
let isInteractingWithPhone = false;
let isSanityGameOver = false;

// Raycaster for mobile phone tap interaction
let raycaster = new THREE.Raycaster();

let fpsFrames = 0;
let fpsPrevTime = performance.now();

function handleCollision(target) {
    const pBox = new THREE.Box3().setFromCenterAndSize(target, new THREE.Vector3(PLAYER_RADIUS * 2, 1.8, PLAYER_RADIUS * 2));
    for (let i = 0; i < walls.length; i++) {
        const wBox = new THREE.Box3().setFromObject(walls[i]);
        if (pBox.intersectsBox(wBox)) {
            const overlap = new THREE.Box3().copy(pBox).intersect(wBox);
            const size = new THREE.Vector3();
            overlap.getSize(size);
            const wPos = new THREE.Vector3();
            walls[i].getWorldPosition(wPos);
            if (size.x < size.z) target.x += (target.x > wPos.x ? 1 : -1) * size.x;
            else target.z += (target.z > wPos.z ? 1 : -1) * size.z;
        }
    }
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
        debugSanityOverride = -1;
    }
    console.log('Debug mode:', debugMode ? 'ON' : 'OFF');
}

function cycleSanityLevel(direction) {
    if (!debugMode) return;

    if (debugSanityOverride === -1) {
        debugSanityOverride = 0;
    } else {
        debugSanityOverride += direction;
        if (debugSanityOverride < 0) debugSanityOverride = DEBUG_SANITY_LEVELS.length - 1;
        if (debugSanityOverride >= DEBUG_SANITY_LEVELS.length) debugSanityOverride = 0;
    }

    playerSanity = DEBUG_SANITY_LEVELS[debugSanityOverride];
    console.log('Debug sanity level:', playerSanity + '%');
}

function interactWithPhone() {
    if (isInteractingWithPhone || nearestPhoneDist > PHONE_INTERACT_DIST) return;

    isInteractingWithPhone = true;
    stopPhoneRing();
    playPhonePickup();

    if (fadePass) {
        fadePass.enabled = true;
        fadeStartTime = performance.now();
    }
}

// Check if a tap/click hits a phone mesh (for mobile interaction)
function checkPhoneTap(clientX, clientY) {
    if (!camera || !renderer || phoneMeshes.length === 0) return false;

    // Convert screen coordinates to normalized device coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    // Check intersection with all phone meshes and their children
    const allPhoneObjects = [];
    for (const phone of phoneMeshes) {
        phone.traverse((child) => {
            if (child.isMesh) {
                allPhoneObjects.push(child);
            }
        });
        allPhoneObjects.push(phone);
    }

    const intersects = raycaster.intersectObjects(allPhoneObjects, true);

    if (intersects.length > 0) {
        // Check if the intersection is within interact distance
        const distance = intersects[0].distance;
        if (distance <= PHONE_INTERACT_DIST) {
            interactWithPhone();
            return true;
        }
    }

    return false;
}

function resetGameState() {
    document.getElementById('fps-counter').style.display = 'none';
    document.getElementById('crosshair').style.display = 'none';

    const touchControls = document.getElementById('touch-controls');
    if (touchControls) {
        touchControls.classList.remove('active');
    }

    document.getElementById('start-screen').style.display = 'flex';

    if (document.pointerLockElement) {
        document.exitPointerLock();
    }

    isStarted = false;
    isInteractingWithPhone = false;
    isSanityGameOver = false;
    playerSanity = 100;
    fadeStartTime = -1;

    // Reset audio for start screen (all sounds stopped)
    resetAudioForStartScreen();

    if (camera) {
        camera.position.set(0, 1.7, 0);
        camera.rotation.set(0, 0, 0);
    }

    resetMovementState();
    velocity.set(0, 0, 0);

    hideHUD();

    if (fadePass) {
        fadePass.enabled = false;
        fadePass.uniforms.fadeAmount.value = 0;
    }

    if (wakeupPass) {
        wakeupPass.enabled = false;
        wakeupPass.uniforms.eyeOpen.value = 0;
        wakeupPass.uniforms.blurAmount.value = 1.0;
        wakeupPass.uniforms.effectOpacity.value = 1.0;
    }

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
    phoneMeshes = [];
    chunkBorders = [];
    debugNormals = [];

    resetBacteriaState();
}

let doorCloseTimeout = null;
function scheduleAmbientDoorClose() {
    if (doorCloseTimeout) clearTimeout(doorCloseTimeout);

    const nextDoor = playAmbientDoorClose(isStarted, playerSanity, debugSanityOverride);
    if (nextDoor) {
        doorCloseTimeout = setTimeout(scheduleAmbientDoorClose, nextDoor);
    }
}

let footstepsTimeout = null;
function scheduleAmbientFootsteps() {
    if (footstepsTimeout) clearTimeout(footstepsTimeout);

    playAmbientFootsteps(isStarted);
    const nextFootsteps = 8000 + Math.random() * 17000;
    footstepsTimeout = setTimeout(scheduleAmbientFootsteps, nextFootsteps);
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

    const isMobile = isMobileDevice();
    const canMove = document.pointerLockElement === renderer.domElement || isMobile;

    if (canMove) {
        const speed = 4.0;
        const friction = 12.0;
        velocity.x -= velocity.x * friction * delta;
        velocity.z -= velocity.z * friction * delta;

        const input = new THREE.Vector3();
        const { moveForward, moveBackward, moveLeft, moveRight } = getMovementState();

        if (moveForward) input.z -= 1;
        if (moveBackward) input.z += 1;
        if (moveLeft) input.x -= 1;
        if (moveRight) input.x += 1;

        if (isMobile && isJoystickActive()) {
            const joystickInput = getJoystickInput();
            input.x += joystickInput.x;
            input.z += joystickInput.y;
        }

        input.normalize();

        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        fwd.y = 0;
        fwd.normalize();
        const rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        rgt.y = 0;
        rgt.normalize();

        const move = new THREE.Vector3().addScaledVector(fwd, -input.z).addScaledVector(rgt, input.x);
        velocity.addScaledVector(move, speed * friction * delta);

        const next = camera.position.clone().addScaledVector(velocity, delta);
        next.y = 1.7;
        handleCollision(next);
        camera.position.copy(next);

        if (debugSanityOverride === -1) {
            let drainRate = 0.337;
            if (playerSanity <= 10) {
                drainRate = 1.348;
            } else if (playerSanity <= 30) {
                drainRate = 0.899;
            } else if (playerSanity <= 50) {
                drainRate = 0.562;
            } else if (playerSanity <= 80) {
                drainRate = 0.449;
            }
            playerSanity -= delta * drainRate;
            playerSanity = Math.max(0, playerSanity);

            // Trigger game over when sanity reaches zero
            if (playerSanity <= 0 && !isSanityGameOver && !isInteractingWithPhone) {
                isSanityGameOver = true;
                fadeAllAudioToSilence(FADE_DURATION);
                if (fadePass) {
                    fadePass.enabled = true;
                    fadeStartTime = performance.now();
                }
            }
        }

        updateHUDSanity(playerSanity);
    }

    // Update master audio distortion based on sanity
    updateMasterDistortion(playerSanity, debugSanityOverride);

    // Update kids laugh sound (starts at 50% sanity, gets more distorted as sanity drops)
    updateKidsLaughDistortion(playerSanity, debugSanityOverride);

    const resources = getResources();
    updateChunks(camera, scene, chunks, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes);
    updateHumVolume(camera, lightPanels);
    nearestPhoneDist = updatePhoneRingVolume(camera, phonePositions);
    updatePhoneInteractPrompt(nearestPhoneDist, isInteractingWithPhone);

    const materials = getMaterials();
    updateBacteriaEntity(getBacteriaModel(), camera, scene, walls, materials, isStarted, playerSanity, debugSanityOverride);

    composer.passes[2].uniforms.time.value = clock.elapsedTime;
    composer.passes[2].uniforms.sanity.value = playerSanity / 100;

    // Update wake-up animation
    if (wakeupPass && wakeupStartTime >= 0) {
        const elapsed = (performance.now() - wakeupStartTime) / 1000;
        const progress = Math.min(elapsed / WAKEUP_DURATION, 1.0);

        let eyeOpen;
        if (progress < 0.12) {
            eyeOpen = Math.sin(progress / 0.12 * Math.PI) * 0.2;
        } else if (progress < 0.25) {
            const p = (progress - 0.12) / 0.13;
            eyeOpen = Math.sin(p * Math.PI) * 0.35;
        } else if (progress < 0.45) {
            const p = (progress - 0.25) / 0.2;
            eyeOpen = 0.25 + Math.sin(p * Math.PI) * 0.35;
        } else if (progress < 0.85) {
            const p = (progress - 0.45) / 0.4;
            const eased = 1 - Math.pow(1 - p, 3);
            eyeOpen = 0.5 + eased * 0.5;
        } else {
            eyeOpen = 1.0;
        }

        let effectOpacity = 1.0;
        if (progress > 0.7) {
            effectOpacity = 1.0 - ((progress - 0.7) / 0.3);
        }

        wakeupPass.uniforms.eyeOpen.value = eyeOpen;
        wakeupPass.uniforms.blurAmount.value = Math.max(0, (1.0 - progress * 1.5)) * effectOpacity;
        wakeupPass.uniforms.effectOpacity.value = effectOpacity;

        if (progress >= 1.0) {
            wakeupPass.enabled = false;
            wakeupStartTime = -1;
        }
    }

    // Update fade to black animation
    if (fadePass && fadeStartTime >= 0) {
        const elapsed = (performance.now() - fadeStartTime) / 1000;

        // For sanity game over, add delay after fade completes
        const totalDuration = isSanityGameOver ? FADE_DURATION + GAME_OVER_DELAY : FADE_DURATION;
        const fadeProgress = Math.min(elapsed / FADE_DURATION, 1.0);

        const eased = fadeProgress * fadeProgress;
        fadePass.uniforms.fadeAmount.value = eased;

        if (elapsed >= totalDuration) {
            resetGameState();
        }
    }

    composer.render();

    const hudScene = getHudScene();
    const hudCamera = getHudCamera();
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

    isInteractingWithPhone = false;
    playerSanity = 100;

    const isRestart = scene !== undefined && scene !== null;

    const isMobile = detectMobile();

    if (!isMobile) {
        document.getElementById('crosshair').style.display = 'block';
    }

    setTimeout(() => {
        showHUD();
        updateHUDSanity(playerSanity);
        setMobileHUD(isMobile); // Update prompt text for mobile
        if (isMobile) {
            initTouchControls(camera, resumeAudioContext, checkPhoneTap);
        }
    }, WAKEUP_DURATION * 1000);

    if (isRestart) {
        camera.position.set(0, 1.7, 0);
        camera.rotation.set(0, 0, 0);

        wakeupPass.uniforms.eyeOpen.value = 0.0;
        wakeupPass.uniforms.blurAmount.value = 1.0;
        wakeupPass.uniforms.effectOpacity.value = 1.0;
        wakeupPass.enabled = true;
        wakeupStartTime = performance.now();

        fadePass.enabled = false;
        fadePass.uniforms.fadeAmount.value = 0.0;

        resumeAudioContext();
        startGameAudio();

        isStarted = true;
        const resources = getResources();
        updateChunks(camera, scene, chunks, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes);
        return;
    }

    // First time initialization
    initAudioContext();
    createGlobalResources();

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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.4,
        0.5,
        0.7
    );
    composer.addPass(bloomPass);

    const effect = new ShaderPass(POST_SHADER);
    composer.addPass(effect);

    wakeupPass = new ShaderPass(WAKEUP_SHADER);
    wakeupPass.uniforms.eyeOpen.value = 0.0;
    wakeupPass.uniforms.blurAmount.value = 1.0;
    wakeupPass.uniforms.effectOpacity.value = 1.0;
    composer.addPass(wakeupPass);

    fadePass = new ShaderPass(FADE_SHADER);
    fadePass.uniforms.fadeAmount.value = 0.0;
    fadePass.enabled = false;
    composer.addPass(fadePass);

    wakeupStartTime = performance.now();

    clock = new THREE.Clock();

    scene.add(new THREE.AmbientLight(0xd7d3a2, 2.5));

    const playerLight = new THREE.PointLight(0xffffee, 0.5, 10, 2);
    playerLight.position.set(0, 0, 0);
    camera.add(playerLight);
    scene.add(camera);

    scene.fog = new THREE.FogExp2(0x333322, 0.02);

    createHUD();

    initKeyboardControls(toggleDebugMode, cycleSanityLevel, interactWithPhone);
    initMouseControls(renderer, camera, resumeAudioContext);

    loadAmbientSounds();
    loadPhonePickupSound();
    loadKidsLaughSound();
    setTimeout(scheduleAmbientFootsteps, 3000);
    setTimeout(scheduleAmbientDoorClose, 6000);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
        updateHUDCamera(playerSanity);
    });

    isStarted = true;
    const resources = getResources();
    updateChunks(camera, scene, chunks, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes);

    animate();
}

// Expose initGame globally for the HTML button
window.initGame = initGame;
