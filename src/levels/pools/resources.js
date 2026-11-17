import * as THREE from 'three';
import { loadGltfScene } from '../../models.js';
import { applyPoolSun, applyPoolTileShading, createPoolWaterMaterial } from './shading.js';

/**
 * Level 37 materials and props. The tile is drawn procedurally: eight glazed
 * tiles per metre, so tiles line up with the 1 m layout grid on every surface
 * and no tile is ever cut.
 */

export const TILES_PER_METRE = 8;
// Enamel signs. The first two thirds are ordinary pool rules; the rest are rare, and wrong.
export const SIGN_TEXTS = [
    'NO DIVING', 'NO RUNNING', 'SHALLOW END', 'DEEP END', 'DEPTH 0.8 m', 'DEPTH 1.1 m',
    'NO LIFEGUARD ON DUTY', 'SHOWER BEFORE ENTERING', 'POOL 37', 'CHANGING ROOMS', 'TOWELS',
    'CAPACITY 1', 'DEPTH ∞', '← EXIT →', 'PLEASE REMAIN CALM', 'YOU ARE NOT SWIMMING ALONE',
];
export const SIGN_COLUMNS = 2;
export const SIGN_ROWS = 8;
const TEXTURE_SIZE = 1024;
const TILE_PIXELS = TEXTURE_SIZE / TILES_PER_METRE;
const GROUT_PIXELS = 6;
const BEVEL_PIXELS = 5;

let resources = null;
let loading = null;
const darkenableMaterials = [];

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    return canvas;
}

function finishTexture(canvas, srgb) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 8;
    return texture;
}

// Height of the glaze across one tile: 0 in the grout, rising over a rounded edge to 1.
function tileHeight(x, y) {
    const tx = x % TILE_PIXELS;
    const ty = y % TILE_PIXELS;
    const edge = Math.min(tx, TILE_PIXELS - 1 - tx, ty, TILE_PIXELS - 1 - ty) - GROUT_PIXELS / 2;
    if (edge <= 0) return 0;
    const rise = Math.min(1, edge / BEVEL_PIXELS);
    return rise * rise * (3 - 2 * rise);
}

function createTileTextures() {
    const random = seededRandom(37);
    const colorCanvas = createCanvas();
    const colorContext = colorCanvas.getContext('2d');
    // Dark grout: the grid reads on every surface, and bends visibly under water.
    colorContext.fillStyle = '#5b5846';
    colorContext.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    for (let row = 0; row < TILES_PER_METRE; row++) {
        for (let column = 0; column < TILES_PER_METRE; column++) {
            // Cream tile; each one a breath lighter or warmer than its neighbours.
            const shade = Math.round((random() - 0.5) * 8);
            const warm = Math.round(random() * 4);
            colorContext.fillStyle = `rgb(${238 + shade}, ${232 + shade - warm}, ${202 + shade - warm * 2})`;
            const inset = GROUT_PIXELS / 2;
            colorContext.beginPath();
            colorContext.roundRect(column * TILE_PIXELS + inset, row * TILE_PIXELS + inset, TILE_PIXELS - GROUT_PIXELS, TILE_PIXELS - GROUT_PIXELS, 3);
            colorContext.fill();
        }
    }
    // Fine speckle in the glaze.
    for (let index = 0; index < 5200; index++) {
        colorContext.fillStyle = `rgba(96, 90, 62, ${0.05 + random() * 0.16})`;
        colorContext.fillRect(random() * TEXTURE_SIZE, random() * TEXTURE_SIZE, 1 + random() * 1.4, 1 + random() * 1.4);
    }

    const heights = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
    for (let y = 0; y < TEXTURE_SIZE; y++) {
        for (let x = 0; x < TEXTURE_SIZE; x++) heights[y * TEXTURE_SIZE + x] = tileHeight(x, y);
    }
    const heightAt = (x, y) => heights[((y + TEXTURE_SIZE) % TEXTURE_SIZE) * TEXTURE_SIZE + ((x + TEXTURE_SIZE) % TEXTURE_SIZE)];

    const normalCanvas = createCanvas();
    const normalContext = normalCanvas.getContext('2d');
    const normalImage = normalContext.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
    const roughCanvas = createCanvas();
    const roughContext = roughCanvas.getContext('2d');
    const roughImage = roughContext.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
    for (let y = 0; y < TEXTURE_SIZE; y++) {
        for (let x = 0; x < TEXTURE_SIZE; x++) {
            const offset = (y * TEXTURE_SIZE + x) * 4;
            // Tangent-space normal (green up); canvas rows run downwards.
            const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * 2.2;
            const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * 2.2;
            const length = Math.hypot(dx, dy, 1);
            normalImage.data[offset] = (-dx / length * 0.5 + 0.5) * 255;
            normalImage.data[offset + 1] = (dy / length * 0.5 + 0.5) * 255;
            normalImage.data[offset + 2] = (1 / length * 0.5 + 0.5) * 255;
            normalImage.data[offset + 3] = 255;
            // Glaze is smooth and wet; grout is matt.
            const roughness = 0.92 - heights[y * TEXTURE_SIZE + x] * 0.5;
            roughImage.data[offset] = 255;
            roughImage.data[offset + 1] = roughness * 255;
            roughImage.data[offset + 2] = 0;
            roughImage.data[offset + 3] = 255;
        }
    }
    normalContext.putImageData(normalImage, 0, 0);
    roughContext.putImageData(roughImage, 0, 0);

    return {
        map: finishTexture(colorCanvas, true),
        normalMap: finishTexture(normalCanvas, false),
        roughnessMap: finishTexture(roughCanvas, false),
    };
}

