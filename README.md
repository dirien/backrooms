# Backrooms — Signal Lost

A browser horror game built with Three.js. Wake up in Level 0 or Level 5, follow the ringing, and connect three different telephone lines to establish a way out.

## Play locally

Requires Node.js 22+ and npm.

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Open http://localhost:5173, select **The Lobby** or **Terror Hotel**, and enter. Click **Begin exploration** to capture your mouse. The browser must support WebGL 2.

When running inside a Docker sandbox, publish the port from your host first (the sandbox name is `$SANDBOX_NAME` inside the sandbox):

```bash
sbx ports <sandbox-name> --publish 5173:5173
```

## Levels

The level wall credits the AI model that built each level: Level 0 was built with GPT-6 Astra, Level 5 with Claude Opus 5.5.

**Level 0: The Lobby.** The classic yellow office sprawl: damp carpet, humming fluorescent panels, and rooms that repeat just enough to feel wrong.

**Level 5: Terror Hotel.** Following the Backrooms records, an endless hotel built in the 1930s and furnished a decade earlier. Corridors of mahogany-red damask panels and cream doors run to a vanishing point over red-and-gold patterned carpet. Room numbers are brass, never in sequence, and none of the doors open. Flush dome lamps buzz overhead and whole circuits fail. EXIT signs hang from the ceiling and lead nowhere. Dead ends hold brass elevators, grandfather clocks, and console tables under gilt-framed paintings. A 1920s dance record plays from speakers nobody has found, and slows as your sanity falls. Below half sanity, whispering replaces the silence behind you and the portraits' eyes start to catch the light. The objective is the same: answer three different house phones to reach the front desk.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | WASD | Left joystick |
| Look | Mouse | Drag the room |
| Sprint | Hold Shift | Hold Sprint |
| Flashlight | F | Torch |
| Answer a nearby phone | E | Answer or tap the phone |
| Pause | Escape | Pause button |

Connect three **different** phones. The first two connections restore 8 sanity and reveal another transmission; the final call brings rescue without increasing the finishing sanity. Phone locations and wall attachments change each expedition and stay fixed when rooms reload during that run. Phones remain sparse: one per 6 × 6 chunk sector, with at least 120 metres between phone-chunk centres. Your receiver shows the relative direction and strength of an unused line within its 48-metre range; stereo ringing helps you find it. Phones cannot be answered through walls.

Sanity drains at 0.30 points per second above 50%, then slows to 0.14 points per second. Without calls, the unsettling half of the meter arrives after about 2 minutes 47 seconds; two early calls extend that to about 3 minutes 40 seconds. This gives players time to experience the lower-sanity effects and search for the final line. Very fast runs can still escape before encounters begin.

Sprinting consumes stamina. After exhaustion, recover at least 30% before sprinting again. The torch recharges while switched off and automatically switches off when empty. Entity encounters become eligible only at 50% displayed sanity or below, after an eight-second grace period. Lower sanity makes sightings more frequent and approaches faster; phone progress and elapsed time do not trigger them. Recovering above 50% ends the encounter.

**Wander** mode disables sanity loss and entity encounters. Settings include volume, mouse sensitivity, graphics quality, and camera effects; they persist locally. Reduced-motion preferences disable camera effects by default. Escape, window blur, or switching tabs pauses exploration.

Level 0 and Level 5 are playable. The Pool route remains a sealed preview.

## Features

