import * as THREE from 'three';
import { createFixtureBakeContext } from '../../lighting.js';
import { isPhoneChunk } from '../../world-layout.js';
import { CHUNK_SIZE } from '../../constants.js';
import {
    addDebugHelpers,
    addDebugNormals,
    addMergedMesh,
    createChunkState,
    createFixtureRecord,
    createWallRecord,
    registerPhone,
} from '../../chunk-kit.js';
import {
    CORRIDOR_HALF_WIDTH,
    WALL_HEIGHT,
    getBeams,
    getChunkPlan,
    getFixtures,
    getFloorAreas,
    getRunSlots,
    getWallBlocks,
    getWallRuns,
    hotelNoise,
    isHotelFixturePowered,
} from './layout.js';
import { ROOM_NUMBER_CELLS, ROOM_NUMBER_COLUMNS, ROOM_NUMBER_ROWS, TEXTURE_TILE, getHotelResources } from './resources.js';

export const HOTEL_LIGHT = { range: 7, intensity: 6.5, drop: 0.2, upward: 0.3 };
const LAMP_HEIGHT = 2.99;
const HALF_CHUNK = CHUNK_SIZE / 2;
const tempMatrix = new THREE.Matrix4();
const poweredLampColor = new THREE.Color(1, 0.92, 0.78);
const failedLampColor = new THREE.Color(0.07, 0.055, 0.045);

function createPartLists() {
    return { walls: [], carpet: [], ceiling: [], trim: [], doors: [], damask: [], gilt: [], shadow: [], plates: [], exit: [] };
}

// Box with UVs in world metres, so the plaster grain stays constant on every wall length.
function createWallGeometry(block) {
    const geometry = new THREE.BoxGeometry(block.sx, WALL_HEIGHT, block.sz, Math.max(1, Math.ceil(block.sx * 2)), 6, Math.max(1, Math.ceil(block.sz * 2)));
    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const uvs = geometry.attributes.uv;
    for (let index = 0; index < uvs.count; index++) {
        const x = positions.getX(index) + block.x;
        const y = positions.getY(index) + WALL_HEIGHT / 2;
        const z = positions.getZ(index) + block.z;
        const horizontal = Math.abs(normals.getX(index)) > 0.5 ? z : x;
        uvs.setXY(index, horizontal / TEXTURE_TILE.plaster, y / TEXTURE_TILE.plaster);
    }
    return geometry.translate(block.x, WALL_HEIGHT / 2, block.z);
}

// Floor/ceiling rectangles with world-aligned UVs (24 m is a whole number of carpet tiles).
// `density` is vertices per metre for the baked lighting; ceilings need more around the domes.
function createFlatGeometry(area, y, facingUp, tile, density = 2) {
    const geometry = new THREE.PlaneGeometry(area.sx, area.sz, Math.ceil(area.sx * density), Math.ceil(area.sz * density));
    geometry.rotateX(facingUp ? -Math.PI / 2 : Math.PI / 2);
    geometry.translate(area.x, y, area.z);
    const positions = geometry.attributes.position;
    const uvs = geometry.attributes.uv;
    for (let index = 0; index < uvs.count; index++) {
        uvs.setXY(index, positions.getX(index) / tile, -positions.getZ(index) / tile);
    }
    return geometry;
}

function scaleUvs(geometry, scaleU, scaleV) {
    const uvs = geometry.attributes.uv;
    for (let index = 0; index < uvs.count; index++) uvs.setXY(index, uvs.getX(index) * scaleU, uvs.getY(index) * scaleV);
    return geometry;
}

// Places a +Z-facing geometry on a wall run at position u, height y, and distance `offset` from the face.
function placeOnRun(geometry, run, u, y, offset) {
    geometry.rotateY(Math.atan2(run.nx, run.nz));
    const x = run.axis === 'x' ? u : run.fixed + run.nx * offset;
    const z = run.axis === 'x' ? run.fixed + run.nz * offset : u;
    return geometry.translate(x, y, z);
}

