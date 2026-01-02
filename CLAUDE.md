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

**Modular Architecture**:
The codebase is organized into separate modules:
- `src/main.js` - Main game loop, initialization, and coordination
- `src/constants.js` - Game constants (CHUNK_SIZE, PLAYER_RADIUS, etc.)
- `src/audio.js` - Audio system (hum, footsteps, phone ring, door sounds)
- `src/hud.js` - HUD rendering (sanity bar, phone prompt)
- `src/world.js` - Chunk generation and management
- `src/entity.js` - Bacteria entity system
- `src/input.js` - Keyboard, mouse, and touch input handling
- `src/models.js` - 3D model loading (outlet, phone, bacteria)
- `src/shaders/` - GLSL shaders (wall, post-processing, fade, wakeup, carpet, entity)

**Main game logic** (`src/main.js`):
- **Rendering**: Three.js with EffectComposer for post-processing (UnrealBloomPass for light panel glow, vignette, film grain, sanity-based distortion via custom GLSL shaders)
- **World Generation**: Chunk-based infinite terrain using deterministic seeded randomness. Chunks are 24x24 units with frustum-based culling. Nearby chunks (RENDER_DIST = 2) are always loaded, while potentially visible chunks are preloaded up to PRELOAD_DIST = 4 to prevent pop-in
- **Maze Algorithm**: Grid-based wall placement that guarantees connectivity - every cell has at least 2 open sides (no dead ends), maximum 2 walls per cell (keeps space open), and chunk boundaries always have open passages in the middle to ensure inter-chunk traversal
- **Collision**: AABB box collision against wall meshes stored in global `walls` array
- **Lighting**: Ambient lighting with bloom effect on rectangular fluorescent light panels. Light panel proximity affects audio volume.
- **Audio**: Web Audio API with MP3 sound files - looping fluorescent light hum (volume increases near light panels), random distant footsteps, and door close sounds

**Key globals**: `scene`, `camera`, `renderer`, `composer`, `chunks` (Map), `walls` (array), `lightPanels` (array), `playerSanity`, `frustum`, `frustumMatrix`, `hudScene`, `hudCamera`

**Audio files** (`public/sounds/`):
- `light-hum.mp3`: Looping fluorescent light buzz
- `footsteps.mp3`: Random distant footsteps
- `door-close.mp3`: Random distant door closing (replaced by kids laughing when sanity ≤ 50%)
- `kids-laugh.mp3`: Creepy kids laughing sound that replaces door sounds at low sanity
- `phone-ring.mp3`: Phone ringing sound, loops when player is within 2 chunks of a wall phone (volume uses cubic falloff - very quiet far away, loud only when very close)

**Graphics** (`public/graphics/`):
- `wallpaper.png`: Wall texture using Backrooms color palette
- `ceiling-tile.png`: Drop ceiling tile texture
- `carpet.png`: Carpet texture (currently unused - floor uses procedural shader)

**3D Models** (`public/models/`):
- `wall_outlet_american.glb`: American-style wall outlet, randomly placed on walls (5% chance per wall)
- `corded_public_phone_-_low_poly.glb`: Corded public phone, very rarely placed on walls (0.5% chance per wall). Phones never spawn within 6 chunks of the starting position (0,0) to force players to explore deeper into the Backrooms
- `bacteria_-_kane_pixels_backrooms.glb`: Bacteria entity (Kane Pixels style) that appears at low sanity levels as a horror element

**Floor/Ceiling System**:
- Floor: Per-chunk procedural carpet shader with yellow-green base color and fiber texture pattern
- Ceiling: Per-chunk tiled drop ceiling texture (each chunk has its own ceiling tile)

**Debug Mode** (press `O` key):
- Toggles visibility of wall normal debug lines (red)
- Toggles chunk border visualization (transparent red walls at chunk boundaries)
- Press `N`/`M` to cycle through sanity levels (100%, 80%, 50%, 30%, 10%, 0%) for testing distortion effects
- When cycling to 50% or below, kids laughing sound plays immediately for testing audio horror effects

**Game Objective**:
- Find a telephone hidden deep in the Backrooms and call for help before sanity drains completely
- Start screen displays the objective to the player
- Phones only spawn 6+ chunks away from the starting position, requiring exploration

