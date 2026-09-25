import * as THREE from 'three';
import { CHUNK_SIZE } from '../../constants.js';
import { enhanceMaterialWithDarkness, loadGltfScene, loadTexture } from '../../models.js';
import { CELL_SIZE, WALL_HEIGHT, WALL_LENGTH_H, WALL_LENGTH_V, WALL_THICKNESS } from './layout.js';

/**
 * Level 0 materials, geometry, and props.
 */

const THEME = {
    ceilingColor: 0xbbbbbb,
    floorColor: 0xa9a865,
    lightPanelColor: 0xffffff,
    wallColor: 0xffffff,
};

let resources = null;
let loading = null;
const darkenableMaterials = [];

// Create wall geometry with proper UV mapping
function createWallGeometry(width, height, depth) {
    const geo = new THREE.BoxGeometry(width, height, depth, Math.ceil(width * 2), Math.ceil(height * 2), Math.ceil(depth * 2));
    const uvAttribute = geo.attributes.uv;
    const posAttribute = geo.attributes.position;
    const normalAttribute = geo.attributes.normal;

    const texScale = 2.0;

    for (let i = 0; i < uvAttribute.count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i);
        const z = posAttribute.getZ(i);

        const nx = normalAttribute.getX(i);
        const nz = normalAttribute.getZ(i);

        let u, v;

        if (Math.abs(nx) > 0.5) {
            u = (z + depth / 2) / texScale;
            v = (y + height / 2) / texScale;
        } else if (Math.abs(nz) > 0.5) {
            u = (x + width / 2) / texScale;
            v = (y + height / 2) / texScale;
        } else {
            u = (x + width / 2) / texScale;
            v = (z + depth / 2) / texScale;
        }

        uvAttribute.setXY(i, u, v);
    }

    uvAttribute.needsUpdate = true;
    return geo;
}

function createMaterials() {
    const wallTexture = loadTexture('/graphics/wallpaper.webp');
    const ceilingTexture = loadTexture('/graphics/ceiling-tile.webp', { srgb: false });
    const tileWorldSize = 1.5;
    ceilingTexture.repeat.set(CHUNK_SIZE / tileWorldSize, CHUNK_SIZE / tileWorldSize);

    const wallMat = new THREE.MeshStandardMaterial({ color: THEME.wallColor, roughness: 0.95, map: wallTexture, side: THREE.FrontSide });
    const floorMat = new THREE.MeshStandardMaterial({ color: THEME.floorColor, roughness: 1, side: THREE.FrontSide });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: THEME.ceilingColor, map: ceilingTexture, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    const lightPanelMat = new THREE.MeshBasicMaterial({ color: THEME.lightPanelColor });
    for (const material of [wallMat, floorMat, ceilingMat, lightPanelMat]) enhanceMaterialWithDarkness(material);
    return { wallMat, floorMat, ceilingMat, lightPanelMat };
}

function createGeometry() {
    return {
        lightPanelGeo: new THREE.PlaneGeometry(CELL_SIZE * 0.4, CELL_SIZE * 0.2),
        wallGeoV: createWallGeometry(WALL_THICKNESS, WALL_HEIGHT, WALL_LENGTH_V),
        wallGeoH: createWallGeometry(WALL_LENGTH_H, WALL_HEIGHT, WALL_THICKNESS),
        floorGeo: new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE * 2),
        ceilingGeo: new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE * 2),
    };
}

async function loadOutletModel() {
    const outletModel = await loadGltfScene('/models/wall_outlet_american.glb');
    if (!outletModel) return null;
    outletModel.scale.set(0.75, 0.75, 0.75);
    outletModel.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material.map) {
            child.material.metalness = 0;
            child.material.roughness = 0.4;
            child.material.color = new THREE.Color(0xffffff);
            child.material.emissive = new THREE.Color(0x222222);
            child.material.needsUpdate = true;
        } else {
            child.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.0, emissive: 0xbbbbbb });
        }
    });
    return outletModel;
}

async function loadWallPhoneModel() {
    const wallPhoneModel = await loadGltfScene('/models/corded_public_phone_-_low_poly.glb');
    if (!wallPhoneModel) return null;
    wallPhoneModel.scale.set(0.05, 0.05, 0.05);
    wallPhoneModel.traverse((child) => {
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
    return wallPhoneModel;
}

export function loadLobbyAssets() {
    loading ??= Promise.all([loadOutletModel(), loadWallPhoneModel()]).then(([outletModel, wallPhoneModel]) => {
        const materials = createMaterials();
        resources = { ...materials, ...createGeometry(), outletModel, wallPhoneModel };
        darkenableMaterials.push(materials.wallMat, materials.floorMat, materials.ceilingMat, materials.lightPanelMat);
    });
    return loading;
}

export function getLobbyResources() {
    return resources;
}

// Stable list: the runtime passes it to the entity every frame.
export function getLobbyMaterials() {
    return darkenableMaterials;
}
