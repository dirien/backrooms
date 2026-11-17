# CLAUDE.md

This file gives coding agents a working map of the repository.

## Project

Backrooms is a browser horror game built with Three.js and Vite. The player explores an endless level (Level 0: The Lobby, Level 5: Terror Hotel, or Level 37: The Poolrooms), manages sanity, and tries to find and answer three distant wall phones before sanity reaches zero.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run lint:fix
npm run build
npm run preview
npm test
npm run assets:hotel   # rebuild Level 5 textures, models, and music (network + ffmpeg)
npm run assets:pools   # rebuild the Level 37 footstep sprite (network + ffmpeg)
```

## Architecture

The app is a small ES module game, not a framework app. `index.html` loads `src/main.js`, a thin entry that renders the level menu and dynamically imports `src/runtime.js` when a level starts. The runtime then lazy-loads the chosen level definition from `src/levels/<id>/index.js`. Keep Three.js imports out of the menu path so the entry chunk stays small; Vite emits manual chunks for Three.js and postprocessing, and one `level-<id>` chunk per level (see `vite.config.js`).

### Levels

- `src/levels.js` is the menu-facing registry: menu copy, `accent`, optional tile `preview`, `playable`, and `load()` (a dynamic import). `loadLevelDefinition()` validates the definition and awaits its `loadAssets()`.
- Each level folder exports a definition with `environment`, `audio`, `copy`, `loadAssets`, `getDarkenableMaterials`, `buildChunk`, `createLightingContext`, and optional `spawnYaw`, `ground`, `update`, and `beforeRender`. The contract and the steps to add a level are in `src/levels/README.md`.
- Keep level rules in a pure `layout.js` (no Three.js) so tests and lighting contexts can use them. Chunks must agree across borders.

### Core modules

- `src/main.js`: Menu bootstrap only. Lazy-loads the runtime on level start.
- `src/runtime.js`: Runtime orchestration, animation loop, sanity drain, transitions, restart flow, quality presets, profiling hooks. Applies the active level's environment, copy, and audio profile.
- `src/world.js`: Level-agnostic chunk streaming (delegates contents to `level.buildChunk`), chunk add/remove and resource disposal, wall spatial index, line-of-sight tests.
- `src/chunk-kit.js`: Shared chunk-building helpers: chunk state, merged meshes, wall/fixture records, phone registration, debug helpers.
- `src/world-layout.js`: Phone sector placement shared by all levels.
- `src/levels/lobby/`: Level 0 layout (3 × 3 room grid), chunk builder, materials, scenery.
- `src/levels/hotel/`: Level 5 layout (corridor rows with guaranteed links, alcoves), chunk builder (doors, damask panels, trim, dome lamps, props, house phones), materials and canvas textures.
- `src/levels/pools/`: Level 37. `layout.js` plans each hall on a 1 m cell grid (solid tile, floor height, ceiling height) with shared edge rules for walls, arches, and canals, curved walls (drums, rounded corners) sliced into collision blocks, skylight wells, and the ground sampler; `chunk.js` meshes the grid into one tile geometry per chunk and bakes its light itself (`userData.ownsFixtureLighting`); `shading.js` patches the tile material (refraction, caustics, absorption, sunlight, wet-floor reflection, light-aware fog) and defines the water surface; `sun.js` renders the sun's depth image and `reflection.js` the one planar reflection; `resources.js` draws the tile and sign textures; `index.js` drives the shared uniforms each frame (time, wading wake, unease, the shape under the water) and adapts the torch to the hall's light.
- `src/audio.js`: Web Audio graph, ambient sound playback, distortion chain, game audio lifecycle, per-level audio profiles (hum, gramophone music, whispers, bells, muffled steps).
- `src/input.js`: Keyboard, mouse, and touch input. Input init is idempotent; do not add duplicate listeners on restart.
- `src/hud.js`: HUD scene and prompt rendering.
- `src/entity.js`: Bacteria spawn/update logic and environment darkening.
- `src/models.js`: Shared asset library: cached GLTF/texture loading, `enhanceMaterialWithDarkness`, and the bacteria entity model.
- `src/random.js`: Shared crypto-backed randomness for non-deterministic runtime behavior.
- `src/levels.js`: Level registry (menu copy, accent, preview, `playable`, `load`). `lobby`, `hotel`, and `pools` are playable.
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
- Each chunk owns its walls, light panels, phone positions, phone raycast targets, and debug helpers. Wall records lower than 1.2 m (furniture) block movement but not line of sight.
- Static world bounds are cached once when a chunk is created. Hot paths should reuse that cached data instead of rebuilding `Box3` or `Vector3` objects every frame.
- Chunks own GPU resources (merged wall geometry, instance buffers, border planes, debug helpers). `disposeChunkResources()` releases them on unload and reset, driven by `userData.ownsGeometry`/`ownsMaterial` tags. If you add a per-chunk geometry or material, tag it; never tag shared geometry or cloned GLTF resources.

### Ground and water

- A level may define `ground: { heightAt(x, z), waterLevel }`. The runtime then keeps the eye 1.7 m above the sampled floor (smoothed), slows movement by water depth, plays splashes instead of footsteps, and stands the entity on the same floor. Levels without `ground` stay at exactly 1.7 m.
- Collision is unchanged: wall records only. Pool edges and steps never block movement, so a level must keep its deepest floor shallow enough that the eye stays above the water.
- `heightAt()` runs every frame: keep it allocation-free (Level 37 looks up a cached chunk plan).
- The sampler need not be a cell grid: Level 37's spiral stair returns step heights by angle around its column (less than a full turn, so one height per point), and collision blocks along its outer edge make the foot the only way on.

### Main loop

The frame loop is intentionally split into smaller phases:

- movement and collision
- sanity drain
- chunk/audio/entity updates
- post-processing transitions
- HUD render

Keep new per-frame logic in those smaller helpers. Avoid growing `animate()` back into a large monolith.

`animate()` calls the level's optional `beforeRender(renderer, scene, camera, quality)` just before the composer renders. Level 37 uses it for two extra passes: a depth image of the halls seen from the sun (static world, so it is re-rendered only when the player has moved 4 m or every 0.6 s for newly streamed chunks; only faces turned away from the sun are drawn and the comparison leans towards shadow, which removes acne and the sliver of light where a wall meets the ceiling; sun-only lids close the open tops of solid walls), and one mirrored render at half resolution that every water surface and the wet deck sample. A texture must never be bound as a sampler while it is the render target, so those uniforms are cleared for their own pass.

### Quality and profiling

- Quality presets (desktop, mobile, low) control render scale, bloom, postprocessing, level reflections, preload/render distance, and audio proximity rate. Force one with `?quality=desktop|mobile|low`; reduced-motion and save-data preferences fall back to `low`.
- `?profile` (or debug mode) shows rolling timings for chunk updates, entity work, audio effects, and audio proximity next to the FPS counter.

### Audio lifecycle

- `initAudioContext()` creates the shared audio context and master distortion chain once.
- `configureLevelAudio(profile)` switches the level audio profile before a run; it stops the previous level's music and low-sanity voice.
- `updateLowSanityVoice()` runs every frame: kids laughing (Level 0) or scheduled whisper syllables (Level 5), plus the record slowing at low sanity. Whispers are scheduled on the audio clock from this per-frame update, not with timers.
- `playPlayerStep()` plays the level's footfall: the shoe sample, bare feet (`steps: 'barefoot'`: recorded footfalls from the level's `stepSprite`, with a synthesised stand-in until the file has loaded), or a wading stride whenever the player stands in water. A level's `stride` sets the distance between footfalls.
- `updateLevelAmbience()` runs every frame for levels with `water`: drips are scheduled on the audio clock. Level 37 is deliberately quiet: no hum, no distant doors or footsteps, no low-sanity voice; only bare feet, wading, drips, and the phones.
- A level's `reverb` profile feeds everything after the master filter through a generated impulse response; other levels leave the send at zero.
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

- `public/graphics/` (level assets in `public/graphics/<id>/`)
- `public/models/` (level assets in `public/models/<id>/`)
- `public/sounds/` (level assets in `public/sounds/<id>/`)

Everything in `public/` ships verbatim in `dist/`, so do not park unused files there. Textures are WebP. Level 5 assets are rebuilt from CC0/public-domain sources with `npm run assets:hotel`; credits are in `README.md`. Level 37 generates its tile, signs, and most of its sound at runtime and reuses the Level 0 pay phone; its files are the menu preview and `public/sounds/pools/barefoot-wet-tile.mp3`, a sprite of recorded footfalls rebuilt from a CC0 recording with `npm run assets:pools`.

## Current caveat

`npm run build` succeeds. The app is code-split: the menu entry is small and the runtime loads on demand. Vite still warns about the Three.js vendor chunk (~520 kB minified); that is expected and only worth revisiting if Three.js gains better tree-shaking.
