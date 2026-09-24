import * as THREE from 'three';
import { ENTITY_DISTORTION_SHADER } from './shaders/entity.js';

export const ENTITY_HEIGHT = 2.2;
const bounds = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();

function bodyRegion(name) {
    if (/Leg/.test(name)) return 'legs';
    if (/LeftArm|LeftFinger|LeftHand/.test(name)) return 'leftArm';
    if (/RightArm|RightFinger/.test(name)) return 'rightArm';
    if (/Head/.test(name)) return 'head';
    return 'torso';
}

// Bake the asset's nested transforms into metre-sized geometry. The source asset
// has separate body parts, but no skeleton or animation clips.
export function createEntityModel(source) {
    source.updateMatrixWorld(true);
    bounds.setFromObject(source, true);
    bounds.getSize(size);
    bounds.getCenter(center);
    const scale = ENTITY_HEIGHT / size.y;
    const normalization = new THREE.Matrix4().makeScale(scale, scale, scale);
    normalization.multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
    const material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(ENTITY_DISTORTION_SHADER.uniforms),
        vertexShader: ENTITY_DISTORTION_SHADER.vertexShader,
        fragmentShader: ENTITY_DISTORTION_SHADER.fragmentShader,
        side: THREE.DoubleSide,
    });
    const entity = new THREE.Group();
    const parts = [];
    source.traverse(child => {
        if (!child.isMesh) return;
        const geometry = child.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalization, child.matrixWorld));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = child.name;
        mesh.castShadow = true;
        // Shader displacement and animated limbs are covered by this envelope.
        geometry.computeBoundingSphere();
        geometry.boundingSphere.radius += 0.4;
        entity.add(mesh);
        parts.push({ mesh, region: bodyRegion(child.name), rest: Float32Array.from(geometry.attributes.position.array) });
    });
    entity.userData.parts = parts;
    entity.userData.distortionMaterial = material;
    // A circumscribed radius covers every facing direction; extra reach covers
    // arm swing, steps, idle sway and the shader's small surface distortion.
    entity.userData.halfWidth = Math.hypot(size.x * scale / 2, size.z * scale / 2) + 0.4;
    entity.userData.animation = 'idle';
    entity.userData.walkBlend = 0;
    entity.userData.stride = 0;
    entity.visible = false;
    return entity;
}

function posePart(part, time, stride, walkBlend) {
    const { mesh, region, rest } = part;
    const positions = mesh.geometry.attributes.position;
    const arm = region === 'leftArm' || region === 'rightArm';
    const side = region === 'leftArm' ? 1 : -1;
    const armAngle = side * (Math.sin(stride) * 0.13 * walkBlend + Math.sin(time * 1.2) * 0.016);
    const headAngle = Math.sin(time * 0.72) * 0.09;
    const sway = Math.sin(time * 1.2) * 0.012;
    for (let index = 0; index < positions.count; index++) {
        let x = rest[index * 3];
        let y = rest[index * 3 + 1];
        let z = rest[index * 3 + 2];
        if (arm) {
            const pivotY = 1.84;
            const localY = y - pivotY;
            y = pivotY + localY * Math.cos(armAngle) - z * Math.sin(armAngle);
            z = localY * Math.sin(armAngle) + z * Math.cos(armAngle);
        } else if (region === 'legs') {
            // Both legs share a mesh. Blend out each step towards the hip so
            // the connected pelvis stays intact and cables follow the legs.
            const weight = THREE.MathUtils.clamp(1 - y / 1.04, 0, 1);
            const phase = stride + (x < -0.055 ? 0 : Math.PI);
            z += Math.sin(phase) * 0.21 * weight * walkBlend;
            y += Math.max(0, Math.cos(phase)) * 0.1 * weight * walkBlend;
        } else if (region === 'head') {
            const localY = y - 1.88;
            x = x * Math.cos(headAngle) - localY * Math.sin(headAngle);
            y = 1.88 + rest[index * 3] * Math.sin(headAngle) + localY * Math.cos(headAngle);
        }
        x += sway * THREE.MathUtils.clamp(y / ENTITY_HEIGHT, 0, 1);
        positions.setXYZ(index, x, Math.max(0, y), z);
    }
    positions.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
}

export function animateEntityModel(entity, time, delta, speed) {
    const data = entity.userData;
    data.walkBlend = THREE.MathUtils.damp(data.walkBlend, speed > 0 ? 1 : 0, 7, delta);
    data.stride += speed * delta * 9;
    data.animation = speed > 0 ? 'walk' : 'idle';
    for (const part of data.parts) posePart(part, time, data.stride, data.walkBlend);
    data.distortionMaterial.uniforms.time.value = time;
}
