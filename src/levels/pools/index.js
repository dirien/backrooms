import { buildPoolChunk, createPoolLightingContext } from './chunk.js';
import { WATER_LEVEL, groundHeightAt, hallPowerAt } from './layout.js';
import { disablePoolReflection, renderPoolReflection } from './reflection.js';
import { getPoolMaterials, getPoolResources, loadPoolAssets } from './resources.js';
import { poolUniforms } from './shading.js';
import { disablePoolSun, renderPoolSun } from './sun.js';

// Pale tile throws the torch straight back, so it stays weak while the hall is
// lit and opens up, like an eye adjusting, in halls that have lost power.
const TORCH_LIT = 1.3;
const TORCH_DARK = 9;
const environment = {
    ambientColor: 0xdfe3a6,
    ambientIntensity: 0.1,
    background: 0xc9c79d,
    exposure: 1.05,
    fixtureLight: { color: 0xf8f3c6 },
    fogColor: 0xc9c79d,
    fogDensity: 0.01,
    torchColor: 0xfff3da,
    torchIntensity: TORCH_LIT,
};
let lastElapsed = 0;
let shadeParked = true;

// Frame-rate independent smoothing factor for a rate in 1/s.
function ease(rate, seconds) {
    return 1 - Math.exp(-rate * seconds);
}

// Below half sanity something long and dark circles under the water. It keeps
// its distance while you stay on the tiles and comes in close when you wade.
function updateShade(unease, elapsed, seconds, camera, waterDepth) {
    const shade = poolUniforms.poolShade.value;
    const heading = poolUniforms.poolShadeHeading.value;
    const strength = unease > 0 ? Math.min(0.78, 0.3 + unease * 0.6) : 0;
    shade.w += (strength - shade.w) * ease(0.6, seconds);
    if (shade.w < 0.003) {
        shadeParked = true;
        return;
    }

    const radius = (waterDepth > 0.05 ? 3.2 : 8) - unease * 2 + Math.sin(elapsed * 0.13) * 2.4;
    const angle = elapsed * (0.17 + unease * 0.1) + Math.sin(elapsed * 0.07) * 1.8;
    const targetX = camera.position.x + Math.cos(angle) * radius;
    const targetZ = camera.position.z + Math.sin(angle) * radius;
    const fromX = shadeParked ? targetX : shade.x;
    const fromZ = shadeParked ? targetZ : shade.y;
    shadeParked = false;
    // It keeps to the water: over dry tile it waits where it is.
    if (groundHeightAt(targetX, targetZ) < WATER_LEVEL) {
        shade.x = fromX + (targetX - fromX) * ease(0.9, seconds);
        shade.y = fromZ + (targetZ - fromZ) * ease(0.9, seconds);
    } else {
        shade.x = fromX;
        shade.y = fromZ;
    }
    shade.z = 1.5 + unease * 0.7;

    const stepX = shade.x - fromX;
    const stepZ = shade.y - fromZ;
    const step = Math.hypot(stepX, stepZ);
    if (step > 0.0005) {
        heading.x += (stepX / step - heading.x) * ease(3, seconds);
        heading.y += (stepZ / step - heading.y) * ease(3, seconds);
        heading.normalize();
    }
}

// Keeps the water alive: time, the rings the player pushes out while wading,
// and the unease that creeps into the surface as sanity falls.
function updatePools({ sanity, elapsed, camera, waterDepth, speed }) {
    const seconds = Math.min(0.1, Math.max(0, elapsed - lastElapsed));
    lastElapsed = elapsed;
    const unease = sanity >= 50 ? 0 : 1 - sanity / 50;
    poolUniforms.poolTime.value = elapsed;
    poolUniforms.poolUnease.value = unease;

    const player = poolUniforms.poolPlayer.value;
    const wake = waterDepth > 0.05 ? Math.min(1, speed / 3.6) * Math.min(1, 0.4 + waterDepth) : 0;
    player.z += (wake - player.z) * ease(wake > player.z ? 7 : 1.2, seconds);
    player.x = camera.position.x;
    player.y = camera.position.z;

    updateShade(unease, elapsed, seconds, camera, waterDepth);

    const torch = TORCH_DARK + (TORCH_LIT - TORCH_DARK) * hallPowerAt(camera.position.x, camera.position.z);
    environment.torchIntensity += (torch - environment.torchIntensity) * ease(1.6, seconds);
}

// Extra passes before the frame: the sun's depth image, then the mirror image
// of the hall. High quality gets both and the full caustics; the balanced
// preset keeps the sun; the low preset has neither.
function renderPasses(renderer, scene, camera, quality) {
    const { water, panel, roof } = getPoolResources().materials;
    poolUniforms.poolDetail.value = quality.reflections ? 1 : 0;
    if (quality.postEffects) renderPoolSun(renderer, scene, camera, [water, panel], [roof], quality.reflections ? 2048 : 1024);
    else disablePoolSun();
    if (quality.reflections) renderPoolReflection(renderer, scene, camera, water);
    else disablePoolReflection();
}

/**
 * Level 37: The Poolrooms. Endless halls of cream tile and green, still water:
 * terraced pools, canals through arched walls, water winding between curved
 * walls, and a low sun through skylights with no sky behind them. See
 * src/levels/README.md for the level contract.
 */
export default {
    id: 'pools',
    environment,
    ground: {
        heightAt: groundHeightAt,
        waterLevel: WATER_LEVEL,
    },
    // Nothing hums, nothing blows, nobody else is here: bare feet, moved water,
    // and drips, in a hall that answers back.
    audio: {
        ambientDoor: false,
        ambientSteps: false,
        humGain: 0,
        lowSanityVoice: 'none',
        reverb: { seconds: 1.9, gain: 0.24 },
        // Bare feet on wet tile, recorded: eight footfalls in 0.4 s slots
        // (see scripts/generate-pool-assets.mjs). Every footfall is heard, not every other one.
        steps: 'barefoot',
        stepSprite: { url: '/sounds/pools/barefoot-wet-tile.mp3', count: 8, slot: 0.4 },
        stride: { walk: 0.78, sprint: 1.15 },
        water: true,
    },
    copy: {
        archiveLabel: 'ARCHIVE 037 / LEVEL 37',
        readyEyebrow: 'RECORDING 037 / THE POOLROOMS',
        readyCopy: 'Click Begin exploration to enter Level 37. Use WASD to move and your mouse to look. Wade where you must. Follow the ringing to the poolside phones and press E to answer three different lines.',
        arrival: 'The water is warm and perfectly still. A phone is ringing somewhere across it. Connect three different lines.',
        objective: 'Connect three poolside phones',
        finalObjective: 'One line left. Do not watch the water.',
        transmissions: [
            '“Lifeguard station. Nobody is on duty. Nobody has ever been on duty. Try another line.”',
            '“You are leaving ripples. It follows ripples. Keep to the tiles where you can.”',
            '“We can see the light moving on your water. Stand still. Let it settle.”',
        ],
        escapedTitle: 'The water went still.',
        escapedCopy: 'A hand finds yours and lifts you into air that smells of nothing at all.',
        lostTitle: 'Still swimming.',
        lostCopy: 'The surface closes without a sound. Follow the ringing. Each new line restores your sanity.',
    },
    loadAssets: loadPoolAssets,
    getDarkenableMaterials: getPoolMaterials,
    buildChunk: buildPoolChunk,
    createLightingContext: createPoolLightingContext,
    update: updatePools,
    beforeRender: renderPasses,
};
