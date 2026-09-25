import { PHONE_AUDIO_CLOSE_DIST, PHONE_AUDIO_MAX_DIST, DEBUG_SANITY_LEVELS } from './constants.js';
import { randomBetween, randomFloat } from './random.js';

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
let phonePan = null;
let audioVolume = 0.7;

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

// Level audio profile. Levels override these through configureLevelAudio().
const DEFAULT_LEVEL_AUDIO = {
    ambientBell: false,
    humGain: 1,
    humRate: 1,
    lowSanityVoice: 'laugh',
    music: null,
    stepLowpass: 0,
};
let levelAudio = { ...DEFAULT_LEVEL_AUDIO };

// Gramophone music: record + crackle -> band-limited horn -> gain -> distortion input.
const musicBuffers = new Map();
let musicWanted = false;
let musicSource = null;
let crackleSource = null;
let crackleBuffer = null;
let musicInput = null;
let musicGainNode = null;

// Procedural whispers, used as a level's low-sanity voice.
let whisperNoiseBuffer = null;
let whisperSource = null;
let whisperGain = null;
let whisperLowFormant = null;
let whisperHighFormant = null;
let whisperPan = null;
let nextWhisperTime = 0;
let whisperSyllablesLeft = 0;

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
    masterOutput.gain.value = audioVolume;
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
        musicWanted = true;
        startMusic();
    } catch (error) {
        console.warn('Failed to load ambient sounds:', error);
    }
}

function startHumSound() {
    if (!humBuffer || !audioCtx) return;

    humSource = audioCtx.createBufferSource();
    humSource.buffer = humBuffer;
    humSource.loop = true;
    humSource.playbackRate.value = levelAudio.humRate;

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
    phonePan ??= audioCtx.createStereoPanner();
    phonePan.disconnect();
    phoneRingGainNode.connect(phonePan);
    phonePan.connect(getDistortedOutput());
    phoneRingSource.start();
}

function restartHumSound() {
    if (!humBuffer || !audioCtx) return;

    stopAudioSource(humSource);

    humSource = audioCtx.createBufferSource();
    humSource.buffer = humBuffer;
    humSource.loop = true;
    humSource.playbackRate.value = levelAudio.humRate;

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

    let minDistSq = Infinity;
    const playerPos = camera.position;
    const maxDist = 5;
    const maxDistSq = maxDist * maxDist;

    for (const panel of lightPanels) {
        if (!panel.userData.powered) continue;
        const panelWorldPos = panel.userData.worldPosition;
        const distSq = playerPos.distanceToSquared(panelWorldPos);
        if (distSq < minDistSq) minDistSq = distSq;
        if (minDistSq <= maxDistSq * 0.04) break;
    }

    const minDist = Math.sqrt(minDistSq);
    const proximity = Math.max(0, 1 - (minDist / maxDist));
    const volume = (0.015 + proximity * 0.45) * levelAudio.humGain;

    humGainNode.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.1);
}

export function updatePhoneRingVolume(camera, phonePositions) {
    if (!phoneRingGainNode || !camera || phonePositions.length === 0) {
        if (phoneRingGainNode) {
            phoneRingGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        }
        return Infinity;
    }

    let minDistSq = Infinity;
    let nearest = null;
    const playerPos = camera.position;
    const maxDistSq = PHONE_AUDIO_MAX_DIST * PHONE_AUDIO_MAX_DIST;

    // No early exit here: the returned distance gates the interact prompt at
    // PHONE_INTERACT_DIST, so it must be the true nearest phone distance.
    for (const phonePos of phonePositions) {
        const distSq = playerPos.distanceToSquared(phonePos);
        if (distSq < minDistSq) { minDistSq = distSq; nearest = phonePos; }
    }

    const minDist = minDistSq > maxDistSq ? PHONE_AUDIO_MAX_DIST : Math.sqrt(minDistSq);
    const volume = getPhoneRingVolume(minDist);
    if (nearest && phonePan) {
        const angle = Math.atan2(nearest.x - playerPos.x, -(nearest.z - playerPos.z)) + camera.rotation.y;
        phonePan.pan.setTargetAtTime(Math.sin(angle) * 0.85, audioCtx.currentTime, 0.1);
    }

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

    // Fade the record and whispers to silence
    for (const node of [musicGainNode, whisperGain]) {
        if (!node) continue;
        node.gain.cancelScheduledValues(currentTime);
        node.gain.setValueAtTime(node.gain.value, currentTime);
        node.gain.linearRampToValueAtTime(0, fadeEndTime);
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
    musicWanted = false;
    stopMusic();
    stopWhispers();

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
        masterOutput.gain.value = audioVolume;
    }

    // Restart hum sound
    if (humBuffer) {
        restartHumSound();
    }

    // Restart phone ring sound
    if (phoneRingBuffer) {
        restartPhoneRingSound();
    }

    musicWanted = true;
    startMusic();
}

