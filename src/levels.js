import { PHONE_SANITY_RECOVERY } from './expedition.js';

export const DEFAULT_LEVEL_ID = 'lobby';

/**
 * Menu-facing level registry. Entries hold only menu copy, an accent colour,
 * an optional tile preview, and the AI model the level was built with (`builtWith`);
 * `load()` imports the level's runtime definition on demand, so level code and
 * assets stay out of the menu bundle. See src/levels/README.md to add a level.
 */
export const BACKROOM_LEVELS = [
    {
        id: 'lobby',
        playable: true,
        load: () => import('./levels/lobby/index.js'),
        accent: '#d9c98a',
        preview: '/graphics/lobby-preview.jpg',
        builtWith: 'GPT-6 Astra',
        badge: 'Level 0 / Survival',
        callToAction: 'Enter Level 0',
        detailTitle: 'Level 0: The Lobby',
        detailSubtitle: 'The fluorescent maze that never lets you settle.',
        menuLabel: 'The Lobby',
        menuStatus: 'Signal detected',
        objective: `Connect three different telephone lines to guide a rescue signal to your location. The first two calls restore ${PHONE_SANITY_RECOVERY} sanity; the final call brings rescue.`,
        summary: 'The classic yellow-office sprawl. Endless turns. Buzzing lights. A telephone hidden deeper than it should be.',
        teaser: 'A procedural labyrinth of damp carpet, paper walls, and stale electric light.',
        detailParagraphs: [
            'Level 0 is the baseline nightmare: endless office partitions, long sightlines, and just enough repetition to make every turn feel wrong.',
            'Follow the ringing and watch your receiver. Connect three different phones before your sanity fades. Run when you must, and let your torch recharge when you can.',
        ],
        features: [
            'Endless connected rooms, forgotten signs, and distant footsteps.',
            'Three transmissions, a way out, and something watching.',
            'Sprint stamina, a rechargeable torch, and a gentler Wander mode.',
        ],
    },
    {
        id: 'hotel',
        playable: true,
        load: () => import('./levels/hotel/index.js'),
        accent: '#d9a066',
        preview: '/graphics/hotel-preview.jpg',
        builtWith: 'Claude Opus 5.5',
        badge: 'Level 5 / Survival',
        callToAction: 'Enter Level 5',
        detailTitle: 'Level 5: Terror Hotel',
        detailSubtitle: 'An endless 1930s hotel that keeps itself spotless for guests who never check out.',
        menuLabel: 'Terror Hotel',
        menuStatus: 'Signal detected',
        objective: `Three house phones ring somewhere on these floors. Connect three different lines to reach the front desk. The first two calls restore ${PHONE_SANITY_RECOVERY} sanity; the final call brings rescue.`,
        summary: 'Mahogany-red panels, brass room numbers, and patterned carpet running to a vanishing point. Somewhere, a gramophone is still playing.',
        teaser: 'Endless corridors, locked rooms with brass numbers, and a record that never stops turning.',
        detailParagraphs: [
            'Level 5 is an infinite hotel built in the 1930s and furnished a decade earlier. The halls clean themselves. The room numbers are never in order, and none of the doors will open for you.',
            'A 1920s dance record drifts through the corridors from speakers nobody has found. Follow the house phones through the long halls, and keep moving when the whispering starts behind you.',
        ],
        features: [
            'Endless corridors of red damask, cream doors, and non-sequential room numbers.',
            'Brass house phones, gilded portraits, and a record that slows as your mind does.',
            'Level 0 survival rules: sanity, torch, stamina, and a gentler Wander mode.',
        ],
    },
    {
        id: 'pools',
        playable: true,
        load: () => import('./levels/pools/index.js'),
        accent: '#8fd9c2',
        preview: '/graphics/pools-preview.jpg',
        builtWith: 'Claude Fable 5.2',
        badge: 'Level 37 / Survival',
        callToAction: 'Enter Level 37',
        detailTitle: 'Level 37: The Poolrooms',
        detailSubtitle: 'Warm water, cream tile, and sunlight with no sky behind it.',
        menuLabel: 'The Poolrooms',
        menuStatus: 'Signal detected',
        objective: `Three poolside phones ring somewhere across the water. Connect three different lines to reach the lifeguard station. The first two calls restore ${PHONE_SANITY_RECOVERY} sanity; the final call brings rescue.`,
        summary: 'An endless, spotless swimming complex. Every wall is cream tile on a dark grid, curving away out of sight. The water is green and still, and nobody has ever swum in it.',
        teaser: 'Green water, curved walls, low sun, and too much space between each ripple.',
        detailParagraphs: [
            'Level 37 is a swimming complex with no entrance and no outside: terraced pools, canals running through arched walls, water winding between great curved walls, and skylights that let in a low sun from no sky at all. It is clean. It is warm. It has been waiting.',
            'You are barefoot. Keep to the tiles where you can and wade where you must; water slows you and carries the sound of every step. Some halls have lost their light. When the surface will not settle and something moves beneath it, find a phone.',
        ],
        features: [
            'Endless halls of pools, arcades, curved walls, spiral stairs, and slides, mirrored in still water.',
            'Wading, hard-edged sunlight, echoing bare footsteps, and halls that have gone dark.',
            'Level 0 survival rules: sanity, torch, stamina, and a gentler Wander mode.',
        ],
    },
];

const REQUIRED_DEFINITION_KEYS = ['environment', 'copy', 'loadAssets', 'getDarkenableMaterials', 'buildChunk', 'createLightingContext'];

export function getLevelById(levelId) {
    return BACKROOM_LEVELS.find((level) => level.id === levelId) ?? BACKROOM_LEVELS[0];
}

// Imports a playable level's runtime definition and loads its assets.
export async function loadLevelDefinition(level) {
    if (!level?.playable || typeof level.load !== 'function') {
        throw new Error(`Level "${level?.id}" is sealed.`);
    }

    const { default: definition } = await level.load();
    const missing = REQUIRED_DEFINITION_KEYS.filter((key) => !(key in definition));
    if (missing.length > 0) {
        throw new Error(`Level "${level.id}" definition is missing: ${missing.join(', ')}`);
    }

    await definition.loadAssets();
    return definition;
}
