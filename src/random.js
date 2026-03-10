const randomBuffer = new Uint32Array(1);
const MAX_UINT32 = 2 ** 32;

export function randomFloat() {
    globalThis.crypto.getRandomValues(randomBuffer);
    return randomBuffer[0] / MAX_UINT32;
}

export function randomBetween(min, max) {
    return min + randomFloat() * (max - min);
}

export function randomInt(maxExclusive) {
    return Math.floor(randomFloat() * maxExclusive);
}