function placeObjectOnRun(object, run, u, y, offset) {
    object.position.set(
        run.axis === 'x' ? u : run.fixed + run.nx * offset,
        y,
        run.axis === 'x' ? run.fixed + run.nz * offset : u,
    );
    object.rotation.y = Math.atan2(run.nx, run.nz);
    return object;
}

function runLocalPoint(run, u, offset) {
    return run.axis === 'x'
        ? { x: u, z: run.fixed + run.nz * offset }
        : { x: run.fixed + run.nx * offset, z: u };
}

function worldSeed(cx, cz, run, u) {
    const point = runLocalPoint(run, u, 0);
    return (cx * CHUNK_SIZE + point.x) * 12.9898 + (cz * CHUNK_SIZE + point.z) * 78.233;
}

function roomNumberGeometry(cell) {
    const geometry = new THREE.PlaneGeometry(0.2, 0.08);
    const column = cell % ROOM_NUMBER_COLUMNS;
    const row = Math.floor(cell / ROOM_NUMBER_COLUMNS);
    const uvs = geometry.attributes.uv;
    for (let index = 0; index < uvs.count; index++) {
        uvs.setXY(
            index,
            (column + uvs.getX(index)) / ROOM_NUMBER_COLUMNS,
            1 - (row + 1 - uvs.getY(index)) / ROOM_NUMBER_ROWS,
        );
    }
    return geometry;
}

function addDoor(parts, run, u, seed) {
    parts.doors.push(placeOnRun(new THREE.BoxGeometry(0.94, 2.12, 0.05, 2, 4, 1), run, u, 1.06, 0.025));
    parts.trim.push(
        placeOnRun(new THREE.BoxGeometry(0.09, 2.2, 0.07), run, u - 0.515, 1.1, 0.035),
        placeOnRun(new THREE.BoxGeometry(0.09, 2.2, 0.07), run, u + 0.515, 1.1, 0.035),
        placeOnRun(new THREE.BoxGeometry(1.2, 0.11, 0.08), run, u, 2.255, 0.04),
    );
    parts.plates.push(placeOnRun(roomNumberGeometry(Math.floor(hotelNoise(seed) * ROOM_NUMBER_CELLS)), run, u, 1.62, 0.052));
    parts.gilt.push(
        placeOnRun(new THREE.BoxGeometry(0.06, 0.17, 0.012), run, u + 0.34, 1.0, 0.056),
        placeOnRun(new THREE.SphereGeometry(0.034, 10, 8), run, u + 0.34, 1.0, 0.09),
    );
    parts.shadow.push(placeOnRun(new THREE.BoxGeometry(0.94, 0.012, 0.01), run, u, 0.006, 0.052));
}

function addPanel(parts, run, u) {
    const panel = scaleUvs(new THREE.BoxGeometry(1.4, 2.1, 0.02), 1.4 / TEXTURE_TILE.damask, 2.1 / TEXTURE_TILE.damask);
    parts.damask.push(placeOnRun(panel, run, u, 1.5, 0.01));
    parts.gilt.push(
        placeOnRun(new THREE.BoxGeometry(1.5, 0.05, 0.035), run, u, 2.575, 0.0175),
        placeOnRun(new THREE.BoxGeometry(1.5, 0.05, 0.035), run, u, 0.425, 0.0175),
        placeOnRun(new THREE.BoxGeometry(0.05, 2.1, 0.035), run, u - 0.725, 1.5, 0.0175),
        placeOnRun(new THREE.BoxGeometry(0.05, 2.1, 0.035), run, u + 0.725, 1.5, 0.0175),
    );
}

// Baseboard, wall-top moulding, soffit band, and its crown edge along a run.
function addRunTrim(parts, run) {
    // East-west bands wrap the outside corners at corridor openings by their own
    // depth; north-south bands stop at the corner. Chunk-border ends stay flush.
    const wraps = run.axis === 'x' && run.kind === 'corridor';
    const wrapFrom = wraps && run.from > -HALF_CHUNK + 0.01;
    const wrapTo = wraps && run.to < HALF_CHUNK - 0.01;
    // Runs along z sit 1 mm higher so corner pieces never share a face.
    const lift = run.axis === 'z' ? 0.001 : 0;
    const band = (height, depth, y, offset) => {
        const from = run.from - (wrapFrom ? offset + depth / 2 : 0);
        const to = run.to + (wrapTo ? offset + depth / 2 : 0);
        return placeOnRun(new THREE.BoxGeometry(to - from, height, depth), run, (from + to) / 2, y + lift, offset);
    };
    parts.trim.push(
        band(0.16, 0.03, 0.08, 0.015),
        band(0.07, 0.05, 2.765, 0.025),
        band(0.2, 0.3, 2.9, 0.15),
        band(0.05, 0.06, 2.785, 0.3),
    );
}