- Deterministic infinite maze with connected rooms and guaranteed passages between chunks
- Three-call escape sequence, subtitles, and separate escape/loss summaries
- Stereo phone audio, movement footsteps, ambient disturbances, and sanity-driven entity sightings
- A 2.2-metre entity with procedural idle and walking animation, plus wall clearance covering its animated limbs and turns
- Rechargeable flashlight with wall shadows, sprint stamina, gentle camera bob and sprint field of view
- Static fluorescent lighting baked into room and prop geometry, with wall occlusion and neighbouring-chunk fixtures included before streaming
- Every visible surface keeps its fixture lighting at any distance; failed tubes and circuits stay dark, with only a faint ambient floor for visibility
- Carpet detail, baseboards, environmental signage, varied fluorescent panels, fog, and film effects
- Accessible DOM HUD, keyboard menus, touch controls, pause settings, and replay reset
- Chunk streaming, spatial collision queries, reusable geometry, and graphics presets
- Level definitions loaded on demand: each level brings its own layout, materials, lighting, audio profile, and copy (see `src/levels/README.md`)
- Level 5: procedural hotel corridors with guaranteed links between rows, dead-end alcoves, brass room-number plates, portraits that watch, gramophone jazz, and procedural whispers

## Development

```bash
npm run lint
npm run build
npm run preview -- --host 0.0.0.0
```

`?quality=desktop|mobile|low` overrides the graphics setting. `?profile` enables timing diagnostics. The Three.js vendor chunk produces an expected size warning during builds.

`npm run assets:hotel [textures|models|audio]` rebuilds the Level 5 assets from their sources. It needs network access, Playwright Chromium, and ffmpeg for the audio step. Textures are drawn in `scripts/hotel-textures.html` and blended with CC0 scans, models are decimated to 512 px WebP textures with glTF Transform, and the record is trimmed into a loop.

## Tests

```bash
npx playwright install --with-deps chromium
npm test
```

Tests cover Level 5 loading, copy, spawn direction, stable house-phone placement, escape, and handing back to Level 0; hotel corridor connectivity, walkable corridors, door and panel spacing, and light that agrees across chunk borders; desktop movement, pausing, wall-blocked interactions, distinct calls, escape, loss, replay, mobile controls, Wander mode, stamina recovery, connectivity across 121 generated chunks, phone spacing across 3,600 chunks, rendered brightness with working lights, failed lights, and the torch; light blocked by walls and passed through doorways; lighting continuity across chunk borders; and visible lighting beyond the former 24-metre cutoff. Entity tests cover sanity gating, recovery, pause timing, failed-spawn cooldowns, animated dimensions, wall clearance, and the runtime sanity input. Browser tests use software WebGL at low quality; they do not benchmark hardware performance. Test-only controls are injected by Playwright and are absent from the shipped game.

## Structure

- `src/main.js`, `src/menu.js`, `src/levels.js`: menu, level registry, and lazy level loading
- `src/levels/<id>/`: one folder per playable level (layout, chunk builder, resources, definition); see `src/levels/README.md`
- `src/runtime.js`: game lifecycle, movement, collisions, and frame loop
- `src/expedition.js`: session progression and survival rules
- `src/session-ui.js`, `src/session.css`, `src/hud.js`: settings, HUD, pause, and results
- `src/world.js`, `src/chunk-kit.js`, `src/world-layout.js`: level-agnostic chunk streaming, shared chunk-building helpers, and phone sectors
- `src/lighting.js`: static fixture baking with wall occlusion, plus the dynamic shadow-casting torch
- `src/audio.js`, `src/entity.js`, `src/input.js`: sound and level audio profiles, encounters, and controls
- `src/models.js`, `src/shaders/`: shared asset loading, the entity model, and screen effects

## Asset credits (Level 5)

- Models: [Poly Haven](https://polyhaven.com) (CC0): Fancy Picture Frame 01, Vintage Telephone Wall Clock, Vintage Grandfather Clock 01, Classic Console 01.
- Texture detail: Poly Haven (CC0): Quatrefoil Jacquard Fabric (damask panels), White Stucco (plaster, doors), Dirty Carpet (carpet fibre). The carpet ornament, door panels, room numbers, EXIT signs, and portraits are drawn procedurally.
- Music: "Whispering" by Paul Whiteman and His Ambassador Orchestra (Victor 18690-A, 1920), public domain, via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Paul_Whiteman_and_His_Ambassador_Orchestra_-_Whispering.flac).
- Whispers, record crackle, and elevator bells are synthesised with the Web Audio API.
