import * as THREE from 'three';

export const FIXTURE_LIGHT_RANGE = 7.5;
export const FIXTURE_LIGHT_INTENSITY = 24;
export const TORCH_INTENSITY = 36;
const fixtureColor = new THREE.Color(0xffecc4);
const samplePosition = new THREE.Vector3();
const sampleNormal = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();

// Test a finite ray against a wall's full volume, including its thickness and height.
function wallBlocksLight(x, y, z, dx, dy, dz, box) {
    let near = 0;
    let far = 1;
    for (let axis = 0; axis < 3; axis++) {
        let origin = axis === 0 ? x : y;
        let direction = axis === 0 ? dx : dy;
        if (axis === 2) { origin = z; direction = dz; }
        const min = box.min.getComponent(axis);
        const max = box.max.getComponent(axis);
        if (Math.abs(direction) < 0.000001) {
            if (origin < min || origin > max) return false;
            continue;
        }
        const a = (min - origin) / direction;
        const b = (max - origin) / direction;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
        if (near > far) return false;
    }
    return near < 0.9999 && far > 0.0001;
}

export function createFixtureBakeContext(panels, walls) {
    const lights = panels.map((panel) => {
        const position = panel.userData.worldPosition.clone();
        position.y -= 0.18;
        return {
            position,
            powered: panel.userData.powered,
            walls: walls.map((wall) => wall.userData.worldBox)
                .filter((box) => box.distanceToPoint(position) < FIXTURE_LIGHT_RANGE),
        };
    });
    return { lights };
}

export function sampleFixtureIrradiance(position, normal, context) {
    // Lift the receiver just off its surface to avoid self-shadowing.
    const x = position.x + normal.x * 0.012;
    const y = position.y + normal.y * 0.012;
    const z = position.z + normal.z * 0.012;
    let irradiance = 0;
    for (const light of context.lights) {
        if (!light.powered) continue;
        const dx = light.position.x - x;
        const dy = light.position.y - y;
        const dz = light.position.z - z;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared >= FIXTURE_LIGHT_RANGE ** 2) continue;
        const distance = Math.sqrt(distanceSquared);
        const cosine = Math.max(0, (dx * normal.x + dy * normal.y + dz * normal.z) / Math.max(distance, 0.001));
        if (cosine === 0) continue;
        if (light.walls.some((box) => wallBlocksLight(x, y, z, dx, dy, dz, box))) continue;
        const cutoff = Math.max(0, 1 - (distance / FIXTURE_LIGHT_RANGE) ** 4) ** 2;
        irradiance += FIXTURE_LIGHT_INTENSITY * cosine * cutoff / Math.max(distance ** 1.6, 0.01);
    }
    return irradiance;
}

function applyFixtureMaterial(material) {
    if (material.userData.bakedFixtures) return;
    material.userData.bakedFixtures = true;
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey();
    material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer);
        shader.uniforms.fixtureLightColor = { value: fixtureColor };
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
            #include <common>
            attribute float fixtureIrradiance;
            varying float vFixtureIrradiance;
        `).replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vFixtureIrradiance = fixtureIrradiance;
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
            #include <common>
            uniform vec3 fixtureLightColor;
            varying float vFixtureIrradiance;
        `).replace('#include <lights_fragment_end>', `
            #include <lights_fragment_end>
            reflectedLight.indirectDiffuse += diffuseColor.rgb * fixtureLightColor * vFixtureIrradiance * RECIPROCAL_PI;
        `);
    };
    material.customProgramCacheKey = () => `${previousKey}|baked-fixtures-v1`;
    material.needsUpdate = true;
}

function bakeMesh(mesh, context) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.every((material) => material.isMeshStandardMaterial || material.isMeshLambertMaterial)) return;
    // Floor, ceiling, and prop clones share source geometry; the lighting belongs to this chunk.
    if (!mesh.userData.ownsGeometry) {
        mesh.geometry = mesh.geometry.clone();
        mesh.userData.ownsGeometry = true;
    }
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    if (!normals) return;
    let irradiance = geometry.getAttribute('fixtureIrradiance');
    if (!irradiance) {
        irradiance = new THREE.BufferAttribute(new Float32Array(positions.count), 1);
        geometry.setAttribute('fixtureIrradiance', irradiance);
    }
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    for (let index = 0; index < positions.count; index++) {
        samplePosition.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
        sampleNormal.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize();
        irradiance.setX(index, sampleFixtureIrradiance(samplePosition, sampleNormal, context));
    }
    irradiance.needsUpdate = true;
    materials.forEach((material) => applyFixtureMaterial(material));
}

// Static fixtures illuminate all visible geometry, with no camera-distance cutoff or light budget.
export function bakeFixtureLighting(group, context) {
    group.updateMatrixWorld(true);
    group.traverse((mesh) => {
        if (mesh.isMesh && !mesh.isInstancedMesh) bakeMesh(mesh, context);
    });
}

export function createTorch(camera) {
    const torch = new THREE.SpotLight(0xffedcc, TORCH_INTENSITY, 24, Math.PI / 7, 0.5, 1.3);
    torch.position.set(0.18, -0.12, -0.1);
    torch.target.position.set(0, 0, -10);
    torch.castShadow = true;
    torch.shadow.mapSize.set(512, 512);
    torch.shadow.camera.near = 0.1;
    torch.shadow.camera.far = 24;
    torch.shadow.normalBias = 0.025;
    torch.shadow.bias = -0.0001;
    camera.add(torch, torch.target);
    return torch;
}
