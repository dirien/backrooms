# Game Optimization Fixes

Branch renamed to `dirien/optimize-game`.

## Implemented Fixes

1. Chunk streaming is no longer evaluated every frame.
   `src/runtime.js` now refreshes chunks only after the player enters a new
   chunk or the camera rotates enough to change visible chunks.

2. Static chunk draw calls were reduced.
   `src/world.js` now merges wall geometry per chunk and uses an
   `InstancedMesh` for light panels.

3. Wall collision and line-of-sight checks now use spatial partitioning.
   Active walls are indexed by grid cell, and hot paths query only nearby or
   segment-crossed cells.

4. Audio proximity work is throttled.
   Light hum and phone ring proximity are updated at quality-dependent
   intervals and use squared-distance checks.

5. The sanity HUD avoids per-frame canvas redraws.
   It redraws the percent texture only when the rounded value or color band
   changes, and it reuses cached `THREE.Color` objects.

6. Quality presets were added.
   Desktop, mobile, and low presets control render scale, bloom,
   postprocessing, preload distance, render distance, and audio proximity rate.
   The preset can be forced with `?quality=desktop`, `?quality=mobile`, or
   `?quality=low`.

7. Heavy runtime loading was code-split.
   `src/main.js` now loads the menu first and dynamically imports
   `src/runtime.js` only when a level starts. Vite also emits manual chunks for
   Three.js and postprocessing.

8. Large PNG textures were optimized.
   Wallpaper and ceiling textures were converted to WebP and the replaced PNG
   files were removed from `public/graphics`.

9. Restart behavior now avoids unnecessary chunk/cache work.
   Restart clears the wall spatial index and chunk tracker, then forces one
   fresh chunk refresh for the selected level.

10. Profiling hooks were added.
    Use `?profile` or debug mode to show rolling timings for chunk updates,
    entity work, audio effects, and audio proximity beside the FPS counter.

11. Chunk GPU resources are released on removal.
    Merged wall geometry, light-panel instance buffers, border planes, and
    debug helpers are disposed when a chunk unloads or the world resets.
    Shared geometry/materials and cloned GLTF models are left untouched.

12. Phone proximity returns the true nearest distance.
    The early exit in the phone ring loop was removed because the returned
    distance gates the interact prompt; the list is small, so the scan is
    cheap.

13. The unused `public/graphics/carpet.png` (886 KB) was deleted.
    The floor uses a procedural carpet shader, and `public/` assets ship in
    `dist/` verbatim.

## Verification

- `markdownlint` passes.
- `npm run lint` passes.
- `npm run build` passes.
