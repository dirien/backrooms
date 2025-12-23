import * as THREE from 'three';

/**
 * Procedural carpet shader - creates fiber texture pattern
 */
export const CARPET_SHADER = {
    uniforms: {
        "baseColor": { value: new THREE.Color(0xa9a865) },
        "fiberScale": { value: 80.0 },
        "fiberIntensity": { value: 0.15 }
    },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
            vUv = uv;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 baseColor;
        uniform float fiberScale;
        uniform float fiberIntensity;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float hash2(vec2 p) {
            return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453);
        }

        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
            vec2 carpetUv = vWorldPos.xz * fiberScale;

            float fiber1 = noise(carpetUv);
            float fiber2 = noise(carpetUv * 2.3 + 17.0);
            float fiber3 = noise(carpetUv * 4.7 + 31.0);

            float fibers = fiber1 * 0.5 + fiber2 * 0.3 + fiber3 * 0.2;
            float colorVar = noise(carpetUv * 0.5) * 0.08;

            vec3 carpetColor = baseColor;
            carpetColor *= 1.0 + (fibers - 0.5) * fiberIntensity;
            carpetColor *= 1.0 + (colorVar - 0.04);

            gl_FragColor = vec4(carpetColor, 1.0);
        }
    `
};