function addCorbel(parts, run, u) {
    parts.trim.push(
        placeOnRun(new THREE.BoxGeometry(0.26, 0.32, 0.16), run, u, 2.64, 0.08),
        placeOnRun(new THREE.BoxGeometry(0.18, 0.14, 0.1), run, u, 2.41, 0.05),
    );
}

function addBeams(parts, plan, runs) {
    const span = CORRIDOR_HALF_WIDTH * 2 - 0.6;
    for (const beam of getBeams(plan)) {
        const geometry = beam.axis === 'x'
            ? new THREE.BoxGeometry(0.3, 0.22, span).translate(beam.at, 2.89, 0)
            : new THREE.BoxGeometry(span, 0.22, 0.3).translate(0, 2.89, beam.at);
        parts.trim.push(geometry);
        for (const run of runs) {
            if (run.axis === beam.axis && beam.at >= run.from - 0.001 && beam.at <= run.to + 0.001) addCorbel(parts, run, beam.at);
        }
    }
}

function addLamps(group, parts, state, plan, cx, cz, resources) {
    const fixtures = getFixtures(plan);
    const lamps = new THREE.InstancedMesh(resources.geometry.dome, resources.materials.lamp, fixtures.length);
    lamps.matrixAutoUpdate = false;
    lamps.frustumCulled = false;
    fixtures.forEach((fixture, index) => {
        const powered = isHotelFixturePowered(cx, cz, fixture.x, fixture.z);
        tempMatrix.makeTranslation(fixture.x, LAMP_HEIGHT, fixture.z);
        lamps.setMatrixAt(index, tempMatrix);
        lamps.setColorAt(index, powered ? poweredLampColor : failedLampColor);
        state.lightPanels.push(createFixtureRecord(cx * CHUNK_SIZE + fixture.x, LAMP_HEIGHT, cz * CHUNK_SIZE + fixture.z, powered));
        parts.gilt.push(
            new THREE.TorusGeometry(0.3, 0.022, 6, 28).rotateX(Math.PI / 2).translate(fixture.x, 2.975, fixture.z),
            new THREE.SphereGeometry(0.035, 8, 6).translate(fixture.x, 2.84, fixture.z),
        );
    });
    lamps.instanceMatrix.needsUpdate = true;
    group.add(lamps);
}

// A hanging EXIT sign under a beam, facing along the corridor. None of them lead out.
function maybeAddExitSign(parts, plan, cx, cz) {
    const roll = hotelNoise(cx * 1777 + cz * 911 + 3);
    if (roll > 0.5) return;
    const x = roll < 0.25 ? -4 : 4;
    parts.exit.push(new THREE.BoxGeometry(0.07, 0.2, 0.46).translate(x, 2.62, 0));
    parts.gilt.push(
        new THREE.BoxGeometry(0.012, 0.06, 0.012).translate(x, 2.75, -0.15),
        new THREE.BoxGeometry(0.012, 0.06, 0.012).translate(x, 2.75, 0.15),
    );
}

function addPainting(group, run, u, y, seed, resources) {
    const { painting, portraits } = resources.models;
    if (!painting) return;
    const roll = hotelNoise(seed + 9);
    const source = roll < 0.55 && portraits.length > 0 ? portraits[Math.floor(roll / 0.55 * portraits.length)] : painting;
    group.add(placeObjectOnRun(source.clone(), run, u, y, 0.022));
}