// Cream enamel plates with bottle-green lettering, one per atlas cell.
function createSignAtlas() {
    const canvas = createCanvas();
    const context = canvas.getContext('2d');
    const cellWidth = TEXTURE_SIZE / SIGN_COLUMNS;
    const cellHeight = TEXTURE_SIZE / SIGN_ROWS;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    SIGN_TEXTS.forEach((text, index) => {
        const x = (index % SIGN_COLUMNS) * cellWidth;
        const y = Math.floor(index / SIGN_COLUMNS) * cellHeight;
        context.fillStyle = '#f4f0dc';
        context.fillRect(x, y, cellWidth, cellHeight);
        context.strokeStyle = '#27493f';
        context.lineWidth = 5;
        context.strokeRect(x + 9, y + 9, cellWidth - 18, cellHeight - 18);
        context.fillStyle = '#27493f';
        let size = 54;
        do {
            size -= 2;
            context.font = `bold ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
        } while (context.measureText(text).width > cellWidth - 56);
        context.fillText(text, x + cellWidth / 2, y + cellHeight / 2 + 3);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

function createMaterials() {
    const textures = createTileTextures();
    const tileOptions = { ...textures, metalness: 0, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1 };
    const tile = applyPoolTileShading(new THREE.MeshStandardMaterial({ ...tileOptions, color: 0xffffff }));
    // Lane lines are the same tile in bottle green, laid a few millimetres over the pool floor.
    const line = applyPoolTileShading(new THREE.MeshStandardMaterial({
        ...tileOptions,
        color: 0x1d4a3e,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    }));
    const water = createPoolWaterMaterial();
    // Light wells: flat, shadowless white. Values above 1 feed the bloom pass.
    // No fog: a failed well must stay dark in a dark hall, not glow with the haze.
    const panel = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const steel = applyPoolSun(new THREE.MeshStandardMaterial({ color: 0xe9e6d6, metalness: 0.35, roughness: 0.26 }));
    const sign = applyPoolSun(new THREE.MeshStandardMaterial({ map: createSignAtlas(), roughness: 0.3 }));
    // The coiled slide is the one loud colour in the level.
    const slide = applyPoolSun(new THREE.MeshStandardMaterial({ color: 0xe63a24, roughness: 0.24 }));
    // The inside of a tube slide: seen from within the mouth, it is simply black.
    const hollow = new THREE.MeshBasicMaterial({ color: 0x020405, side: THREE.BackSide, fog: false });
    // Lids over the walls: invisible, except to the sun's depth image.
    const roof = new THREE.MeshBasicMaterial({ visible: false });
    darkenableMaterials.push(tile, line, water);
    return { tile, line, water, panel, steel, sign, slide, hollow, roof };
}

function createGeometry() {
    return { panel: new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2) };
}

// The poolside phone is the Level 0 pay phone. Work on a clone: the cached scene belongs to every level.
async function loadPhoneModel() {
    const source = await loadGltfScene('/models/corded_public_phone_-_low_poly.glb');
    if (!source) return null;
    const phone = source.clone();
    phone.scale.setScalar(0.05);
    phone.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material.map) {
            child.material.metalness = 0;
            child.material.roughness = 0.5;
            child.material.emissive = new THREE.Color(0x222222);
            child.material.needsUpdate = true;
        }
    });
    return phone;
}

export function loadPoolAssets() {
    loading ??= loadPhoneModel().then((phone) => {
        resources = { materials: createMaterials(), geometry: createGeometry(), models: { phone } };
    });
    return loading;
}

export function getPoolResources() {
    return resources;
}

// Stable list: the runtime passes it to the entity every frame.
export function getPoolMaterials() {
    return darkenableMaterials;
}
