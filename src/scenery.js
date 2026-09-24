import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const trimMaterial = new THREE.MeshLambertMaterial({ color: 0x645a38 });
const trimH = new THREE.BoxGeometry(8, 0.12, 0.34);
const trimV = new THREE.BoxGeometry(0.34, 0.12, 8.3);
const signGeometry = new THREE.PlaneGeometry(1.15, 0.65);
const signMaterials = new Map();
const notes = ['KEEP MOVING', 'YOU HAVE BEEN HERE', 'LISTEN FOR THE PHONE', 'DO NOT FOLLOW THE VOICE', 'STAFF ONLY', 'NO EXIT'];

function signMaterial(text) {
    if (signMaterials.has(text)) return signMaterials.get(text);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 288;
    const context = canvas.getContext('2d');
    context.fillStyle = '#c5bd91';
    context.fillRect(0, 0, 512, 288);
    context.strokeStyle = '#5e5940';
    context.lineWidth = 5;
    context.strokeRect(14, 14, 484, 260);
    context.fillStyle = '#4b4935';
    context.textAlign = 'center';
    context.font = '18px monospace';
    context.fillText('FACILITIES MANAGEMENT', 256, 60);
    context.font = 'bold 28px monospace';
    const words = text.split(' ');
    const middle = Math.ceil(words.length / 2);
    context.fillText(words.slice(0, middle).join(' '), 256, 135);
    context.fillText(words.slice(middle).join(' '), 256, 175);
    context.font = '15px monospace';
    context.fillText('REPORT ALL IRREGULARITIES', 256, 240);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshLambertMaterial({ map: texture });
    signMaterials.set(text, material);
    return material;
}

export function dressChunk(group, walls, horizontal, vertical, cx, cz) {
    const trims = [];
    for (const [positions, geometry] of [[horizontal, trimH], [vertical, trimV]]) {
        for (const position of positions) trims.push(geometry.clone().translate(position.x, 0.06, position.z));
    }
    if (trims.length > 0) {
        const trim = new THREE.Mesh(mergeGeometries(trims), trimMaterial);
        trim.userData.ownsGeometry = true;
        group.add(trim);
        trims.forEach((geometry) => geometry.dispose());
    }
    if (walls.length === 0) return;
    const index = Math.abs(cx * 73 + cz * 31);
    const wall = walls[index % walls.length];
    const normal = wall.normals[index % 2];
    const sign = new THREE.Mesh(signGeometry, signMaterial(notes[index % notes.length]));
    sign.position.set(wall.center.x + normal.x * 0.16, 1.8, wall.center.z + normal.z * 0.16);
    sign.rotation.y = Math.atan2(normal.x, normal.z);
    group.add(sign);
}