function addConsole(group, state, run, u, seed, cx, cz, resources) {
    const { console: consoleTable } = resources.models;
    if (!consoleTable) return;
    group.add(placeObjectOnRun(consoleTable.clone(), run, u, 0, 0.35));
    const center = runLocalPoint(run, u, 0.31);
    const along = run.axis === 'x';
    state.walls.push(createWallRecord(cx, cz, center.x, 0.475, center.z, along ? 1.6 : 0.62, 0.95, along ? 0.62 : 1.6));
    addPainting(group, run, u, 1.75, seed, resources);
}

function addElevator(parts, run) {
    parts.gilt.push(
        placeOnRun(new THREE.BoxGeometry(1.3, 2.25, 0.04), run, 0, 1.125, 0.02),
        placeOnRun(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 24).rotateX(Math.PI / 2), run, 0, 2.55, 0.02),
        placeOnRun(new THREE.BoxGeometry(0.1, 0.18, 0.02), run, 0.95, 1.15, 0.01),
    );
    parts.shadow.push(
        placeOnRun(new THREE.BoxGeometry(0.014, 2.25, 0.046), run, 0, 1.125, 0.023),
        placeOnRun(new THREE.BoxGeometry(0.014, 0.15, 0.01).rotateZ(-0.6), run, 0.04, 2.6, 0.04),
    );
    parts.trim.push(
        placeOnRun(new THREE.BoxGeometry(0.14, 2.45, 0.08), run, -0.72, 1.225, 0.04),
        placeOnRun(new THREE.BoxGeometry(0.14, 2.45, 0.08), run, 0.72, 1.225, 0.04),
        placeOnRun(new THREE.BoxGeometry(1.58, 0.16, 0.08), run, 0, 2.33, 0.04),
    );
}

function addAlcoveFeature(group, parts, state, plan, run, cx, cz, resources) {
    if (plan.alcoveFeature === 'elevator') {
        addElevator(parts, run);
        return;
    }
    if (plan.alcoveFeature === 'console') {
        addConsole(group, state, run, 0, cx * 31 + cz * 17, cx, cz, resources);
        return;
    }
    const { clock } = resources.models;
    if (!clock) return;
    group.add(placeObjectOnRun(clock.clone(), run, 0, 0, 0.26));
    const center = runLocalPoint(run, 0, 0.25);
    state.walls.push(createWallRecord(cx, cz, center.x, 1.1, center.z, 0.7, 2.2, 0.7));
}

function addPhone(group, state, run, u, cx, cz, resources, debugNormals, debugMode) {
    const { phone: phoneModel } = resources.models;
    if (!phoneModel) return;
    const phone = placeObjectOnRun(phoneModel.clone(), run, u, 1.28, 0.021);
    const reach = runLocalPoint(run, u, 0.12);
    registerPhone(group, state, phone, cx, cz, reach.x, reach.z, 1.7);
    addDebugHelpers(phone, group, debugNormals, debugMode, 0x00ffff, 0.5);
}

function collectPanelSlots(runs) {
    const slots = [];
    for (const run of runs) {
        for (const slot of getRunSlots(run)) {
            if (slot.kind === 'panel') slots.push({ run, u: slot.u });
        }
    }
    return slots;
}

function decorateRuns(group, parts, state, plan, runs, context, resources) {
    const { cx, cz, phoneSeed, debugNormals } = context;
    const panelSlots = collectPanelSlots(runs);
    const phoneLayoutSeed = (((cx * 12345) ^ (cz * 54321)) ^ phoneSeed) >>> 0;
    const phoneSlot = isPhoneChunk(cx, cz, phoneSeed) && panelSlots.length > 0
        ? panelSlots[Math.floor(hotelNoise(phoneLayoutSeed + 73) * panelSlots.length)]
        : null;
    const normalMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });

    for (const run of runs) {
        addRunTrim(parts, run);
        const middle = runLocalPoint(run, (run.from + run.to) / 2, 0);
        addDebugNormals(group, debugNormals, new THREE.Vector3(middle.x, 1.5, middle.z), [new THREE.Vector3(run.nx, 0, run.nz)], normalMaterial);

        if (run.kind === 'alcove-end') {
            addAlcoveFeature(group, parts, state, plan, run, cx, cz, resources);
            continue;
        }

        for (const slot of getRunSlots(run)) {
            const isPhone = phoneSlot?.run === run && phoneSlot.u === slot.u;
            decorateSlot(group, parts, state, run, slot, isPhone, context, resources);
        }
    }
}

