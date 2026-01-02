/**
 * Game constants and configuration
 */

// World generation
export const CHUNK_SIZE = 24;
export const RENDER_DIST = 2;
export const PRELOAD_DIST = 4;
export const PLAYER_RADIUS = 0.5;
export const PHONE_EXCLUSION_DIST = 6;

// Entity system
export const ENTITY_DISAPPEAR_DISTANCE = 8;

// Audio
export const PHONE_AUDIO_CLOSE_DIST = 5;
export const PHONE_AUDIO_MAX_DIST = CHUNK_SIZE * 2;
export const PHONE_INTERACT_DIST = 3;

// Animation timing
export const WAKEUP_DURATION = 2.0;
export const FADE_DURATION = 2.0;

// Debug sanity levels for testing
export const DEBUG_SANITY_LEVELS = [100, 80, 50, 30, 10, 0];
