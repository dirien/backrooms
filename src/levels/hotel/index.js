import { buildHotelChunk, createHotelLightingContext } from './chunk.js';
import { getHotelMaterials, loadHotelAssets, updatePortraitEyes } from './resources.js';

/**
 * Level 5: Terror Hotel. An endless 1930s hotel with 1920s furnishings: red
 * damask, cream doors with brass numbers that never run in order, patterned
 * carpet, buzzing dome lamps, and a dance record playing from nowhere.
 * See src/levels/README.md for the level contract.
 */
export default {
    id: 'hotel',
    // Wake facing down the endless east-west corridor.
    spawnYaw: Math.PI / 2,
    environment: {
        ambientColor: 0xffd6aa,
        ambientIntensity: 0.03,
        background: 0x0d0604,
        exposure: 1,
        fixtureLight: { color: 0xffdcae },
        fogColor: 0x0d0604,
        fogDensity: 0.02,
        // Cream walls throw the torch back hard; a dimmer beam keeps them readable.
        torchIntensity: 16,
    },
    audio: {
        ambientBell: true,
        humGain: 0.45,
        humRate: 0.82,
        lowSanityVoice: 'whispers',
        music: { url: '/sounds/hotel/whispering-1920.mp3', gain: 0.22 },
        stepLowpass: 700,
    },
    copy: {
        archiveLabel: 'ARCHIVE 005 / LEVEL 5',
        readyEyebrow: 'RECORDING 005 / TERROR HOTEL',
        readyCopy: 'Click Begin exploration to enter Level 5. Use WASD to move and your mouse to look. Follow the ringing to the house phones and press E to answer three different lines.',
        arrival: 'A house phone is ringing somewhere on this floor. Connect three different lines to reach the front desk.',
        objective: 'Connect three house phones',
        finalObjective: 'One line left. Reach the front desk.',
        transmissions: [
            '“Front desk. We have no guest by that name. Try another line.”',
            '“Housekeeping says your room is ready. It has always been ready. Keep walking.”',
            '“We found your key. Close your eyes when the music stops.”',
        ],
        escapedTitle: 'The front desk answered.',
        escapedCopy: 'Somewhere below, a bell rings for you. For the first time, the record stops.',
        lostTitle: 'Checked in for good.',
        lostCopy: 'The record keeps playing. Follow the house phones. Each new line restores your sanity.',
    },
    loadAssets: loadHotelAssets,
    getDarkenableMaterials: getHotelMaterials,
    buildChunk: buildHotelChunk,
    createLightingContext: createHotelLightingContext,
    update: ({ sanity }) => updatePortraitEyes(sanity),
};
