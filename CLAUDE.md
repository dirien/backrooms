# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Backrooms - A browser-based horror game built with Three.js.

**Repository**: https://github.com/dirien/backrooms

The game renders an infinite procedurally-generated maze of yellow office rooms (Level 0: The Lobby) with atmospheric audio and post-processing effects.

## Commands

```bash
npm install      # Install dependencies
npm run dev      # Start dev server with hot reload (opens browser automatically)
npm run build    # Build for production
npm run preview  # Preview production build
```

## Architecture

**Entry point**: `index.html` loads `src/main.js` as an ES module.

**Main game logic** (`src/main.js`):
- **Rendering**: Three.js with EffectComposer for post-processing (UnrealBloomPass for light panel glow, vignette, film grain, sanity-based distortion via custom GLSL shaders)
- **World Generation**: Chunk-based infinite terrain using deterministic seeded randomness. Chunks are 24x24 units with frustum-based culling. Nearby chunks (RENDER_DIST = 2) are always loaded, while potentially visible chunks are preloaded up to PRELOAD_DIST = 4 to prevent pop-in
- **Collision**: AABB box collision against wall meshes stored in global `walls` array
- **Lighting**: Ambient lighting with bloom effect on rectangular fluorescent light panels. Light panel proximity affects audio volume.
- **Audio**: Web Audio API with MP3 sound files - looping fluorescent light hum (volume increases near light panels), random distant footsteps, and door close sounds

**Key globals**: `scene`, `camera`, `renderer`, `composer`, `chunks` (Map), `walls` (array), `lightPanels` (array), `playerSanity`, `frustum`, `frustumMatrix`

**Audio files** (`public/sounds/`):
- `light-hum.mp3`: Looping fluorescent light buzz
- `footsteps.mp3`: Random distant footsteps
- `door-close.mp3`: Random distant door closing
- `phone-ring.mp3`: Phone ringing sound, loops when player is within 2-3 chunks of a wall phone (volume increases with proximity)

**Graphics** (`public/graphics/`):
- `wallpaper.png`: Wall texture using Backrooms color palette
- `ceiling-tile.png`: Drop ceiling tile texture
- `carpet.png`: Carpet texture (currently unused - floor uses procedural shader)

**3D Models** (`public/models/`):
- `wall_outlet_american.glb`: American-style wall outlet, randomly placed on walls (5% chance per wall)
- `corded_public_phone_-_low_poly.glb`: Corded public phone, very rarely placed on walls (0.5% chance per wall)

**Floor/Ceiling System**:
- Floor: Per-chunk procedural carpet shader with yellow-green base color and fiber texture pattern
- Ceiling: Per-chunk tiled drop ceiling texture (each chunk has its own ceiling tile)

**Debug Mode** (press `O` key):
- Toggles visibility of wall normal debug lines (red)
- Toggles chunk border visualization (transparent red walls at chunk boundaries)

**Shared resources**: Geometries and materials are created once in `createGlobalResources()` and reused across all chunks for performance.

## Dependencies

- **three** (v0.171.0): 3D rendering, post-processing via addons
- **vite** (dev): Build tool with hot module replacement