export function playPhonePickup() {
    if (!audioCtx) return;
    for (const [frequency, delay] of [[480, 0], [620, 0.16], [440, 0.32]]) {
        const tone = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        tone.frequency.value = frequency;
        const start = audioCtx.currentTime + delay;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.08, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
        tone.connect(gain);
        gain.connect(getDistortedOutput());
        tone.start(start);
        tone.stop(start + 0.16);
        tone.addEventListener('ended', () => { tone.disconnect(); gain.disconnect(); });
    }
}

export function playPlayerStep(sprinting) {
    if (!audioCtx || audioCtx.state !== 'running' || !footstepsBuffer) return;
    const source = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    source.buffer = footstepsBuffer;
    source.playbackRate.value = sprinting ? 1.15 : 0.9;
    gain.gain.setValueAtTime(sprinting ? 0.16 : 0.10, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.23);
    let filter = null;
    if (levelAudio.stepLowpass > 0) {
        // Deep carpet swallows the heel strike.
        filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = levelAudio.stepLowpass;
        source.connect(filter);
        filter.connect(gain);
    } else {
        source.connect(gain);
    }
    gain.connect(getDistortedOutput());
    source.start(0, 0, Math.min(0.25, footstepsBuffer.duration));
    source.addEventListener('ended', () => { source.disconnect(); filter?.disconnect(); gain.disconnect(); });
}

export function setAudioVolume(volume) {
    audioVolume = volume;
    if (masterOutput && audioCtx) masterOutput.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.05);
}

export function suspendAudio() {
    if (audioCtx?.state === 'running') audioCtx.suspend();
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
 * Update the level's low-sanity voice (kids laughing or whispers) and the
 * record warp, based on sanity level. Called every frame.
 * @param {number} sanity - Current sanity (0-100)
 * @param {number} debugSanityOverride - Debug override index (-1 for none)
 */
export function updateLowSanityVoice(sanity, debugSanityOverride) {
    const effectiveSanity = debugSanityOverride >= 0 ? DEBUG_SANITY_LEVELS[debugSanityOverride] : sanity;
    updateMusicWarp(effectiveSanity);

    if (levelAudio.lowSanityVoice === 'whispers') {
        updateWhispers(effectiveSanity);
        return;
    }

    updateKidsLaugh(effectiveSanity);
}

function updateKidsLaugh(effectiveSanity) {
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

    if (levelAudio.ambientBell && randomFloat() < 0.3) {
        playDistantBell();
        return randomBetween(15000, 40000);
    }

    // Only play door sounds (the low-sanity voice is a continuous loop handled separately)
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

export function configureLevelAudio(profile = {}) {
    stopMusic();
    stopWhispers();
    stopKidsLaughLoop();
    levelAudio = { ...DEFAULT_LEVEL_AUDIO, ...profile };
    if (levelAudio.music && audioCtx) loadMusicBuffer(levelAudio.music.url);
}

async function loadMusicBuffer(url) {
    if (musicBuffers.has(url)) return;
    musicBuffers.set(url, null);
    try {
        const response = await fetch(url);
        musicBuffers.set(url, await audioCtx.decodeAudioData(await response.arrayBuffer()));
        startMusic();
    } catch (error) {
        musicBuffers.delete(url);
        console.warn('Failed to load level music:', error);
    }
}

function createCrackleBuffer() {
    const length = audioCtx.sampleRate * 4;
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index++) {
        const hiss = (randomFloat() - 0.5) * 0.05;
        const pop = randomFloat() < 0.0006 ? (randomFloat() - 0.5) * 1.6 : 0;
        data[index] = hiss + pop;
    }
    return buffer;
}

function ensureMusicChain() {
    if (musicInput) return;
    musicInput = audioCtx.createBiquadFilter();
    musicInput.type = 'highpass';
    musicInput.frequency.value = 260;
    const horn = audioCtx.createBiquadFilter();
    horn.type = 'lowpass';
    horn.frequency.value = 3400;
    horn.Q.value = 0.9;
    musicGainNode = audioCtx.createGain();
    musicGainNode.gain.value = 0;
    musicInput.connect(horn);
    horn.connect(musicGainNode);
    musicGainNode.connect(getDistortedOutput());
}

// Starts the level record once its buffer is decoded and game audio is running.
function startMusic() {
    if (!audioCtx || !musicWanted || musicSource || !levelAudio.music) return;
    const buffer = musicBuffers.get(levelAudio.music.url);
    if (!buffer) {
        if (!musicBuffers.has(levelAudio.music.url)) loadMusicBuffer(levelAudio.music.url);
        return;
    }
    ensureMusicChain();
    crackleBuffer ??= createCrackleBuffer();
    musicSource = audioCtx.createBufferSource();
    musicSource.buffer = buffer;
    musicSource.loop = true;
    musicSource.connect(musicInput);
    crackleSource = audioCtx.createBufferSource();
    crackleSource.buffer = crackleBuffer;
    crackleSource.loop = true;
    crackleSource.connect(musicInput);
    const now = audioCtx.currentTime;
    musicGainNode.gain.cancelScheduledValues(now);
    musicGainNode.gain.setValueAtTime(0, now);
    musicGainNode.gain.linearRampToValueAtTime(levelAudio.music.gain ?? 0.2, now + 3);
    musicSource.start(now, randomBetween(0, buffer.duration * 0.8));
    crackleSource.start(now);
}

function stopMusic() {
    musicSource = stopAndClearSource(musicSource);
    crackleSource = stopAndClearSource(crackleSource);
    if (musicGainNode) musicGainNode.gain.value = 0;
}

// The record drags as sanity falls, as though the turntable is losing power.
function updateMusicWarp(effectiveSanity) {
    if (!musicSource) return;
    const factor = effectiveSanity > 50 ? 0 : 1 - effectiveSanity / 50;
    musicSource.playbackRate.setTargetAtTime(1 - factor * 0.16, audioCtx.currentTime, 1.2);
}

function createWhisperNoise() {
    const length = audioCtx.sampleRate * 2;
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < length; index++) {
        const white = randomFloat() * 2 - 1;
        brown = (brown + white * 0.08) * 0.97;
        data[index] = white * 0.65 + brown;
    }
    return buffer;
}

