import { PHONE_AUDIO_CLOSE_DIST, PHONE_AUDIO_MAX_DIST, DEBUG_SANITY_LEVELS } from './constants.js';
import { randomBetween } from './random.js';

/**
 * Audio system for ambient sounds and phone interaction
 */

let audioCtx = null;
let footstepsBuffer = null;
let doorCloseBuffer = null;
let kidsLaughBuffer = null;
let humBuffer = null;
let humGainNode = null;
let humSource = null;

let phoneRingBuffer = null;
let phoneRingSource = null;
let phoneRingGainNode = null;
let phonePickupBuffer = null;

// Kids laugh looping sound
let kidsLaughSource = null;
let kidsLaughGainNode = null;
let kidsLaughDistortion = null;
let kidsLaughFilter = null;
let kidsLaughDelay = null;
let kidsLaughDelayGain = null;
let isKidsLaughPlaying = false;

// Global distortion chain nodes
let masterDistortion = null;
let masterFilter = null;
let masterDelay = null;
let masterDelayGain = null;
let masterDryGain = null;
let masterOutput = null;
let currentSanityFactor = 0;
const distortionCurveCache = new Map();

// Export state getters
export function getAudioContext() {
    return audioCtx;
}

export function getKidsLaughBuffer() {
    return kidsLaughBuffer;
}

export function initAudioContext() {
    if (!audioCtx) {
        const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
        audioCtx = new AudioContextConstructor();
        initMasterDistortionChain();
    }
    return audioCtx;
}

function initMasterDistortionChain() {
    if (!audioCtx || masterOutput) return;

    // Create master output gain node
    masterOutput = audioCtx.createGain();
    masterOutput.gain.value = 1.0;
    masterOutput.connect(audioCtx.destination);

    // Create dry path (unaffected signal)
    masterDryGain = audioCtx.createGain();
    masterDryGain.gain.value = 1.0;
    masterDryGain.connect(masterOutput);

    // Create distortion
    masterDistortion = audioCtx.createWaveShaper();
    masterDistortion.curve = makeDistortionCurve(0);
    masterDistortion.oversample = '4x';

    // Create filter for muffling at low sanity
    masterFilter = audioCtx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.value = 22000;
    masterFilter.Q.value = 1;

    // Create delay for echo effect
    masterDelay = audioCtx.createDelay();
    masterDelay.delayTime.value = 0;
    masterDelayGain = audioCtx.createGain();
    masterDelayGain.gain.value = 0;

    // Connect wet path: distortion -> filter -> output
    masterDistortion.connect(masterFilter);
    masterFilter.connect(masterOutput);
    masterFilter.connect(masterDelay);
    masterDelay.connect(masterDelayGain);
    masterDelayGain.connect(masterOutput);
}

/**
 * Get the master output node for routing sounds through distortion
 * @returns {AudioNode} The node to connect sounds to
 */
export function getMasterOutput() {
    return masterDryGain || (audioCtx ? audioCtx.destination : null);
}

/**
 * Get the distorted output node for routing sounds through distortion effects
 * @returns {AudioNode} The distortion input node
 */
export function getDistortedOutput() {
    return masterDistortion || getMasterOutput();
}

/**
 * Update the master distortion chain based on sanity level
 * @param {number} sanity - Current sanity (0-100)
 * @param {number} debugSanityOverride - Debug override index (-1 for none)
 */
