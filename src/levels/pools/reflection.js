import * as THREE from 'three';
import { WATER_LEVEL } from './layout.js';
import { poolUniforms } from './shading.js';

/**
 * One planar reflection for the whole level. Every pool lies at WATER_LEVEL
 * and the deck a few centimetres above it, so a single mirrored render serves
 * all water surfaces and the wet floor tiles.
 */

const PLANE_HEIGHT = WATER_LEVEL + 0.03;
const RESOLUTION_SCALE = 0.5;
const CLIP_BIAS = 0.003;

const mirrorCamera = new THREE.PerspectiveCamera();
const planeNormal = new THREE.Vector3(0, 1, 0);
const planePoint = new THREE.Vector3(0, PLANE_HEIGHT, 0);
const mirrorPlane = new THREE.Plane();
const clipPlane = new THREE.Vector4();
const clipCorner = new THREE.Vector4();
const eye = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const rotation = new THREE.Matrix4();
const bufferSize = new THREE.Vector2();
const textureBias = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
);
let target = null;

function mirrorPoint(point) {
    point.y = 2 * PLANE_HEIGHT - point.y;
    return point;
}

function ensureTarget(renderer) {
    renderer.getDrawingBufferSize(bufferSize);
    const width = Math.max(2, Math.round(bufferSize.x * RESOLUTION_SCALE));
    const height = Math.max(2, Math.round(bufferSize.y * RESOLUTION_SCALE));
    if (!target) {
        target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 0 });
        target.texture.generateMipmaps = false;
    } else if (target.width !== width || target.height !== height) {
        target.setSize(width, height);
    }
    return target;
}

function placeMirrorCamera(camera) {
    camera.updateMatrixWorld();
    eye.setFromMatrixPosition(camera.matrixWorld);
    rotation.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rotation).add(eye);

    mirrorCamera.position.copy(mirrorPoint(eye));
    mirrorCamera.up.set(0, 1, 0).applyMatrix4(rotation).reflect(planeNormal);
    mirrorCamera.lookAt(mirrorPoint(lookAt));
    mirrorCamera.far = camera.far;
    mirrorCamera.updateMatrixWorld();
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);

    poolUniforms.poolReflectionMatrix.value
        .copy(textureBias)
        .multiply(mirrorCamera.projectionMatrix)
        .multiply(mirrorCamera.matrixWorldInverse);

    // Oblique near plane: nothing below the water line reaches the mirror image.
    mirrorPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint).applyMatrix4(mirrorCamera.matrixWorldInverse);
    clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);
    const projection = mirrorCamera.projectionMatrix.elements;
    clipCorner.set(
        (Math.sign(clipPlane.x) + projection[8]) / projection[0],
        (Math.sign(clipPlane.y) + projection[9]) / projection[5],
        -1,
        (1 + projection[10]) / projection[14],
    );
    clipPlane.multiplyScalar(2 / clipPlane.dot(clipCorner));
    projection[2] = clipPlane.x;
    projection[6] = clipPlane.y;
    projection[10] = clipPlane.z + 1 - CLIP_BIAS;
    projection[14] = clipPlane.w;
}

export function disablePoolReflection() {
    poolUniforms.poolReflectionOn.value = 0;
    poolUniforms.poolReflection.value = null;
}

/** Renders the mirrored scene. `waterMaterial` is hidden so the water does not reflect itself. */
export function renderPoolReflection(renderer, scene, camera, waterMaterial) {
    if (camera.position.y <= PLANE_HEIGHT + 0.05) {
        disablePoolReflection();
        return;
    }

    const reflectionTarget = ensureTarget(renderer);
    placeMirrorCamera(camera);

    // The mirror image must not sample itself: unbind it while it is the render target.
    const previousTarget = renderer.getRenderTarget();
    poolUniforms.poolReflectionOn.value = 0;
    poolUniforms.poolReflection.value = null;
    waterMaterial.visible = false;
    renderer.setRenderTarget(reflectionTarget);
    renderer.clear();
    renderer.render(scene, mirrorCamera);
    renderer.setRenderTarget(previousTarget);
    waterMaterial.visible = true;
    poolUniforms.poolReflection.value = reflectionTarget.texture;
    poolUniforms.poolReflectionOn.value = 1;
}