**Phone Interaction**:
- When within 3 units of a phone, "Press E to answer" prompt appears in the HUD (or "Tap to answer" on mobile)
- Desktop: Press E to interact with phone
- Mobile: Tap directly on the phone mesh (uses Three.js raycasting for tap detection)
- Pressing E or tapping triggers phone pickup sound (loaded from external URL), stops phone ringing
- Screen fades to black over 2 seconds via `FADE_SHADER` post-processing pass
- Game resets to start screen after fade completes, allowing replay

**Wake-up Effect**:
- When the game starts, a shader-based eye-opening effect plays (2 seconds)
- Simulates regaining consciousness with blinking/struggling to open eyes
- Includes blur effect that clears as eyes open
- Implemented via `WAKEUP_SHADER` post-processing pass

**Sanity System**:
- Sanity drains over time while the player is moving
- Drain rate accelerates at lower sanity thresholds (0.337/sec base, up to 1.348/sec at critical levels)
- HUD rendered in Three.js using a separate orthographic scene (`hudScene`/`hudCamera`) with canvas textures for text
- Sanity bar with "SANITY" label and percentage, color changes at low levels (yellow → orange → red)
- Pulsing effect on the bar at critical sanity levels
- Progressive visual distortion effects at different sanity thresholds:
  - **80%**: Subtle wave distortion (drain: 0.449/sec)
  - **50%**: Chromatic aberration, stronger waves, green tint (drain: 0.562/sec)
  - **30%**: Tunnel vision, pulsing, spiral distortion, color cycling, double vision (drain: 0.899/sec)
  - **10%**: Screen shake, reality fracturing, kaleidoscope effect, color inversion flashes, scan lines (drain: 1.348/sec)
- Audio horror effects at low sanity (≤ 50%):
  - Door close sounds replaced with creepy kids laughing
  - **Master audio distortion**: All sounds (hum, footsteps, phone ring, phone pickup, door/laugh sounds) pass through a global distortion chain that activates below 50% sanity
  - Audio distortion increases as sanity decreases (waveshaping, low-pass filtering, echo/delay)
  - Sound frequency increases (plays more often) as sanity drops
- Visual horror effects - Bacteria entity appearances (see Bacteria Entity System below)

**Mobile/Touch Support**:
- Automatic detection of touch devices (iOS, Android)
- Virtual joystick (bottom-left) for movement control
- Touch-drag zone covers entire screen except joystick area (L-shaped clip-path)
- Responsive UI adjustments for smaller screens
- Audio context handling for iOS Safari autoplay restrictions

**Shared resources**: Geometries and materials are created once in `createGlobalResources()` and reused across all chunks for performance.

**Bacteria Entity System**:
- Kane Pixels-style bacteria entity appears at low sanity levels as a visual horror element
- **Line-of-sight spawning**: Entity only spawns where player has clear line of sight (no walls blocking), always within the player's view frustum (never behind)
- **Wall collision check**: Entity bounding box is checked against walls to prevent clipping through geometry
- **Unreachable behavior**: Entity disappears instantly when player gets within 8 units (`ENTITY_DISAPPEAR_DISTANCE`), making it impossible to reach
- **Dynamic line-of-sight**: If player or entity loses line of sight (wall blocks view), entity vanishes instantly
- **No animation**: Entity appears and disappears instantly without scaling or fading effects
- Spawning behavior based on sanity thresholds (entity appears at 65% sanity and below):
  - **≤ 65%**: May appear 25-40 units away, visible for 0.5-1.5 seconds
  - **≤ 30%**: Appears 18-30 units away, getting closer
  - **≤ 10%**: Appears 12-20 units away, uncomfortably close
  - **0%**: Appears 9-15 units away, visible for 1.5-3 seconds
- Spawn frequency: 3-6 seconds at 65% sanity, 0.5-1.5 seconds at critical sanity
- Entity always faces the player (Y-axis rotation only)
- Custom `ENTITY_DISTORTION_SHADER` renders entity as pure black silhouette with subtle dark glitch effects
- **Darkness effect**: `ENTITY_DARKNESS_SHADER` post-processing pass darkens the screen around the entity's position, creating an unsettling atmosphere. Darkness intensity and radius increase at lower sanity
- Floor alignment via bounding box calculation prevents clipping
- Debug mode shows wireframe bounding box and axes helper

## Dependencies

- **three** (v0.171.0): 3D rendering, post-processing via addons
- **vite** (dev): Build tool with hot module replacement
