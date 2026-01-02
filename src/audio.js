import { PHONE_AUDIO_CLOSE_DIST, PHONE_AUDIO_MAX_DIST, PHONE_INTERACT_DIST, DEBUG_SANITY_LEVELS } from './constants.js';

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

// Global distortion chain nodes
let masterDistortion = null;
let masterFilter = null;
let masterDelay = null;
let masterDelayGain = null;
let masterDryGain = null;
let masterOutput = null;
let currentSanityFactor = 0;

// Export state getters
export function getAudioContext() {
    return audioCtx;
}

export function getKidsLaughBuffer() {
    return kidsLaughBuffer;
}

export function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

    // Calculate sanity factor (0 at 100% sanity, 1 at 0% sanity)
    // Start distortion at 50% sanity
    if (effectiveSanity > 50) {
        currentSanityFactor = 0;
    } else {
        currentSanityFactor = 1 - (effectiveSanity / 50);
    }

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
        console.log('Ambient sounds loaded successfully');

        startHumSound();
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

export async function loadPhonePickupSound() {
    try {
        const response = await fetch('https://cdn.pixabay.com/download/audio/2022/03/10/audio_6650ed59b7.mp3?filename=phone-pick-up-46796.mp3');
        const arrayBuffer = await response.arrayBuffer();
        phonePickupBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        console.log('Phone pick-up sound loaded successfully');
    } catch (e) {
        console.warn('Failed to load phone pick-up sound:', e);
    }
}

export async function loadKidsLaughSound() {
    try {
        const response = await fetch('/sounds/kids-laugh.mp3');
        const arrayBuffer = await response.arrayBuffer();
        kidsLaughBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        console.log('Kids laughing sound loaded successfully');
    } catch (e) {
        console.warn('Failed to load kids laughing sound:', e);
    }
}

export function updateHumVolume(camera, lightPanels) {
    if (!humGainNode || !camera || lightPanels.length === 0) return;

    let minDist = Infinity;
    const playerPos = camera.position;

    for (const panel of lightPanels) {
        const panelWorldPos = panel.position.clone();
        panel.getWorldPosition(panelWorldPos);
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

    let volume = 0;

    if (minDist > PHONE_AUDIO_MAX_DIST) {
        volume = 0;
    } else if (minDist <= PHONE_AUDIO_CLOSE_DIST) {
        volume = 1.0;
    } else {
        const normalizedDist = (minDist - PHONE_AUDIO_CLOSE_DIST) / (PHONE_AUDIO_MAX_DIST - PHONE_AUDIO_CLOSE_DIST);
        volume = Math.pow(1 - normalizedDist, 3);
    }

    phoneRingGainNode.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.1);

    return minDist;
}

export function stopPhoneRing() {
    if (phoneRingSource) {
        phoneRingSource.stop();
        phoneRingSource = null;
    }
    if (phoneRingGainNode) {
        phoneRingGainNode.gain.value = 0;
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
        setTimeout(() => playAmbientFootsteps(isStarted), 2000);
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
    panner.connect(getDistortedOutput());

    source.start();

    const nextFootsteps = 8000 + Math.random() * 17000;
    setTimeout(() => playAmbientFootsteps(isStarted), nextFootsteps);
}

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

export function playAmbientDoorClose(isStarted, playerSanity, debugSanityOverride) {
    if (!isStarted || !audioCtx || !doorCloseBuffer) {
        setTimeout(() => playAmbientDoorClose(isStarted, playerSanity, debugSanityOverride), 2000);
        return;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const effectiveSanity = debugSanityOverride >= 0 ? DEBUG_SANITY_LEVELS[debugSanityOverride] : playerSanity;
    const useKidsLaugh = effectiveSanity <= 50 && kidsLaughBuffer;

    console.log('playAmbientDoorClose - sanity:', effectiveSanity, '%, useKidsLaugh:', useKidsLaugh, ', kidsLaughBuffer:', !!kidsLaughBuffer);

    const source = audioCtx.createBufferSource();
    source.buffer = useKidsLaugh ? kidsLaughBuffer : doorCloseBuffer;

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = (Math.random() * 2) - 1;

    const gainNode = audioCtx.createGain();

    if (useKidsLaugh) {
        const sanityFactor = 1 - (effectiveSanity / 50);
        gainNode.gain.value = 0.15 + sanityFactor * 0.5 + Math.random() * 0.2;

        const basePitch = 1.0 - sanityFactor * 0.3;
        const pitchVariation = (Math.random() - 0.5) * 0.2 * (1 + sanityFactor);
        source.playbackRate.value = basePitch + pitchVariation;

        const distortion = audioCtx.createWaveShaper();
        const distortionAmount = sanityFactor * 50;
        distortion.curve = makeDistortionCurve(distortionAmount);
        distortion.oversample = '4x';

        const filter = audioCtx.createBiquadFilter();
        if (effectiveSanity <= 20) {
            filter.type = 'lowpass';
            filter.frequency.value = 600 + Math.random() * 400;
            filter.Q.value = 5 + sanityFactor * 10;
        } else {
            filter.type = 'bandpass';
            filter.frequency.value = 800 + Math.random() * 600;
            filter.Q.value = 2 + sanityFactor * 5;
        }

        const delay = audioCtx.createDelay();
        delay.delayTime.value = 0.1 + sanityFactor * 0.15;
        const delayGain = audioCtx.createGain();
        delayGain.gain.value = 0.2 + sanityFactor * 0.3;

        source.connect(distortion);
        distortion.connect(filter);
        filter.connect(gainNode);
        filter.connect(delay);
        delay.connect(delayGain);
        delayGain.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(getDistortedOutput());
    } else {
        gainNode.gain.value = 0.2 + Math.random() * 0.4;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400 + Math.random() * 600;

        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(getDistortedOutput());
    }

    source.start();

    let nextDoor;
    if (useKidsLaugh) {
        const sanityFactor = 1 - (effectiveSanity / 50);
        nextDoor = (12000 - sanityFactor * 8000) + Math.random() * (13000 - sanityFactor * 8000);
    } else {
        nextDoor = 15000 + Math.random() * 25000;
    }

    // Return nextDoor for the caller to schedule the next call
    return nextDoor;
}
