import { PHONE_SECTOR_SIZE } from './constants.js';

function noise(seed) {
    return Math.abs(Math.sin(seed) * 10000) % 1;
}

// One telephone per large sector; the central jitter keeps adjacent phones apart.
export function getPhoneChunkForSector(sx, sz) {
    const seed = sx * 1973 + sz * 9277;
    return {
        x: sx * PHONE_SECTOR_SIZE + 2 + Math.floor(noise(seed + 41) * 2),
        z: sz * PHONE_SECTOR_SIZE + 2 + Math.floor(noise(seed + 97) * 2),
    };
}

export function isPhoneChunk(cx, cz) {
    const candidate = getPhoneChunkForSector(Math.floor(cx / PHONE_SECTOR_SIZE), Math.floor(cz / PHONE_SECTOR_SIZE));
    return candidate.x === cx && candidate.z === cz;
}

export function isFixturePowered(cx, cz, panelIndex) {
    // Whole circuits fail as well as individual tubes. The arrival room is lit.
    if (cx === 0 && cz === 0 && panelIndex === 4) return true;
    const circuitFailed = (cx !== 0 || cz !== 0) && noise(cx * 719 + cz * 1433 + 59) < 0.22;
    return !circuitFailed && noise(cx * 147 + cz * 317 + panelIndex * 37 + 11) > 0.18;
}
