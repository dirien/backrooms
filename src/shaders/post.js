/**
 * Post-processing shader for sanity effects
 */
export const POST_SHADER = {
    uniforms: {
        "tDiffuse": { value: null },
        "time": { value: 0.0 },
        "sanity": { value: 1.0 }
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
        uniform float time;
        uniform float sanity;
        varying vec2 vUv;

        float random(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = random(i);
            float b = random(i + vec2(1.0, 0.0));
            float c = random(i + vec2(0.0, 1.0));
            float d = random(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
            vec2 uv = vUv;
            float sFac = clamp(1.0 - sanity, 0.0, 1.0);
            vec2 centeredUv = uv - 0.5;
            float d = length(centeredUv);

            // === LEVEL 1: sanity <= 80% - Subtle wave distortion ===
            float level1 = smoothstep(0.8, 0.7, sanity);
            float wave1 = sin(uv.y * 15.0 + time * 2.0) * 0.003 * level1;
            uv.x += wave1;

            // === LEVEL 2: sanity <= 50% - Chromatic aberration + stronger waves ===
            float level2 = smoothstep(0.5, 0.4, sanity);
            float wave2 = sin(uv.x * 20.0 + time * 3.0) * cos(uv.y * 10.0 + time) * 0.006 * level2;
            uv += vec2(wave2, wave2 * 0.5);

            // === LEVEL 3: sanity <= 30% - Tunnel vision + pulsing + heavy distortion ===
            float level3 = smoothstep(0.3, 0.2, sanity);
            float pulse = sin(time * 4.0) * 0.5 + 0.5;
            float tunnel = d * d * 0.15 * level3 * (1.0 + pulse * 0.3);
            uv += centeredUv * tunnel;

            // Spiral distortion
            float angle = atan(centeredUv.y, centeredUv.x);
            float spiral = sin(angle * 3.0 + time * 2.0 + d * 10.0) * 0.008 * level3;
            uv += vec2(cos(angle), sin(angle)) * spiral;

            // === LEVEL 4: sanity <= 10% - Complete insanity ===
            float level4 = smoothstep(0.1, 0.0, sanity);

            // Violent screen shake
            float shake = level4 * 0.02;
            uv.x += (random(vec2(time * 10.0, 0.0)) - 0.5) * shake;
            uv.y += (random(vec2(0.0, time * 10.0)) - 0.5) * shake;

            // Reality fracturing
            float fracture = sin(time * 8.0 + uv.y * 30.0) * 0.015 * level4;
            uv.x += fracture;

            // Kaleidoscope effect
            if (level4 > 0.5) {
                float kAngle = atan(centeredUv.y, centeredUv.x);
                float kDist = length(centeredUv);
                kAngle = mod(kAngle + time * 0.5, 3.14159 / 3.0) - 3.14159 / 6.0;
                vec2 kUv = vec2(cos(kAngle), sin(kAngle)) * kDist + 0.5;
                uv = mix(uv, kUv, level4 * 0.3);
            }

            // Base barrel distortion
            uv += centeredUv * d * d * 0.04;

            // Base sanity warp
            float warp = sin(uv.x * 10.0 + time) * 0.002 * sFac;
            uv.y += warp;

            // Sample the texture
            vec4 col = texture2D(tDiffuse, uv);

            // === Chromatic aberration (levels 2-4) ===
            float chromaStrength = level2 * 0.008 + level3 * 0.015 + level4 * 0.03;
            if (chromaStrength > 0.0) {
                vec2 chromaDir = normalize(centeredUv) * chromaStrength;
                col.r = texture2D(tDiffuse, uv + chromaDir).r;
                col.b = texture2D(tDiffuse, uv - chromaDir).b;
            }

            // === Film grain ===
            float grain = (random(uv + time) - 0.5) * (0.05 + sFac * 0.15);
            col.rgb += grain;

            // === Color shifts ===
            float gray = dot(col.rgb, vec3(0.299, 0.587, 0.114));
            col.rgb = mix(col.rgb, vec3(gray), sFac * 0.4);
            col.g += level2 * 0.03;

            // Level 3+: Color cycling
            if (level3 > 0.0) {
                vec3 tint = vec3(
                    sin(time * 1.5) * 0.5 + 0.5,
                    sin(time * 1.5 + 2.094) * 0.5 + 0.5,
                    sin(time * 1.5 + 4.188) * 0.5 + 0.5
                );
                col.rgb = mix(col.rgb, col.rgb * tint, level3 * 0.2);
            }

            // Level 4: Color inversion flashes
            if (level4 > 0.0) {
                float flash = step(0.95, random(vec2(floor(time * 8.0), 0.0)));
                col.rgb = mix(col.rgb, 1.0 - col.rgb, flash * level4);
            }

            // === Vignette ===
            float vignetteBase = smoothstep(1.0, 0.35, d);
            float vignettePulse = level3 > 0.0 ? (sin(time * 3.0) * 0.1 + 0.9) : 1.0;
            float vignetteStrength = vignetteBase * vignettePulse;
            vignetteStrength = mix(vignetteStrength, vignetteStrength * 0.7, level4);
            col.rgb *= vignetteStrength;

            // === Scan lines (level 4) ===
            if (level4 > 0.0) {
                float scanline = sin(vUv.y * 400.0 + time * 50.0) * 0.5 + 0.5;
                col.rgb *= 1.0 - scanline * 0.15 * level4;
            }

            // === Double vision (level 3+) ===
            if (level3 > 0.0) {
                vec2 offset = vec2(0.01 + level4 * 0.02, 0.005) * (sin(time * 2.0) * 0.5 + 0.5);
                vec4 ghost = texture2D(tDiffuse, uv + offset);
                col.rgb = mix(col.rgb, ghost.rgb, level3 * 0.25);
            }

            gl_FragColor = col;
        }
    `
};
