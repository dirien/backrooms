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
- **Rendering**: Three.js with EffectComposer for post-processing (vignette, film grain, sanity-based distortion via custom GLSL shaders)
- **World Generation**: Chunk-based infinite terrain using deterministic seeded randomness. Chunks are 24x24 units, loaded/unloaded based on player proximity (RENDER_DIST = 2 chunks)
- **Collision**: AABB box collision against wall meshes stored in global `walls` array
- **Lighting**: Pool of 32 point lights (MAX_ACTIVE_LIGHTS) dynamically positioned at nearest light anchors to player
- **Audio**: Web Audio API generating procedural sounds - constant 60Hz hum and randomized "phantom slam" events

**Key globals**: `scene`, `camera`, `renderer`, `composer`, `chunks` (Map), `walls` (array), `lightAnchors` (array), `activeLights` (array), `playerSanity`

**Shared resources**: Geometries and materials are created once in `createGlobalResources()` and reused across all chunks for performance.

## Dependencies

- **three** (v0.171.0): 3D rendering, post-processing via addons
- **vite** (dev): Build tool with hot module replacement
