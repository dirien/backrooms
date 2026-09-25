import { TRANSMISSIONS } from '../../expedition.js';
import { buildLobbyChunk, createChunkLightingContext } from './chunk.js';
import { getLobbyMaterials, loadLobbyAssets } from './resources.js';

/** Level 0: The Lobby. See src/levels/README.md for the level contract. */
export default {
    id: 'lobby',
    environment: {
        ambientColor: 0xd7d3a2,
        ambientIntensity: 0.025,
        background: 0x050503,
        exposure: 1.15,
        fixtureLight: { color: 0xffecc4 },
        fogColor: 0x333322,
        fogDensity: 0.028,
    },
    audio: {
        lowSanityVoice: 'laugh',
    },
    copy: {
        archiveLabel: 'ARCHIVE 001 / LEVEL 0',
        readyEyebrow: 'RECORDING 001 / SIGNAL LOST',
        readyCopy: 'Click Begin exploration to enter Level 0. Use WASD to move and your mouse to look. Follow the ringing and press E to answer three different phones.',
        arrival: 'Follow the ringing. Connect three different phones. Each call brings you back.',
        objective: 'Connect three telephone lines',
        finalObjective: 'Find the final line. Make contact.',
        transmissions: TRANSMISSIONS,
        escapedTitle: 'You made contact.',
        escapedCopy: 'A voice on the other end. For the first time, you are not alone.',
        lostTitle: 'Lost to the rooms.',
        lostCopy: 'The hum is all that remains. Follow the ringing. Each new line restores your sanity.',
    },
    loadAssets: loadLobbyAssets,
    getDarkenableMaterials: getLobbyMaterials,
    buildChunk: buildLobbyChunk,
    createLightingContext: createChunkLightingContext,
};
