/**
 * Wake-up eye opening shader effect
 */
export const WAKEUP_SHADER = {
    uniforms: {
        "tDiffuse": { value: null },
        "eyeOpen": { value: 0.0 },
        "blurAmount": { value: 1.0 },
        "effectOpacity": { value: 1.0 }
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
        uniform float eyeOpen;
        uniform float blurAmount;
        uniform float effectOpacity;
        varying vec2 vUv;

        void main() {
            vec2 uv = vUv;
            vec2 center = vec2(0.5, 0.5);
            vec2 centered = uv - center;

            // Get original color for blending at the end
            vec4 original = texture2D(tDiffuse, uv);

            // Blur effect (simple box blur approximation)
            vec4 col = vec4(0.0);
            float blurSize = blurAmount * 0.02;
            col += texture2D(tDiffuse, uv + vec2(-blurSize, -blurSize)) * 0.0625;
            col += texture2D(tDiffuse, uv + vec2(0.0, -blurSize)) * 0.125;
            col += texture2D(tDiffuse, uv + vec2(blurSize, -blurSize)) * 0.0625;
            col += texture2D(tDiffuse, uv + vec2(-blurSize, 0.0)) * 0.125;
            col += texture2D(tDiffuse, uv) * 0.25;
            col += texture2D(tDiffuse, uv + vec2(blurSize, 0.0)) * 0.125;
            col += texture2D(tDiffuse, uv + vec2(-blurSize, blurSize)) * 0.0625;
            col += texture2D(tDiffuse, uv + vec2(0.0, blurSize)) * 0.125;
            col += texture2D(tDiffuse, uv + vec2(blurSize, blurSize)) * 0.0625;

            // Eye shape - elliptical opening
            float aspectRatio = 2.5;
            vec2 eyeCoord = vec2(centered.x, centered.y * aspectRatio);
            float eyeDist = length(eyeCoord);

            // Create eyelid curve
            float eyeRadius = eyeOpen * 0.8;

            // Smooth edge for eyelids
            float edgeSoftness = 0.05 + (1.0 - eyeOpen) * 0.1;
            float eyeMask = smoothstep(eyeRadius, eyeRadius - edgeSoftness, eyeDist);

            // Darken everything outside the eye opening
            col.rgb = mix(vec3(0.0), col.rgb, eyeMask);

            // Eyelid shadow
            float shadowMask = smoothstep(eyeRadius - edgeSoftness * 2.0, eyeRadius, eyeDist);
            col.rgb *= mix(1.0, 0.7, shadowMask * (1.0 - eyeOpen * 0.5));

            // Blend between effect and original based on effectOpacity
            gl_FragColor = mix(original, col, effectOpacity);
        }
    `
};