export function updateMasterDistortion(sanity, debugSanityOverride) {
    if (!audioCtx || !masterDistortion) return;

    const effectiveSanity = debugSanityOverride >= 0 ? DEBUG_SANITY_LEVELS[debugSanityOverride] : sanity;
    currentSanityFactor = effectiveSanity > 50 ? 0 : 1 - (effectiveSanity / 50);

    // Update distortion curve
    const distortionAmount = currentSanityFactor * 30;
    masterDistortion.curve = makeDistortionCurve(distortionAmount);

    // Update filter (muffle sounds at low sanity)
    const filterFreq = 22000 - currentSanityFactor * 18000; // 22000 -> 4000 Hz
    masterFilter.frequency.setTargetAtTime(filterFreq, audioCtx.currentTime, 0.1);
    masterFilter.Q.setTargetAtTime(1 + currentSanityFactor * 8, audioCtx.currentTime, 0.1);

    // Update delay/echo
    masterDelay.delayTime.setTargetAtTime(0.05 + currentSanityFactor * 0.12, audioCtx.currentTime, 0.1);
    masterDelayGain.gain.setTargetAtTime(currentSanityFactor * 0.35, audioCtx.currentTime, 0.1);

    // Balance dry/wet mix
    masterDryGain.gain.setTargetAtTime(1 - currentSanityFactor * 0.3, audioCtx.currentTime, 0.1);
}

export function resumeAudioContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

export async function loadAmbientSounds() {
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

        startHumSound();
        startPhoneRingSound();
    } catch (error) {
        console.warn('Failed to load ambient sounds:', error);
    }
}

function startHumSound() {
    if (!humBuffer || !audioCtx) return;

    humSource = audioCtx.createBufferSource();
    humSource.buffer = humBuffer;
    humSource.loop = true;

    humGainNode = audioCtx.createGain();
    humGainNode.gain.value = 0.12;

    humSource.connect(humGainNode);
    humGainNode.connect(getDistortedOutput());
    humSource.start();
}

function startPhoneRingSound() {
    if (!phoneRingBuffer || !audioCtx) return;

    phoneRingSource = audioCtx.createBufferSource();
    phoneRingSource.buffer = phoneRingBuffer;
    phoneRingSource.loop = true;

    phoneRingGainNode = audioCtx.createGain();
    phoneRingGainNode.gain.value = 0;

    phoneRingSource.connect(phoneRingGainNode);
    phoneRingGainNode.connect(getDistortedOutput());
    phoneRingSource.start();
}

function restartHumSound() {
    if (!humBuffer || !audioCtx) return;

    stopAudioSource(humSource);

    humSource = audioCtx.createBufferSource();
    humSource.buffer = humBuffer;
    humSource.loop = true;

    if (!humGainNode) {
        humGainNode = audioCtx.createGain();
        humGainNode.connect(getDistortedOutput());
    }
    humGainNode.gain.value = 0.12;

    humSource.connect(humGainNode);
    humSource.start();
}

function restartPhoneRingSound() {
    if (!phoneRingBuffer || !audioCtx) return;

    stopAudioSource(phoneRingSource);

    phoneRingSource = audioCtx.createBufferSource();
    phoneRingSource.buffer = phoneRingBuffer;
    phoneRingSource.loop = true;

    if (!phoneRingGainNode) {
        phoneRingGainNode = audioCtx.createGain();
        phoneRingGainNode.connect(getDistortedOutput());
    }
    phoneRingGainNode.gain.value = 0;

    phoneRingSource.connect(phoneRingGainNode);
    phoneRingSource.start();
}

export async function loadPhonePickupSound() {
    try {
        const response = await fetch('https://cdn.pixabay.com/download/audio/2022/03/10/audio_6650ed59b7.mp3?filename=phone-pick-up-46796.mp3');
        const arrayBuffer = await response.arrayBuffer();
        phonePickupBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (error) {
        console.warn('Failed to load phone pick-up sound:', error);
    }
}

export async function loadKidsLaughSound() {
    try {
        const response = await fetch('/sounds/kids-laugh.mp3');
        const arrayBuffer = await response.arrayBuffer();
        kidsLaughBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (error) {
        console.warn('Failed to load kids laughing sound:', error);
    }
}

export function updateHumVolume(camera, lightPanels) {
    if (!humGainNode || !camera || lightPanels.length === 0) return;

    let minDist = Infinity;
    const playerPos = camera.position;

    for (const panel of lightPanels) {
        const panelWorldPos = panel.userData.worldPosition;
        const dist = playerPos.distanceTo(panelWorldPos);
        if (dist < minDist) minDist = dist;
    }

    const maxDist = 5;
    const proximity = Math.max(0, 1 - (minDist / maxDist));
    const volume = 0.18 + proximity * 0.54;

    humGainNode.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.1);
}

export function updatePhoneRingVolume(camera, phonePositions) {
    if (!phoneRingGainNode || !camera || phonePositions.length === 0) {
        if (phoneRingGainNode) {
            phoneRingGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        }
        return Infinity;
    }

    let minDist = Infinity;
    const playerPos = camera.position;

    for (const phonePos of phonePositions) {
        const dist = playerPos.distanceTo(phonePos);
        if (dist < minDist) minDist = dist;
    }

    const volume = getPhoneRingVolume(minDist);

    phoneRingGainNode.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.1);

    return minDist;
}

