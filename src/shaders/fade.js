/**
 * Fade to black shader for phone interaction
 */
export const FADE_SHADER = {
    uniforms: {
        "tDiffuse": { value: null },
        "fadeAmount": { value: 0.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float fadeAmount;
        varying vec2 vUv;

        void main() {
            vec4 col = texture2D(tDiffuse, vUv);
            col.rgb = mix(col.rgb, vec3(0.0), fadeAmount);
            gl_FragColor = col;
        }
    `
};
