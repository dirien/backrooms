import { randomInt } from './random.js';

/** Session rules are independent of rendering and audio. */
export const REQUIRED_CALLS = 3;
export const PHONE_SANITY_RECOVERY = 8;
export const SANITY_EFFECT_THRESHOLD = 50;
export const TRANSMISSIONS = [
    '“You can hear me. Good. This line is compromised. Find another telephone.”',
    '“One more connection. Keep your eyes on the rooms. It moves when you stop listening.”',
    '“We have your location. Close your eyes. Do not answer anything else.”',
];

export function phoneId(position) {
    return `${position.x.toFixed(2)},${position.z.toFixed(2)}`;
}

export function createExpedition(phoneSeed = randomInt(2 ** 32)) {
    return { calls: new Set(), phoneSeed, elapsed: 0, distance: 0, stamina: 100, exhausted: false, battery: 100, flashlight: true };
}

// Reach the unsettling half of the sanity meter earlier, then leave enough time
// to experience it and recover. Integrate across the threshold consistently even
// when callers advance by different time steps.
export function advanceSanity(sanity, seconds) {
    const calmRate = 0.3;
    const distressedRate = 0.14;
    const duration = Math.max(0, seconds);
    const calmTime = Math.min(duration, Math.max(0, sanity - SANITY_EFFECT_THRESHOLD) / calmRate);
    return Math.max(0, sanity - calmTime * calmRate - (duration - calmTime) * distressedRate);
}

export function recoverPhoneSanity(sanity, calls) {
    // The last line ends the run; it should not inflate the finishing sanity.
    return calls > 0 && calls < REQUIRED_CALLS ? Math.min(100, sanity + PHONE_SANITY_RECOVERY) : sanity;
}

export function connectPhone(session, position) {
    const id = phoneId(position);
    if (session.calls.has(id) || session.calls.size >= REQUIRED_CALLS) return false;
    session.calls.add(id);
    return true;
}

export function advanceVitals(session, delta, moving, sprintHeld) {
    const sprinting = moving && sprintHeld && !session.exhausted && session.stamina > 0;
    session.stamina = Math.max(0, Math.min(100, session.stamina + delta * (sprinting ? -23 : 15)));
    if (session.stamina === 0) session.exhausted = true;
    if (session.stamina >= 30) session.exhausted = false;
    session.battery = Math.max(0, Math.min(100, session.battery + delta * (session.flashlight ? -1.6 : 3.5)));
    if (session.battery === 0) session.flashlight = false;
    session.elapsed += delta;
    return sprinting;
}

export function formatTime(seconds) {
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