export function stopPhoneRing() {
    stopAudioSource(phoneRingSource);
    phoneRingSource = null;
    if (phoneRingGainNode) {
        phoneRingGainNode.gain.value = 0;
    }
}

/**
 * Fade all audio to silence over the specified duration, then stop all sounds
 * @param {number} duration - Fade duration in seconds
 */
export function fadeAllAudioToSilence(duration) {
    if (!audioCtx) return;

    const currentTime = audioCtx.currentTime;
    const fadeEndTime = currentTime + duration;

    // Fade hum to silence
    if (humGainNode) {
        humGainNode.gain.setValueAtTime(humGainNode.gain.value, currentTime);
        humGainNode.gain.linearRampToValueAtTime(0, fadeEndTime);
    }

    // Fade phone ring to silence
    if (phoneRingGainNode) {
        phoneRingGainNode.gain.setValueAtTime(phoneRingGainNode.gain.value, currentTime);
        phoneRingGainNode.gain.linearRampToValueAtTime(0, fadeEndTime);
    }

    // Fade kids laugh to silence
    if (kidsLaughGainNode) {
        kidsLaughGainNode.gain.setValueAtTime(kidsLaughGainNode.gain.value, currentTime);
        kidsLaughGainNode.gain.linearRampToValueAtTime(0, fadeEndTime);
    }

    // Fade master output to silence
    if (masterOutput) {
        masterOutput.gain.setValueAtTime(masterOutput.gain.value, currentTime);
        masterOutput.gain.linearRampToValueAtTime(0, fadeEndTime);
    }

    // Schedule stopping all sounds after fade completes
    setTimeout(() => {
        stopAllSounds();
    }, duration * 1000);
}

/**
 * Stop all currently playing sounds
 */
export function stopAllSounds() {
    humSource = stopAndClearSource(humSource);
    phoneRingSource = stopAndClearSource(phoneRingSource);
    kidsLaughSource = stopAndClearSource(kidsLaughSource);
    isKidsLaughPlaying = false;

    // Reset gain nodes to zero
    if (humGainNode) {
        humGainNode.gain.value = 0;
    }
    if (phoneRingGainNode) {
        phoneRingGainNode.gain.value = 0;
    }
    if (kidsLaughGainNode) {
        kidsLaughGainNode.gain.value = 0;
    }
    if (masterOutput) {
        masterOutput.gain.value = 0;
    }
}

/**
 * Reset audio state for start screen (no sounds playing)
 */
export function resetAudioForStartScreen() {
    if (!audioCtx) return;

    // Make sure all sounds are stopped
    stopAllSounds();

    // Reset distortion parameters
    currentSanityFactor = 0;
    if (masterDistortion) {
        masterDistortion.curve = makeDistortionCurve(0);
    }
    if (masterFilter) {
        masterFilter.frequency.value = 22000;
        masterFilter.Q.value = 1;
    }
    if (masterDelay) {
        masterDelay.delayTime.value = 0;
    }
    if (masterDelayGain) {
        masterDelayGain.gain.value = 0;
    }
    if (masterDryGain) {
        masterDryGain.gain.value = 1.0;
    }
}

/**
 * Start all game audio when game begins
 */
