import { PHONE_SECTOR_SIZE } from './constants.js';

function noise(seed) {
    return Math.abs(Math.sin(seed) * 10000) % 1;
}

// One telephone per large sector; the central jitter keeps adjacent phones apart.
export function getPhoneChunkForSector(sx, sz, phoneSeed = 0) {
    const seed = (Math.imul(sx, 1973) ^ Math.imul(sz, 9277) ^ phoneSeed) >>> 0;
    return {
        x: sx * PHONE_SECTOR_SIZE + 2 + Math.floor(noise(seed + 41) * 2),
        z: sz * PHONE_SECTOR_SIZE + 2 + Math.floor(noise(seed + 97) * 2),
    };
}

export function isPhoneChunk(cx, cz, phoneSeed = 0) {
    const candidate = getPhoneChunkForSector(Math.floor(cx / PHONE_SECTOR_SIZE), Math.floor(cz / PHONE_SECTOR_SIZE), phoneSeed);
    return candidate.x === cx && candidate.z === cz;
}
