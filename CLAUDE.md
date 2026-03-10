# CLAUDE.md

This file gives coding agents a working map of the repository.

## Project

Backrooms is a browser horror game built with Three.js and Vite. The player explores an endless Level 0 maze, manages sanity, and tries to find and answer a distant wall phone before sanity reaches zero.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run lint:fix
npm run build
npm run preview
```

## Architecture

The app is a small ES module game, not a framework app. `index.html` loads `src/main.js`, which initializes rendering, audio, input, chunk streaming, HUD, and the main loop.

### Core modules

- `src/main.js`: Runtime orchestration, animation loop, sanity drain, transitions, restart flow.
- `src/world.js`: Procedural chunk generation, chunk add/remove, static world-data caching, line-of-sight tests.
- `src/audio.js`: Web Audio graph, ambient sound playback, distortion chain, game audio lifecycle.
- `src/input.js`: Keyboard, mouse, and touch input. Input init is idempotent; do not add duplicate listeners on restart.
- `src/hud.js`: HUD scene and prompt rendering.
- `src/entity.js`: Bacteria spawn/update logic and environment darkening.
- `src/models.js`: Shared geometry, materials, and GLTF model loading.
- `src/random.js`: Shared crypto-backed randomness for non-deterministic runtime behavior.
- `src/levels.js`: Level definitions (id, theme, copy, features). Only `lobby` is playable; other levels are preview-only.
- `src/menu.js`: Level-selection menu: tile rendering, detail view, locked-tile logic. Driven by `levels.js` data.
- `src/constants.js`: Gameplay and tuning constants.
- `src/shaders/`: Custom shader definitions.

## Runtime model

### World streaming

- The maze is generated in chunks.
- Chunks near the player are always loaded.
- Additional chunks can preload if they are in range and potentially visible.
- Each chunk owns its walls, light panels, phone positions, phone raycast targets, and debug helpers.
- Static world bounds are cached once when a chunk is created. Hot paths should reuse that cached data instead of rebuilding `Box3` or `Vector3` objects every frame.

### Main loop

The frame loop is intentionally split into smaller phases:

- movement and collision
- sanity drain
- chunk/audio/entity updates
- post-processing transitions
- HUD render

Keep new per-frame logic in those smaller helpers. Avoid growing `animate()` back into a large monolith.

### Audio lifecycle

- `initAudioContext()` creates the shared audio context and master distortion chain once.
- `startGameAudio()` restarts looping sources for a new run.
- `resetAudioForStartScreen()` stops active sources and resets the audio graph state.
- Ambient footsteps and door sounds are scheduled from `main.js`. Do not add recursive timers inside the playback helpers.

### Input lifecycle

- Keyboard and mouse listeners should only be registered once.
- Touch controls are also initialized once and then toggled through DOM state.
- If you change restart behavior, preserve that one-time listener model.

## Linting

The repo now has a strict lint baseline:

- ESLint flat config
- `@eslint/js`
- `eslint-plugin-import`
- `eslint-plugin-sonarjs`
- `eslint-plugin-unicorn`

The config also adds local Three.js hot-path checks that block allocations of `THREE.Vector2`, `THREE.Vector3`, `THREE.Box3`, and large typed arrays inside key update functions.

If lint fails, fix the code. Do not weaken the baseline to make the errors disappear.

## Gameplay and systems

### Sanity

- Sanity drains while the player can move.
- Drain rate increases at lower sanity thresholds.
- At zero sanity, audio fades out and the screen fades to black before the game resets.

### Phone objective

- Phones do not spawn near the origin.
- The HUD prompt appears when the player is close enough to answer.
- Desktop uses `E`.
- Mobile uses direct raycast-based taps on the phone mesh.

### Bacteria entity

- The bacteria entity appears only at lower sanity levels.
- It requires line of sight and valid spawn space.
- It disappears if the player gets too close or loses line of sight.

## Assets

Static assets live under `public/`:

- `public/graphics/`
- `public/models/`
- `public/sounds/`

## Current caveat

`npm run build` succeeds, but Vite still reports a large main bundle warning. If you work on loading or architecture, code-splitting is a valid next step.
