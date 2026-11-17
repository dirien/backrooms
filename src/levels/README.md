# Levels

Each playable level is a folder here with an `index.js` that default-exports a
**level definition**. The menu registry in `src/levels.js` lists every level and
lazy-loads its definition, so level code and assets never reach the menu bundle
(Vite emits one `level-<id>-*.js` chunk per level).

| Folder | Level | Notes |
| --- | --- | --- |
| `lobby/` | Level 0: The Lobby | 3 × 3 office-room grid per chunk, fluorescent panels, kids laughing at low sanity |
| `hotel/` | Level 5: Terror Hotel | Endless corridors, damask panels, numbered doors, gramophone jazz, whispers at low sanity |
| `pools/` | Level 37: The Poolrooms | Cream-tiled halls on a 1 m cell grid with curved walls, pools you wade through, sunlight through skylights, one planar reflection, bare feet and hall reverb |

## Adding a level

1. Create `src/levels/<id>/index.js` exporting a definition (contract below).
2. Add an entry to `BACKROOM_LEVELS` in `src/levels.js` with `playable: true`,
   `load: () => import('./levels/<id>/index.js')`, the menu copy, an `accent`
   colour, `builtWith` (the AI model that built the level, shown on the tile and
   detail view), and optionally a `preview` image for the tile.
3. Put assets under `public/graphics/<id>/`, `public/models/<id>/`, and
   `public/sounds/<id>/`. Everything in `public/` ships, so only add used files.
4. Add tests for the layout (connectivity, walkable corridors, lighting that
   agrees across chunk borders) next to `tests/hotel.spec.js`.

## Definition contract

```js
export default {
    id: 'hotel',
    spawnYaw: 0,                     // optional: initial camera yaw (radians)
    environment: {
        background, fogColor, fogDensity, ambientColor, ambientIntensity,
        exposure,                    // renderer tone-mapping exposure
        fixtureLight: { color },     // tint for every baked fixture
        torchIntensity,              // optional, defaults to TORCH_INTENSITY
        torchColor,                  // optional, defaults to TORCH_COLOR
    },
    ground: {                        // optional: floors that are not flat
        heightAt(x, z) {},           // floor height under a world position (0 = deck)
        waterLevel,                  // floors below this are under water: the player wades
    },
    audio: {                         // optional; see configureLevelAudio() in src/audio.js
        humRate, humGain,            // fluorescent/lamp hum pitch and level
        music: { url, gain },        // looping record through a gramophone filter
        lowSanityVoice: 'laugh' | 'whispers' | 'none',
        ambientBell,                 // distant elevator bells between door slams
        stepLowpass,                 // muffles footsteps (carpet), in Hz
        steps: 'shoes' | 'barefoot', // footfall on dry floor; wading always splashes
        stepSprite: { url, count, slot }, // recorded footfalls for 'barefoot': `count` slots of `slot` seconds
        stride: { walk, sprint },    // metres between footfalls (defaults 1.65 / 2.1)
        reverb: { seconds, gain },   // hall reverb on everything the level plays
        water,                       // scattered drips
        ambientDoor, ambientSteps,   // false: no distant door slams / footsteps
        humGain: 0,                  // no lamp hum at all
    },
    copy: {                          // HUD, ready screen, transmissions, results
        archiveLabel, readyEyebrow, readyCopy, arrival, objective, finalObjective,
        transmissions: [first, second, final],
        escapedTitle, escapedCopy, lostTitle, lostCopy,
    },
    loadAssets: async () => {},      // idempotent; load textures, models, materials
    getDarkenableMaterials: () => [],// stable array; the entity darkens these near itself
    buildChunk(context) {},          // fill one chunk (see below)
    createLightingContext(cx, cz) {},// fixtures + occluding walls for baking this chunk
    // Optional per-frame hook. The argument object is reused between frames.
    update({ sanity, elapsed, camera, waterDepth, speed }) {},
    // Optional: runs just before the frame is rendered (extra passes such as reflections).
    beforeRender(renderer, scene, camera, quality) {},
};
```

`buildChunk({ cx, cz, group, state, debugMode, debugNormals, phoneSeed })` adds
meshes to `group` in chunk-local coordinates (the chunk spans −12…12 m on x and
z) and pushes plain records into `state`, using the helpers in `src/chunk-kit.js`:

- `state.walls`: `createWallRecord(...)` boxes for collision, line of sight, and light occlusion.
  Boxes lower than 1.2 m (furniture) block movement but not sight.
- `state.lightPanels`: `createFixtureRecord(...)` for every ceiling fixture, powered or not.
  Set `record.userData.intensity` to scale one fixture's baked light.
  A mesh tagged `userData.ownsFixtureLighting` is not baked by the engine: it must
  bring its own `fixtureIrradiance` attribute (see `sampleFixtureIrradiance()`).
- Phones: call `registerPhone(...)` in chunks where `isPhoneChunk(cx, cz, phoneSeed)` is true.

Rules that keep streaming fast and seamless:

- Merge static geometry per material with `addMergedMesh()`; it tags the result
  so `disposeChunkResources()` frees it. Never tag shared geometry or GLTF clones.
- Layout must be deterministic per chunk and agree across borders. Keep the
  rules in a pure `layout.js` (no Three.js) so tests and lighting contexts can use them.
- `createLightingContext()` must include fixtures and walls from neighbouring
  chunks, so light matches on both sides of a border before either chunk loads.
- The spawn point (0, 1.7, 0) must be walkable.
- With a `ground` sampler the camera follows the floor: eye height is 1.7 m above
  `heightAt()`, movement slows with water depth, and footsteps turn into splashes.
  Keep the deepest floor shallow enough that the eye stays above `waterLevel`.
  Collision still uses the wall records only; steps and pool edges do not block.
- `beforeRender()` receives the active quality preset. Skip optional passes when
  the preset says so (`quality.reflections` is false on the mobile and low presets).