export function startGameAudio() {
    if (!audioCtx) return;

    // Reset master output
    if (masterOutput) {
        masterOutput.gain.value = 1.0;
    }

    // Restart hum sound
    if (humBuffer) {
        restartHumSound();
    }

    // Restart phone ring sound
    if (phoneRingBuffer) {
        restartPhoneRingSound();
    }
}

export function playPhonePickup() {
    if (phonePickupBuffer && audioCtx) {
        const source = audioCtx.createBufferSource();
        source.buffer = phonePickupBuffer;

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.8;

        source.connect(gainNode);
        gainNode.connect(getDistortedOutput());
        source.start();
    }
}

export function playAmbientFootsteps(isStarted) {
    if (!isStarted || !audioCtx || !footstepsBuffer) {
        return;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const source = audioCtx.createBufferSource();
    source.buffer = footstepsBuffer;

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = randomBetween(-1, 1);

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = randomBetween(0.3, 0.8);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = randomBetween(600, 1400);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(getDistortedOutput());

    source.start();
}

function makeDistortionCurve(amount) {
    const cacheKey = Math.round(amount);
    if (distortionCurveCache.has(cacheKey)) {
        return distortionCurveCache.get(cacheKey);
    }

    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }

    distortionCurveCache.set(cacheKey, curve);
    return curve;
}

/**
 * Start the kids laugh looping sound (called once when sanity drops to 50%)
 */
function startKidsLaughLoop() {
    if (!kidsLaughBuffer || !audioCtx || isKidsLaughPlaying) return;

    isKidsLaughPlaying = true;

    kidsLaughSource = audioCtx.createBufferSource();
    kidsLaughSource.buffer = kidsLaughBuffer;
    kidsLaughSource.loop = true;

    // Create gain node
    kidsLaughGainNode = audioCtx.createGain();
    kidsLaughGainNode.gain.value = 0.15;

    // Create distortion
    kidsLaughDistortion = audioCtx.createWaveShaper();
    kidsLaughDistortion.curve = makeDistortionCurve(0);
    kidsLaughDistortion.oversample = '4x';

    // Create filter
    kidsLaughFilter = audioCtx.createBiquadFilter();
    kidsLaughFilter.type = 'bandpass';
    kidsLaughFilter.frequency.value = 1000;
    kidsLaughFilter.Q.value = 2;

    // Create delay for echo effect
    kidsLaughDelay = audioCtx.createDelay();
    kidsLaughDelay.delayTime.value = 0.1;
    kidsLaughDelayGain = audioCtx.createGain();
    kidsLaughDelayGain.gain.value = 0.2;

    // Connect: source -> distortion -> filter -> gain -> output
    //                                  filter -> delay -> delayGain -> gain
    kidsLaughSource.connect(kidsLaughDistortion);
    kidsLaughDistortion.connect(kidsLaughFilter);
    kidsLaughFilter.connect(kidsLaughGainNode);
    kidsLaughFilter.connect(kidsLaughDelay);
    kidsLaughDelay.connect(kidsLaughDelayGain);
    kidsLaughDelayGain.connect(kidsLaughGainNode);
    kidsLaughGainNode.connect(getDistortedOutput());

    kidsLaughSource.start();
}

/**
 * Stop the kids laugh looping sound
 */
function stopKidsLaughLoop() {
    if (kidsLaughSource) {
        kidsLaughSource = stopAndClearSource(kidsLaughSource);
    }
    isKidsLaughPlaying = false;
}

/**
 * Update kids laugh sound effects based on sanity level
 * @param {number} sanity - Current sanity (0-100)
 * @param {number} debugSanityOverride - Debug override index (-1 for none)
 */
