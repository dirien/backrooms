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

The app is a small ES module game, not a framework app. `index.html` loads `src/main.js`, a thin entry that renders the level menu and dynamically imports `src/runtime.js` when a level starts. Keep Three.js imports out of the menu path so the entry chunk stays small; Vite emits manual chunks for Three.js and postprocessing (see `vite.config.js`).

### Core modules

- `src/main.js`: Menu bootstrap only. Lazy-loads the runtime on level start.
- `src/runtime.js`: Runtime orchestration, animation loop, sanity drain, transitions, restart flow, quality presets, profiling hooks.
- `src/world.js`: Procedural chunk generation, chunk add/remove and resource disposal, static world-data caching, wall spatial index, line-of-sight tests.
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
- Chunk refresh is gated: `runtime.js` re-evaluates streaming only when the player enters a new chunk or the camera rotates past a threshold. Restart forces one fresh refresh.
- Wall meshes are merged per chunk and light panels use an `InstancedMesh`, so rendered objects are not collision objects. Collision and line of sight use plain per-wall records (`userData.worldBox`/`worldCenter`) indexed in a wall spatial index; query it instead of scanning all walls.
- Each chunk owns its walls, light panels, phone positions, phone raycast targets, and debug helpers.
- Static world bounds are cached once when a chunk is created. Hot paths should reuse that cached data instead of rebuilding `Box3` or `Vector3` objects every frame.
- Chunks own GPU resources (merged wall geometry, instance buffers, border planes, debug helpers). `disposeChunkResources()` releases them on unload and reset, driven by `userData.ownsGeometry`/`ownsMaterial` tags. If you add a per-chunk geometry or material, tag it; never tag shared geometry or cloned GLTF resources.

### Main loop

The frame loop is intentionally split into smaller phases:

- movement and collision
- sanity drain
- chunk/audio/entity updates
- post-processing transitions
- HUD render

Keep new per-frame logic in those smaller helpers. Avoid growing `animate()` back into a large monolith.

### Quality and profiling

- Quality presets (desktop, mobile, low) control render scale, bloom, postprocessing, preload/render distance, and audio proximity rate. Force one with `?quality=desktop|mobile|low`; reduced-motion and save-data preferences fall back to `low`.
- `?profile` (or debug mode) shows rolling timings for chunk updates, entity work, audio effects, and audio proximity next to the FPS counter.

### Audio lifecycle

- `initAudioContext()` creates the shared audio context and master distortion chain once.
- `startGameAudio()` restarts looping sources for a new run.
- `resetAudioForStartScreen()` stops active sources and resets the audio graph state.
- Ambient footsteps and door sounds are scheduled from `runtime.js`. Do not add recursive timers inside the playback helpers.
- Light hum and phone ring proximity are throttled to a quality-dependent interval. The phone proximity scan must return the true nearest phone distance; it gates the interact prompt.

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

Everything in `public/` ships verbatim in `dist/`, so do not park unused files there. Textures are WebP.

## Current caveat

`npm run build` succeeds. The app is code-split: the menu entry is small and the runtime loads on demand. Vite still warns about the Three.js vendor chunk (~520 kB minified); that is expected and only worth revisiting if Three.js gains better tree-shaking.
