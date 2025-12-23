/**
 * Entity distortion shader - Digital glitch effect in black
 */
export const ENTITY_DISTORTION_SHADER = {
    uniforms: {
        "time": { value: 0.0 },
        "glitchIntensity": { value: 1.0 }
    },
    vertexShader: `
        uniform float time;
        uniform float glitchIntensity;

        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;

        float random(float x) {
            return fract(sin(x * 12.9898) * 43758.5453);
        }

        void main() {
            vNormal = normalMatrix * normal;
            vPosition = position;

            vec3 pos = position;

            // Horizontal slice glitch
            float sliceY = floor(pos.y * 20.0);
            float glitchTime = floor(time * 10.0);
            float sliceRand = random(sliceY + glitchTime);

            if (sliceRand > 0.88) {
                float offset = (random(sliceY * glitchTime) - 0.5) * 0.4 * glitchIntensity;
                pos.x += offset;
            }

            // Vertical slice glitch
            float sliceX = floor(pos.x * 15.0);
            float sliceRandX = random(sliceX + glitchTime * 1.3);
            if (sliceRandX > 0.92) {
                pos.y += (random(sliceX * glitchTime) - 0.5) * 0.2 * glitchIntensity;
            }

            // Random vertex displacement
            float dispTime = floor(time * 15.0);
            float disp = step(0.95, random(dispTime + pos.y * 50.0 + pos.x * 30.0));
            pos += normal * disp * 0.15 * glitchIntensity;

            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPosition = worldPos.xyz;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float time;
        uniform float glitchIntensity;

        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;

        float random(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec3 color = vec3(0.0);
            vec3 darkGray = vec3(0.03);
            vec3 midGray = vec3(0.06);

            // Subtle scan lines
            float scanLine = step(0.5, fract(vPosition.y * 60.0));
            color += darkGray * scanLine * 0.3;

            // Digital block noise
            vec2 blockUV = floor(vPosition.xy * 25.0);
            float blockNoise = random(blockUV + floor(time * 12.0));
            float block = step(0.94, blockNoise);
            color += midGray * block;

            // Glitch lines
            float glitchLine = step(0.98, random(vec2(floor(vPosition.y * 40.0), floor(time * 20.0))));
            color += vec3(0.08) * glitchLine * glitchIntensity;

            // Static noise
            float staticNoise = random(vPosition.xy * 100.0 + time * 50.0);
            color += vec3(staticNoise * 0.02);

            // Edge highlight
            vec3 viewDir = normalize(cameraPosition - vWorldPosition);
            float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 3.0);
            color += vec3(0.05) * fresnel;

            // Black-out flicker
            float blackout = step(0.98, random(vec2(floor(time * 25.0), 0.0)));
            color *= (1.0 - blackout * 0.9);

            gl_FragColor = vec4(color, 1.0);
        }
    `
};
