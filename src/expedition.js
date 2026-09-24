/** Session rules are independent of rendering and audio. */
export const REQUIRED_CALLS = 3;
export const TRANSMISSIONS = [
    '“You can hear me. Good. This line is compromised. Find another telephone.”',
    '“One more connection. Keep your eyes on the rooms. It moves when you stop listening.”',
    '“We have your location. Close your eyes. Do not answer anything else.”',
];

export function phoneId(position) {
    return `${position.x.toFixed(2)},${position.z.toFixed(2)}`;
}

export function createExpedition() {
    return { calls: new Set(), elapsed: 0, distance: 0, stamina: 100, exhausted: false, battery: 100, flashlight: true };
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