export function updateKidsLaughDistortion(sanity, debugSanityOverride) {
    const effectiveSanity = debugSanityOverride >= 0 ? DEBUG_SANITY_LEVELS[debugSanityOverride] : sanity;

    // Start kids laugh when sanity drops to 50% or below
    if (effectiveSanity <= 50 && kidsLaughBuffer && !isKidsLaughPlaying) {
        startKidsLaughLoop();
    }

    // Stop kids laugh if sanity goes above 50% (e.g., in debug mode)
    if (effectiveSanity > 50 && isKidsLaughPlaying) {
        stopKidsLaughLoop();
    }

    // Update distortion parameters if playing
    if (!isKidsLaughPlaying || !audioCtx) return;

    // sanityFactor: 0 at 50% sanity, 1 at 0% sanity
    const sanityFactor = 1 - (effectiveSanity / 50);

    // Update gain (louder at lower sanity)
    if (kidsLaughGainNode) {
        const targetGain = 0.15 + sanityFactor * 0.5;
        kidsLaughGainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.3);
    }

    // Update distortion (more distorted at lower sanity)
    if (kidsLaughDistortion) {
        const distortionAmount = sanityFactor * 50;
        kidsLaughDistortion.curve = makeDistortionCurve(distortionAmount);
    }

    // Update filter (more muffled/creepy at lower sanity)
    if (kidsLaughFilter) {
        if (effectiveSanity <= 20) {
            kidsLaughFilter.type = 'lowpass';
            kidsLaughFilter.frequency.setTargetAtTime(600 + (1 - sanityFactor) * 400, audioCtx.currentTime, 0.3);
            kidsLaughFilter.Q.setTargetAtTime(5 + sanityFactor * 10, audioCtx.currentTime, 0.3);
        } else {
            kidsLaughFilter.type = 'bandpass';
            kidsLaughFilter.frequency.setTargetAtTime(800 + (1 - sanityFactor) * 400, audioCtx.currentTime, 0.3);
            kidsLaughFilter.Q.setTargetAtTime(2 + sanityFactor * 5, audioCtx.currentTime, 0.3);
        }
    }

    // Update delay (more echo at lower sanity)
    if (kidsLaughDelay) {
        kidsLaughDelay.delayTime.setTargetAtTime(0.1 + sanityFactor * 0.15, audioCtx.currentTime, 0.3);
    }
    if (kidsLaughDelayGain) {
        kidsLaughDelayGain.gain.setTargetAtTime(0.2 + sanityFactor * 0.3, audioCtx.currentTime, 0.3);
    }

    // Update playback rate (slower/creepier at lower sanity)
    if (kidsLaughSource) {
        const basePitch = 1.0 - sanityFactor * 0.3;
        kidsLaughSource.playbackRate.setTargetAtTime(basePitch, audioCtx.currentTime, 0.3);
    }
}

export function playAmbientDoorClose(isStarted, playerSanity, debugSanityOverride) {
    if (!isStarted || !audioCtx || !doorCloseBuffer) {
        return randomBetween(15000, 40000);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const effectiveSanity = debugSanityOverride >= 0 ? DEBUG_SANITY_LEVELS[debugSanityOverride] : playerSanity;

    // Only play door sounds (kids laugh is now a continuous loop handled separately)
    const source = audioCtx.createBufferSource();
    source.buffer = doorCloseBuffer;

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = randomBetween(-1, 1);

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = randomBetween(0.2, 0.6);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = randomBetween(400, 1000);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(getDistortedOutput());

    source.start();

    // Door sounds play less frequently at low sanity (kids laugh takes over)
    return effectiveSanity <= 50
        ? randomBetween(25000, 60000)
        : randomBetween(15000, 40000);
}

function stopAudioSource(source) {
    if (!source) {
        return;
    }

    try {
        source.stop();
    } catch (error) {
        console.warn('Failed to stop audio source cleanly:', error);
    }
}

function stopAndClearSource(source) {
    stopAudioSource(source);
    return null;
}

function getPhoneRingVolume(minDistance) {
    if (minDistance > PHONE_AUDIO_MAX_DIST) {
        return 0;
    }

    if (minDistance <= PHONE_AUDIO_CLOSE_DIST) {
        return 1;
    }

    const normalizedDistance = (minDistance - PHONE_AUDIO_CLOSE_DIST) / (PHONE_AUDIO_MAX_DIST - PHONE_AUDIO_CLOSE_DIST);
    return (1 - normalizedDistance) ** 3;
}