function startWhispers() {
    whisperNoiseBuffer ??= createWhisperNoise();
    whisperSource = audioCtx.createBufferSource();
    whisperSource.buffer = whisperNoiseBuffer;
    whisperSource.loop = true;
    whisperLowFormant = audioCtx.createBiquadFilter();
    whisperLowFormant.type = 'bandpass';
    whisperLowFormant.Q.value = 4;
    whisperHighFormant = audioCtx.createBiquadFilter();
    whisperHighFormant.type = 'bandpass';
    whisperHighFormant.Q.value = 6;
    whisperGain = audioCtx.createGain();
    whisperGain.gain.value = 0;
    whisperPan = audioCtx.createStereoPanner();
    whisperSource.connect(whisperLowFormant);
    whisperSource.connect(whisperHighFormant);
    whisperLowFormant.connect(whisperGain);
    whisperHighFormant.connect(whisperGain);
    whisperGain.connect(whisperPan);
    whisperPan.connect(getDistortedOutput());
    whisperSource.start();
    nextWhisperTime = audioCtx.currentTime + randomBetween(1, 3);
    whisperSyllablesLeft = 0;
}

function stopWhispers() {
    whisperSource = stopAndClearSource(whisperSource);
    whisperGain?.disconnect();
    whisperGain = null;
}

// Schedules breathy syllables ahead of the audio clock; phrases come from one
// side at a time and arrive more often as sanity falls.
function updateWhispers(effectiveSanity) {
    if (!audioCtx) return;
    if (effectiveSanity > 50) {
        if (whisperSource) stopWhispers();
        return;
    }
    if (!whisperSource) startWhispers();
    const now = audioCtx.currentTime;
    if (now < nextWhisperTime) return;

    const factor = 1 - effectiveSanity / 50;
    if (whisperSyllablesLeft <= 0) {
        whisperSyllablesLeft = Math.floor(randomBetween(3, 10));
        const side = randomFloat() < 0.5 ? -1 : 1;
        whisperPan.pan.setValueAtTime(side * randomBetween(0.45, 0.95), now);
    }
    const start = Math.max(now, nextWhisperTime);
    const attack = randomBetween(0.03, 0.08);
    const length = randomBetween(0.1, 0.32);
    const peak = (0.06 + factor * 0.14) * randomBetween(0.6, 1);
    whisperLowFormant.frequency.setValueAtTime(randomBetween(700, 1500), start);
    whisperHighFormant.frequency.setValueAtTime(randomBetween(2200, 4200), start);
    whisperGain.gain.setValueAtTime(0.0001, start);
    whisperGain.gain.linearRampToValueAtTime(peak, start + attack);
    whisperGain.gain.exponentialRampToValueAtTime(0.0001, start + attack + length);
    whisperSyllablesLeft--;
    const pause = whisperSyllablesLeft > 0 ? randomBetween(0.04, 0.16) : randomBetween(2.5, 9) * (1 - factor * 0.6);
    nextWhisperTime = start + attack + length + pause;
}

// A distant elevator arriving on a floor that is not yours.
function playDistantBell() {
    const now = audioCtx.currentTime;
    const pan = audioCtx.createStereoPanner();
    pan.pan.value = randomBetween(-0.9, 0.9);
    const distance = audioCtx.createBiquadFilter();
    distance.type = 'lowpass';
    distance.frequency.value = randomBetween(1800, 3200);
    const level = randomBetween(0.05, 0.11);
    distance.connect(pan);
    pan.connect(getDistortedOutput());
    for (const [frequency, weight] of [[1046.5, 1], [2093, 0.35], [2637, 0.2]]) {
        const tone = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        tone.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(level * weight, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
        tone.connect(gain);
        gain.connect(distance);
        tone.start(now);
        tone.stop(now + 2.5);
        tone.addEventListener('ended', () => { tone.disconnect(); gain.disconnect(); });
    }
    setTimeout(() => { distance.disconnect(); pan.disconnect(); }, 2600);
}