function decorateSlot(group, parts, state, run, slot, isPhone, context, resources) {
    const { cx, cz, debugNormals, debugMode } = context;
    const seed = worldSeed(cx, cz, run, slot.u);
    if (slot.kind === 'door') {
        addDoor(parts, run, slot.u, seed);
        return;
    }

    addPanel(parts, run, slot.u);
    if (isPhone) {
        addPhone(group, state, run, slot.u, cx, cz, resources, debugNormals, debugMode);
        return;
    }

    const roll = hotelNoise(seed + 5);
    if (run.kind === 'corridor' && roll < 0.07) {
        addConsole(group, state, run, slot.u, seed, cx, cz, resources);
    } else if (roll > 0.72) {
        addPainting(group, run, slot.u, 1.55, seed, resources);
    }
}

export function buildHotelChunk({ cx, cz, group, state, debugMode, debugNormals, phoneSeed }) {
    const resources = getHotelResources();
    const { materials } = resources;
    const plan = getChunkPlan(cx, cz);
    const runs = getWallRuns(plan);
    const parts = createPartLists();

    for (const block of getWallBlocks(plan)) {
        parts.walls.push(createWallGeometry(block));
        state.walls.push(createWallRecord(cx, cz, block.x, WALL_HEIGHT / 2, block.z, block.sx, WALL_HEIGHT, block.sz));
    }
    for (const area of getFloorAreas(plan)) {
        parts.carpet.push(createFlatGeometry(area, 0, true, TEXTURE_TILE.carpet));
        parts.ceiling.push(createFlatGeometry(area, 3, false, TEXTURE_TILE.plaster, 4));
    }

    decorateRuns(group, parts, state, plan, runs, { cx, cz, phoneSeed, debugNormals, debugMode }, resources);
    addBeams(parts, plan, runs);
    addLamps(group, parts, state, plan, cx, cz, resources);
    maybeAddExitSign(parts, plan, cx, cz);

    addMergedMesh(group, parts.walls, materials.wall, { castShadow: true, receiveShadow: true });
    addMergedMesh(group, parts.carpet, materials.carpet, { receiveShadow: true });
    addMergedMesh(group, parts.ceiling, materials.ceiling);
    addMergedMesh(group, parts.trim, materials.trim, { receiveShadow: true });
    addMergedMesh(group, parts.doors, materials.door, { receiveShadow: true });
    addMergedMesh(group, parts.damask, materials.damask, { receiveShadow: true });
    addMergedMesh(group, parts.gilt, materials.gilt);
    addMergedMesh(group, parts.shadow, materials.shadow);
    addMergedMesh(group, parts.plates, materials.plate);
    addMergedMesh(group, parts.exit, materials.exit);
}

// Structural walls and fixtures from the neighbouring chunks, so light agrees across borders.
export function createHotelLightingContext(cx, cz) {
    const lightingState = createChunkState();
    const reach = HALF_CHUNK + HOTEL_LIGHT.range;
    for (let nx = cx - 1; nx <= cx + 1; nx++) {
        for (let nz = cz - 1; nz <= cz + 1; nz++) {
            const plan = getChunkPlan(nx, nz);
            for (const block of getWallBlocks(plan)) {
                lightingState.walls.push(createWallRecord(nx, nz, block.x, WALL_HEIGHT / 2, block.z, block.sx, WALL_HEIGHT, block.sz));
            }
            for (const fixture of getFixtures(plan)) {
                const x = nx * CHUNK_SIZE + fixture.x;
                const z = nz * CHUNK_SIZE + fixture.z;
                if (Math.abs(x - cx * CHUNK_SIZE) > reach || Math.abs(z - cz * CHUNK_SIZE) > reach) continue;
                lightingState.lightPanels.push(createFixtureRecord(x, LAMP_HEIGHT, z, isHotelFixturePowered(nx, nz, fixture.x, fixture.z)));
            }
        }
    }
    return createFixtureBakeContext(lightingState.lightPanels, lightingState.walls, HOTEL_LIGHT);
}
