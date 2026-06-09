# Backrooms

A browser horror game built with Three.js.

You wake up in an endless maze of yellow rooms. Explore, manage your sanity, and find a telephone before the game fades out around you.

## Requirements

- Node.js 22+
- npm 11+

## Setup

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run dev
npm run lint
npm run lint:fix
npm run build
npm run preview
```

## Gameplay

- Move with `W`, `A`, `S`, `D`
- Look with the mouse
- Answer a phone with `E`
- On mobile, use the virtual joystick and tap the phone directly

The objective is simple: reach a phone before sanity reaches zero.

## Features

- Infinite chunk-based Backrooms maze
- Sanity system with escalating visual and audio effects
- Procedural world generation with deterministic chunk layout
- Web Audio ambient soundscape
- Mobile touch controls
- Low-sanity bacteria encounters
- Shader-based wake-up and fade transitions
- Quality presets (`?quality=desktop|mobile|low`) and a profiling overlay (`?profile`)

## Project structure

- `src/main.js`: menu entry; lazy-loads the runtime when a level starts
- `src/runtime.js`: game runtime and frame loop
- `src/world.js`: chunk generation, cached world data, wall spatial index, line of sight
- `src/audio.js`: sound playback and distortion pipeline
- `src/input.js`: desktop and mobile input
- `src/hud.js`: sanity bar and interaction prompts
- `src/entity.js`: bacteria logic
- `src/models.js`: materials, geometry, and GLTF loading
- `src/menu.js`: level-selection menu
- `src/levels.js`: level definitions
- `src/random.js`: shared runtime randomness
- `src/shaders/`: shader definitions

## Linting and code quality

The project uses a strict ESLint setup with:

- `@eslint/js`
- `eslint-plugin-import`
- `eslint-plugin-sonarjs`
- `eslint-plugin-unicorn`

It also includes local checks for Three.js hot paths. Render and update functions should reuse temporary math objects instead of allocating `THREE.Vector2`, `THREE.Vector3`, `THREE.Box3`, or large typed arrays during gameplay.

Run:

```bash
npm run lint
```

and keep it clean.

## Build

```bash
npm run build
```

The build is code-split: the menu loads first and the game runtime (including Three.js) loads when a level starts. Vite still warns about the size of the Three.js vendor chunk; that is expected.
