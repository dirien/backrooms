/**
 * Wall shader with baked ambient occlusion at edges
 */
export const WALL_SHADER = {
    uniforms: {
        "wallTexture": { value: null },
        "aoStrength": { value: 0.4 }
    },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;
        void main() {
            vUv = uv;
            vLocalPos = position;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D wallTexture;
        uniform float aoStrength;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;

        void main() {
            vec4 texColor = texture2D(wallTexture, vUv);

            // Calculate AO based on distance from top/bottom edges
            float heightNorm = (vLocalPos.y + 1.5) / 3.0;

            // Darken near floor and ceiling
            float floorAO = smoothstep(0.0, 0.2, heightNorm);
            float ceilAO = smoothstep(1.0, 0.8, heightNorm);
            float ao = min(floorAO, ceilAO);

            vec3 finalColor = texColor.rgb * mix(1.0 - aoStrength, 1.0, ao);

            gl_FragColor = vec4(finalColor, texColor.a);
        }
    `
};
