import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Import modules
import { PLAYER_RADIUS, WAKEUP_DURATION, FADE_DURATION, GAME_OVER_DELAY, DEBUG_SANITY_LEVELS, PHONE_INTERACT_DIST } from './constants.js';
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
import { updateChunks } from './world.js';
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
import { DEFAULT_LEVEL_ID, getLevelById, BACKROOM_LEVELS } from './levels.js';
import { createLevelMenu } from './menu.js';
import { randomBetween } from './random.js';

/**
 * BACKROOMS - Level 0: The Lobby
 */

let scene, camera, renderer, composer, clock;
let wakeupPass = null;
let wakeupStartTime = -1;
let fadePass = null;
let fadeStartTime = -1;
const velocity = new THREE.Vector3();
const chunks = new Map();
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
let currentLevel = getLevelById(DEFAULT_LEVEL_ID);
let menuController = null;
let ambientLight = null;
let playerLight = null;

// Raycaster for mobile phone tap interaction
const raycaster = new THREE.Raycaster();
const collisionPlayerBounds = new THREE.Box3();
const collisionWallBounds = new THREE.Box3();
const collisionOverlapBounds = new THREE.Box3();
const collisionOverlapSize = new THREE.Vector3();
const wallWorldPosition = new THREE.Vector3();
const phoneTapCoordinates = new THREE.Vector2();
const movementInput = new THREE.Vector3();
const forwardDirection = new THREE.Vector3();
const rightDirection = new THREE.Vector3();
const movementVector = new THREE.Vector3();
const nextCameraPosition = new THREE.Vector3();
const bloomPassSize = new THREE.Vector2();

let fpsCounterElement = null;
let fpsValueElement = null;
let crosshairElement = null;
let startScreenElement = null;
let touchControlsElement = null;

let fpsFrames = 0;
let fpsPrevTime = performance.now();

function handleCollision(target) {
    collisionPlayerBounds.setFromCenterAndSize(target, wallWorldPosition.set(PLAYER_RADIUS * 2, 1.8, PLAYER_RADIUS * 2));

    for (const wall of walls) {
        collisionWallBounds.copy(wall.userData.worldBox);

        if (collisionPlayerBounds.intersectsBox(collisionWallBounds)) {
            collisionOverlapBounds.copy(collisionPlayerBounds).intersect(collisionWallBounds);
            collisionOverlapBounds.getSize(collisionOverlapSize);
            wall.getWorldPosition(wallWorldPosition);

            if (collisionOverlapSize.x < collisionOverlapSize.z) {
                target.x += (target.x > wallWorldPosition.x ? 1 : -1) * collisionOverlapSize.x;
            } else {
                target.z += (target.z > wallWorldPosition.z ? 1 : -1) * collisionOverlapSize.z;
            }
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

    phoneTapCoordinates.set(x, y);
    raycaster.setFromCamera(phoneTapCoordinates, camera);

    const intersects = raycaster.intersectObjects(phoneMeshes, false);

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
    fpsCounterElement.style.display = 'none';
    crosshairElement.style.display = 'none';
    touchControlsElement?.classList.remove('active');
    startScreenElement.style.display = 'flex';
    document.title = 'Backrooms';
    menuController?.showSelection();

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

    clearWorldState();
    clearAmbientTimers();

    resetBacteriaState();
}

let doorCloseTimeout = null;
function scheduleAmbientDoorClose() {
    clearDoorCloseTimeout();

    const nextDoor = playAmbientDoorClose(isStarted, playerSanity, debugSanityOverride);
    if (nextDoor) {
        doorCloseTimeout = setTimeout(scheduleAmbientDoorClose, nextDoor);
    }
}

let footstepsTimeout = null;
function scheduleAmbientFootsteps() {
    clearFootstepsTimeout();

    playAmbientFootsteps(isStarted);
    const nextFootsteps = randomBetween(8000, 25000);
    footstepsTimeout = setTimeout(scheduleAmbientFootsteps, nextFootsteps);
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    updateFpsCounter();

    const isMobile = isMobileDevice();
    const canMove = document.pointerLockElement === renderer.domElement || isMobile;

    if (canMove) {
        updatePlayerMovement(delta, isMobile);
        drainPlayerSanity(delta);
        updateHUDSanity(playerSanity);
    }

    updateRuntimeSystems();
    updateScreenEffects();

    composer.render();
    renderHud();
}

async function initGame(level = currentLevel) {
    currentLevel = level;
    startScreenElement.style.display = 'none';
    fpsCounterElement.style.display = 'block';
    document.title = `Backrooms - ${currentLevel.detailTitle}`;

    isInteractingWithPhone = false;
    playerSanity = 100;

    const isRestart = scene !== undefined && scene !== null;

    const isMobile = detectMobile();

    if (!isMobile) {
        crosshairElement.style.display = 'block';
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
        createGlobalResources(currentLevel.theme);
        applyLevelTheme(currentLevel);
        camera.position.set(0, 1.7, 0);
        camera.rotation.set(0, 0, 0);

        wakeupPass.uniforms.eyeOpen.value = 0.0;
        wakeupPass.uniforms.blurAmount.value = 1.0;
        wakeupPass.uniforms.effectOpacity.value = 1.0;
        wakeupPass.enabled = true;
        wakeupStartTime = performance.now();

        fadePass.enabled = false;
        fadePass.uniforms.fadeAmount.value = 0;

        resumeAudioContext();
        startGameAudio();

        isStarted = true;
        const resources = getResources();
        updateChunks(camera, scene, chunks, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes);
        return;
    }

    // First time initialization
    initAudioContext();
    createGlobalResources(currentLevel.theme);

    await Promise.all([
        loadOutletModel(),
        loadWallPhoneModel(),
        loadBacteriaModel()
    ]);

    scene = new THREE.Scene();
    applyLevelTheme(currentLevel);

    camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 400);
    camera.position.set(0, 1.7, 0);

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.append(renderer.domElement);

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomPass = new UnrealBloomPass(
        bloomPassSize.set(window.innerWidth, window.innerHeight),
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

    ambientLight = new THREE.AmbientLight(currentLevel.theme.ambientLightColor, currentLevel.theme.ambientLightIntensity);
    scene.add(ambientLight);

    playerLight = new THREE.PointLight(currentLevel.theme.playerLightColor, currentLevel.theme.playerLightIntensity, 10, 2);
    playerLight.position.set(0, 0, 0);
    camera.add(playerLight);
    scene.add(camera);

    createHUD();

    initKeyboardControls(toggleDebugMode, cycleSanityLevel, interactWithPhone);
    initMouseControls(renderer, camera, resumeAudioContext);

    loadAmbientSounds();
    loadPhonePickupSound();
    loadKidsLaughSound();
    setTimeout(scheduleAmbientFootsteps, 3000);
    setTimeout(scheduleAmbientDoorClose, 6000);

    globalThis.addEventListener('resize', () => {
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

function cacheDomElements() {
    fpsCounterElement = document.getElementById('fps-counter');
    fpsValueElement = document.getElementById('fps-val');
    crosshairElement = document.getElementById('crosshair');
    startScreenElement = document.getElementById('start-screen');
    touchControlsElement = document.getElementById('touch-controls');
}

function clearWorldState() {
    if (!scene) {
        return;
    }

    for (const [key, chunk] of chunks.entries()) {
        scene.remove(chunk);
        if (chunk.userData.border) {
            scene.remove(chunk.userData.border);
        }
        chunks.delete(key);
    }

    walls = [];
    lightPanels = [];
    phonePositions = [];
    phoneMeshes = [];
    chunkBorders = [];
    debugNormals = [];
}

function clearDoorCloseTimeout() {
    if (doorCloseTimeout) {
        clearTimeout(doorCloseTimeout);
        doorCloseTimeout = null;
    }
}

function clearFootstepsTimeout() {
    if (footstepsTimeout) {
        clearTimeout(footstepsTimeout);
        footstepsTimeout = null;
    }
}

function clearAmbientTimers() {
    clearDoorCloseTimeout();
    clearFootstepsTimeout();
}

function updateFpsCounter() {
    fpsFrames++;
    const currentTime = performance.now();

    if (currentTime >= fpsPrevTime + 1000) {
        fpsValueElement.textContent = String(Math.round((fpsFrames * 1000) / (currentTime - fpsPrevTime)));
        fpsFrames = 0;
        fpsPrevTime = currentTime;
    }
}

function updatePlayerMovement(delta, isMobile) {
    const speed = 4;
    const friction = 12;

    velocity.x -= velocity.x * friction * delta;
    velocity.z -= velocity.z * friction * delta;

    movementInput.set(0, 0, 0);
    const { moveForward, moveBackward, moveLeft, moveRight } = getMovementState();

    if (moveForward) movementInput.z -= 1;
    if (moveBackward) movementInput.z += 1;
    if (moveLeft) movementInput.x -= 1;
    if (moveRight) movementInput.x += 1;

    if (isMobile && isJoystickActive()) {
        const joystickInput = getJoystickInput();
        movementInput.x += joystickInput.x;
        movementInput.z += joystickInput.y;
    }

    movementInput.normalize();

    forwardDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);
    forwardDirection.y = 0;
    forwardDirection.normalize();

    rightDirection.set(1, 0, 0).applyQuaternion(camera.quaternion);
    rightDirection.y = 0;
    rightDirection.normalize();

    movementVector
        .copy(forwardDirection)
        .multiplyScalar(-movementInput.z)
        .addScaledVector(rightDirection, movementInput.x);

    velocity.addScaledVector(movementVector, speed * friction * delta);

    nextCameraPosition.copy(camera.position).addScaledVector(velocity, delta);
    nextCameraPosition.y = 1.7;
    handleCollision(nextCameraPosition);
    camera.position.copy(nextCameraPosition);
}

function drainPlayerSanity(delta) {
    if (debugSanityOverride !== -1) {
        return;
    }

    playerSanity -= delta * getSanityDrainRate(playerSanity);
    playerSanity = Math.max(0, playerSanity);

    if (playerSanity <= 0 && !isSanityGameOver && !isInteractingWithPhone) {
        isSanityGameOver = true;
        fadeAllAudioToSilence(FADE_DURATION);

        if (fadePass) {
            fadePass.enabled = true;
            fadeStartTime = performance.now();
        }
    }
}

function getSanityDrainRate(sanity) {
    if (sanity <= 10) {
        return 1.348;
    }

    if (sanity <= 30) {
        return 0.899;
    }

    if (sanity <= 50) {
        return 0.562;
    }

    if (sanity <= 80) {
        return 0.449;
    }

    return 0.337;
}

function updateRuntimeSystems() {
    updateMasterDistortion(playerSanity, debugSanityOverride);
    updateKidsLaughDistortion(playerSanity, debugSanityOverride);

    const resources = getResources();
    updateChunks(camera, scene, chunks, resources, debugMode, debugNormals, chunkBorders, walls, lightPanels, phonePositions, phoneMeshes);
    updateHumVolume(camera, lightPanels);
    nearestPhoneDist = updatePhoneRingVolume(camera, phonePositions);
    updatePhoneInteractPrompt(nearestPhoneDist, isInteractingWithPhone);

    updateBacteriaEntity(
        getBacteriaModel(),
        camera,
        scene,
        walls,
        getMaterials(),
        isStarted,
        playerSanity,
        debugSanityOverride,
    );

    composer.passes[2].uniforms.time.value = clock.elapsedTime;
    composer.passes[2].uniforms.sanity.value = playerSanity / 100;
}

function updateScreenEffects() {
    updateWakeupEffect();
    updateFadeEffect();
}

function updateWakeupEffect() {
    if (!wakeupPass || wakeupStartTime < 0) {
        return;
    }

    const elapsed = (performance.now() - wakeupStartTime) / 1000;
    const progress = Math.min(elapsed / WAKEUP_DURATION, 1);
    const eyeOpen = getWakeupEyeOpen(progress);
    const effectOpacity = progress > 0.7 ? 1 - ((progress - 0.7) / 0.3) : 1;

    wakeupPass.uniforms.eyeOpen.value = eyeOpen;
    wakeupPass.uniforms.blurAmount.value = Math.max(0, (1 - progress * 1.5)) * effectOpacity;
    wakeupPass.uniforms.effectOpacity.value = effectOpacity;

    if (progress >= 1) {
        wakeupPass.enabled = false;
        wakeupStartTime = -1;
    }
}

function getWakeupEyeOpen(progress) {
    if (progress < 0.12) {
        return Math.sin(progress / 0.12 * Math.PI) * 0.2;
    }

    if (progress < 0.25) {
        const segmentProgress = (progress - 0.12) / 0.13;
        return Math.sin(segmentProgress * Math.PI) * 0.35;
    }

    if (progress < 0.45) {
        const segmentProgress = (progress - 0.25) / 0.2;
        return 0.25 + Math.sin(segmentProgress * Math.PI) * 0.35;
    }

    if (progress < 0.85) {
        const segmentProgress = (progress - 0.45) / 0.4;
        const eased = 1 - (1 - segmentProgress) ** 3;
        return 0.5 + eased * 0.5;
    }

    return 1;
}

function updateFadeEffect() {
    if (!fadePass || fadeStartTime < 0) {
        return;
    }

    const elapsed = (performance.now() - fadeStartTime) / 1000;
    const totalDuration = isSanityGameOver ? FADE_DURATION + GAME_OVER_DELAY : FADE_DURATION;
    const fadeProgress = Math.min(elapsed / FADE_DURATION, 1);

    fadePass.uniforms.fadeAmount.value = fadeProgress ** 2;

    if (elapsed >= totalDuration) {
        resetGameState();
    }
}

function renderHud() {
    const hudScene = getHudScene();
    const hudCamera = getHudCamera();

    if (!hudScene || !hudScene.visible) {
        return;
    }

    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(hudScene, hudCamera);
    renderer.autoClear = true;
}

function applyLevelTheme(level) {
    if (!scene) {
        return;
    }

    scene.background = new THREE.Color(level.theme.sceneBackground);
    scene.fog = new THREE.FogExp2(level.theme.fogColor, level.theme.fogDensity);

    if (ambientLight) {
        ambientLight.color.setHex(level.theme.ambientLightColor);
        ambientLight.intensity = level.theme.ambientLightIntensity;
    }

    if (playerLight) {
        playerLight.color.setHex(level.theme.playerLightColor);
        playerLight.intensity = level.theme.playerLightIntensity;
    }
}

cacheDomElements();
menuController = createLevelMenu(BACKROOM_LEVELS, initGame);
