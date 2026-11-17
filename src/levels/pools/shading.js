import * as THREE from 'three';
import { WATER_LEVEL } from './layout.js';

/**
 * Level 37 shading: the tile material patch (refraction, caustics, water
 * absorption, wet-floor reflections, light-aware fog) and the water surface.
 * Every pool material shares one set of uniforms, driven from the level's
 * update() and beforeRender() hooks.
 */

export const poolUniforms = {
    poolTime: { value: 0 },
    poolWaterLevel: { value: WATER_LEVEL },
    // x, z: player position; z component: wake strength while wading (0…1).
    poolPlayer: { value: new THREE.Vector3() },
    // 0 while calm, 1 at zero sanity: the water darkens and will not settle.
    poolUnease: { value: 0 },
    poolReflection: { value: null },
    poolReflectionMatrix: { value: new THREE.Matrix4() },
    poolReflectionOn: { value: 0 },
    // x, z, radius, strength of the shape moving under the water, and its heading.
    poolShade: { value: new THREE.Vector4(0, 0, 1, 0) },
    poolShadeHeading: { value: new THREE.Vector2(1, 0) },
    // 1: two caustic layers and light thrown onto walls; 0: one layer, floors only.
    poolDetail: { value: 1 },
    // Sunlight: a depth image of the halls seen from the sun (see sun.js).
    poolSunMap: { value: null },
    poolSunMatrix: { value: new THREE.Matrix4() },
    poolSunTexel: { value: 1 / 2048 },
    poolSunOn: { value: 0 },
    poolSunDirection: { value: new THREE.Vector3(0.527, 0.766, 0.369).normalize() },
    poolSunColor: { value: new THREE.Color(3.7, 3.25, 2.25) },
};

const UNIFORM_DECLARATIONS = /* glsl */`
    uniform float poolTime;
    uniform float poolWaterLevel;
    uniform vec3 poolPlayer;
    uniform float poolUnease;
    uniform sampler2D poolReflection;
    uniform mat4 poolReflectionMatrix;
    uniform float poolReflectionOn;
    uniform vec4 poolShade;
    uniform vec2 poolShadeHeading;
    uniform float poolDetail;
    uniform sampler2D poolSunMap;
    uniform mat4 poolSunMatrix;
    uniform float poolSunTexel;
    uniform float poolSunOn;
    uniform vec3 poolSunDirection;
    uniform vec3 poolSunColor;
`;

// Share of direct sunlight reaching a surface: its angle to the sun, the hard
// shadow of the halls, and a fade to nothing beyond the reach of the depth image.
const SUN_GLSL = /* glsl */`
    float poolSunTap(vec3 coord, vec2 offset) {
        return step(coord.z, texture2D(poolSunMap, coord.xy + offset * poolSunTexel).r);
    }

    float poolSunlight(vec3 world, vec3 facing) {
        if (poolSunOn < 0.5) return 0.0;
        float angle = dot(facing, poolSunDirection);
        float reach = 1.0 - smoothstep(20.0, 28.0, distance(world.xz, poolPlayer.xy));
        if (angle <= 0.0 || reach <= 0.0) return 0.0;
        vec4 projected = poolSunMatrix * vec4(world + facing * 0.02, 1.0);
        vec3 coord = projected.xyz / projected.w;
        // The depth image holds only surfaces turned away from the sun, never the
        // sunlit surface itself, so the comparison can lean towards shadow: no
        // sliver of light where a wall meets the ceiling that shades it.
        coord.z += 0.00025;
        float lit = poolSunTap(coord, vec2(0.0)) * 0.36
            + poolSunTap(coord, vec2(0.7, 0.3)) * 0.16
            + poolSunTap(coord, vec2(-0.3, 0.7)) * 0.16
            + poolSunTap(coord, vec2(-0.7, -0.3)) * 0.16
            + poolSunTap(coord, vec2(0.3, -0.7)) * 0.16;
        return lit * angle * reach;
    }
`;

// Surface slope of the water at a world position: slow crossing swells, finer
// chop, and the rings the player pushes out while wading.
const RIPPLE_GLSL = /* glsl */`
    vec2 poolRipple(vec2 p, float t) {
        vec2 q = p + 0.35 * vec2(sin(p.y * 0.61 + t * 0.21), cos(p.x * 0.53 - t * 0.17));
        float restless = 1.0 + poolUnease * 2.2;
        vec2 slope = vec2(0.0);
        slope += vec2(0.80, 0.60) * cos(dot(q, vec2(0.80, 0.60)) * 2.3 + t * 0.95) * 0.034;
        slope += vec2(-0.50, 0.87) * cos(dot(q, vec2(-0.50, 0.87)) * 3.7 - t * 1.25) * 0.027;
        slope += vec2(0.26, -0.97) * cos(dot(q, vec2(0.26, -0.97)) * 6.1 + t * 1.70) * 0.020;
        slope += vec2(-0.94, -0.34) * cos(dot(q, vec2(-0.94, -0.34)) * 9.7 - t * 2.20) * 0.013;
        slope += vec2(0.64, -0.77) * cos(dot(q, vec2(0.64, -0.77)) * 15.1 + t * 2.90) * 0.008;
        slope *= restless;
        vec2 away = p - poolPlayer.xy;
        float ring = length(away);
        slope += (away / max(ring, 0.05)) * sin(ring * 6.5 - t * 6.0) * exp(-ring * 0.5) * poolPlayer.z * 0.16;
        // Whatever moves under the surface lifts it as it passes.
        vec2 over = p - poolShade.xy;
        float span = length(over);
        slope += (over / max(span, 0.05)) * sin(span * 4.2 - t * 2.6) * exp(-span * 0.65) * poolShade.w * 0.09;
        return slope;
    }
`;

// Caustics follow the edges of drifting cells: the distance between the two
// nearest cell points falls to zero along a connected net of lines, and warping
// the domain bends that net the way a moving surface bends light.
const CAUSTIC_GLSL = /* glsl */`
    vec2 poolCellPoint(vec2 cell) {
        vec2 hashed = vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)));
        return fract(sin(hashed) * 43758.5453);
    }

    // Distance to the nearest cell edge of the drifting net.
    float poolCellEdge(vec2 p, float t) {
        p += 0.21 * vec2(sin(p.y * 1.7 + t * 0.9), cos(p.x * 1.9 - t * 0.8));
        vec2 cell = floor(p);
        vec2 local = fract(p);
        float nearest = 8.0;
        float second = 8.0;
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 offset = vec2(float(i), float(j));
                vec2 seed = poolCellPoint(cell + offset);
                vec2 point = offset + 0.5 + 0.4 * sin(t * (0.5 + seed.yx * 0.5) + seed * 6.2831853) - local;
                float distanceSquared = dot(point, point);
                if (distanceSquared < nearest) {
                    second = nearest;
                    nearest = distanceSquared;
                } else if (distanceSquared < second) {
                    second = distanceSquared;
                }
            }
        }
        return sqrt(second) - sqrt(nearest);
    }

    // On a pool floor: a thin bright filament inside a soft glow.
    float poolCausticNet(vec2 p, float t) {
        float line = 1.0 - smoothstep(0.0, 0.3, poolCellEdge(p, t));
        return line * line * 0.42 + pow(line, 7.0) * 1.25;
    }

    // Thrown back onto walls and ceilings the same net arrives blurred.
    float poolCausticSoft(vec2 p, float t) {
        float line = 1.0 - smoothstep(0.0, 0.62, poolCellEdge(p, t));
        return line * line;
    }

    float poolCaustic(vec2 p, float t) {
        float fine = poolCausticNet(p * 3.1, t);
        if (poolDetail < 0.5) return fine * 1.7;
        float broad = poolCausticNet(p * 1.55 + vec2(4.2, -1.7), t * 0.8 + 2.0);
        // The light gathers and thins out in slow patches across the pool.
        float gather = sin(p.x * 0.9 + sin(p.y * 0.7 + t * 0.2) * 1.4 + t * 0.15) * sin(p.y * 1.1 - t * 0.12);
        return (fine + broad * 0.6 + fine * broad * 1.2) * (1.0 + 0.4 * gather);
    }
`;

const TILE_VERTEX_PARS = /* glsl */`
    attribute float poolAqua;
    attribute float poolFill;
    attribute float poolPlain;
    varying float vPoolAqua;
    varying float vPoolFill;
    varying float vPoolPlain;
    varying vec3 vPoolWorld;
    varying vec3 vPoolNormal;
`;

const TILE_FRAGMENT_PARS = /* glsl */`
    ${UNIFORM_DECLARATIONS}
    uniform vec3 entityWorldPos;
    uniform float entityVisible;
    uniform float darknessRadius;
    uniform float darknessIntensity;
    varying float vPoolAqua;
    varying float vPoolFill;
    varying float vPoolPlain;
    varying vec3 vPoolWorld;
    varying vec3 vPoolNormal;
    // Ceilings are smooth olive plaster, not tile.
    const vec3 poolPlaster = vec3(0.68, 0.67, 0.44);
    vec2 poolUv;
    vec2 poolSurface;
    float poolDepth;
    float poolLight;
    float poolSun;
    ${RIPPLE_GLSL}
    ${CAUSTIC_GLSL}
    ${SUN_GLSL}
`;

// Tiles under water are seen through the moving surface: bend their texture
// coordinates by the ripple slope where the view ray enters the water.
const TILE_FRAGMENT_SETUP = /* glsl */`
    poolDepth = poolWaterLevel - vPoolWorld.y;
    poolSurface = vPoolWorld.xz;
    poolLight = 0.0;
    vec2 poolBend = vec2(0.0);
    if (poolDepth > 0.0) {
        vec3 poolRay = vPoolWorld - cameraPosition;
        float poolEntry = (poolWaterLevel - cameraPosition.y) / min(poolRay.y, -0.0001);
        poolSurface = cameraPosition.xz + poolRay.xz * clamp(poolEntry, 0.0, 1.0);
        poolBend = poolRipple(poolSurface, poolTime) * (0.45 + poolDepth * 2.1);
    }
    vec3 poolFacing = abs(vPoolNormal);
    if (poolFacing.y > 0.5) poolUv = vMapUv + poolBend;
    else poolUv = vMapUv + vec2(poolFacing.x > 0.5 ? poolBend.y : poolBend.x, (poolBend.x + poolBend.y) * 0.5);
`;

const TILE_FRAGMENT_LIGHTS = /* glsl */`
    // Direct sun through the skylights, on top of the soft light baked into the halls.
    poolSun = poolSunlight(vPoolWorld, normalize(vPoolNormal));
    reflectedLight.directDiffuse += diffuseColor.rgb * poolSunColor * poolSun * RECIPROCAL_PI;
    poolLight = vFixtureIrradiance + vPoolFill + poolSun * 2.5;
    // Light scattered around the room reaches surfaces that face away from the skylights.
    reflectedLight.indirectDiffuse += diffuseColor.rgb * fixtureLightColor * vPoolFill * RECIPROCAL_PI;
    if (poolDepth > 0.0) {
        float poolFloorFacing = 0.35 + 0.65 * smoothstep(0.2, 0.8, vPoolNormal.y);
        float poolFocus = 0.45 + 0.55 * smoothstep(0.0, 0.6, poolDepth);
        float poolWeb = poolCaustic(poolSurface + poolBend, poolTime) * poolFloorFacing * poolFocus;
        reflectedLight.indirectDiffuse += diffuseColor.rgb * fixtureLightColor * poolLight * poolWeb * 0.1 * (1.0 - poolUnease * 0.6);
    } else if (poolDetail > 0.5 && vPoolAqua > 0.004) {
        // Light thrown back off the water crawls over nearby walls and ceilings.
        vec2 poolThrow = abs(vPoolNormal.y) > 0.5 ? vPoolWorld.xz : vec2(vPoolWorld.x + vPoolWorld.z, vPoolWorld.y * 1.3);
        float poolWeb = poolCausticSoft(poolThrow * 0.85, poolTime * 0.7 + 7.0);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * fixtureLightColor * poolLight * poolWeb * vPoolAqua * 0.07;
    }
`;

const TILE_FRAGMENT_OUTPUT = /* glsl */`
    float poolFacingView = saturate(dot(normal, normalize(vViewPosition)));
    float poolGloss = 1.0 - roughnessFactor;
    // Glazed ceramic picks up the lit room at grazing angles.
    outgoingLight += fixtureLightColor * poolLight * RECIPROCAL_PI * pow(1.0 - poolFacingView, 3.0) * poolGloss * 0.3;
    if (poolReflectionOn > 0.5 && vPoolNormal.y > 0.9 && poolDepth < 0.0 && vPoolWorld.y < 0.3) {
        // The deck is wet: it mirrors the hall, broken up by the grout.
        vec4 poolMirror = poolReflectionMatrix * vec4(vPoolWorld, 1.0);
        vec2 poolMirrorUv = poolMirror.xy / poolMirror.w + (normal.xy - nonPerturbedNormal.xy) * 0.05;
        float poolFresnel = 0.035 + 0.965 * pow(1.0 - poolFacingView, 5.0);
        outgoingLight = mix(outgoingLight, texture2D(poolReflection, poolMirrorUv).rgb, poolFresnel * poolGloss * 0.8);
    }
    if (poolDepth > 0.0) {
        // Water takes the red out of the light, on the way down and on the way back to the eye.
        vec3 poolToEye = cameraPosition - vPoolWorld;
        float poolSlant = max(poolToEye.y / length(poolToEye), 0.07);
        float poolPath = min(poolDepth / poolSlant, 16.0) + poolDepth;
        vec3 poolAbsorb = vec3(0.62, 0.06, 0.1) * (1.0 + poolUnease * 1.6);
        vec3 poolClear = exp(-poolAbsorb * poolPath);
        vec3 poolBody = vec3(0.04, 0.5, 0.43) * mix(1.0, 0.35, poolUnease) * fixtureLightColor * poolLight * RECIPROCAL_PI;
        outgoingLight = outgoingLight * poolClear + poolBody * (1.0 - exp(-0.16 * poolPath));
        // Something long passes between the light and the tiles.
        vec2 poolShadeOffset = vPoolWorld.xz - poolShade.xy;
        float poolShadeAlong = dot(poolShadeOffset, poolShadeHeading);
        float poolShadeAcross = dot(poolShadeOffset, vec2(-poolShadeHeading.y, poolShadeHeading.x));
        float poolShadow = smoothstep(poolShade.z, poolShade.z * 0.2, length(vec2(poolShadeAlong * 0.42, poolShadeAcross)));
        outgoingLight *= 1.0 - poolShadow * poolShade.w;
    }
`;

// Fog only glows where the room is lit, so halls that lost power stay dark.
const TILE_FRAGMENT_FOG = /* glsl */`
    #ifdef USE_FOG
        float poolFogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        float poolFogLight = mix(0.07, 1.0, saturate(poolLight * 0.45));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * poolFogLight, poolFogFactor);
    #endif
`;

const TILE_FRAGMENT_DARKNESS = /* glsl */`
    if (entityVisible > 0.5) {
        float poolEntityDistance = distance(vPoolWorld, entityWorldPos);
        gl_FragColor.rgb *= mix(1.0 - darknessIntensity, 1.0, smoothstep(0.0, darknessRadius, poolEntityDistance));
    }
`;

function createDarknessUniforms() {
    return {
        entityWorldPos: { value: new THREE.Vector3() },
        entityVisible: { value: 0 },
        darknessRadius: { value: 5 },
        darknessIntensity: { value: 0 },
    };
}

function after(source, include, addition) {
    return source.replace(`#include <${include}>`, `#include <${include}>\n${addition}`);
}

// Where a surface is plaster, the tile's colour, relief, and glaze give way to it.
const PLASTER_OVERRIDES = {
    map_fragment: 'diffuseColor.rgb = mix(diffuseColor.rgb, poolPlaster, vPoolPlain);',
    normal_fragment_maps: 'normal = normalize(mix(normal, nonPerturbedNormal, vPoolPlain));',
    roughnessmap_fragment: 'roughnessFactor = mix(roughnessFactor, 0.96, vPoolPlain);',
};

// Inlines a built-in chunk with its texture coordinates swapped for the bent ones.
function withPoolUv(source, chunk) {
    const bent = THREE.ShaderChunk[chunk].replaceAll(/v(?:Map|NormalMap|RoughnessMap)Uv/g, 'poolUv');
    return source.replace(`#include <${chunk}>`, `${bent}\n${PLASTER_OVERRIDES[chunk] ?? ''}`);
}

/**
 * Turns a MeshStandardMaterial into pool tile. The geometry must carry the
 * `poolAqua` and `poolFill` attributes and be baked by the fixture lighting,
 * which supplies `vFixtureIrradiance` and `fixtureLightColor`.
 */
export function applyPoolTileShading(material) {
    material.userData.darknessUniforms = createDarknessUniforms();
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, poolUniforms, material.userData.darknessUniforms);

        let vertex = after(shader.vertexShader, 'common', TILE_VERTEX_PARS);
        vertex = after(vertex, 'beginnormal_vertex', 'vPoolNormal = objectNormal;');
        vertex = after(vertex, 'begin_vertex', `
            vPoolWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vPoolAqua = poolAqua;
            vPoolFill = poolFill;
            vPoolPlain = poolPlain;
        `);
        shader.vertexShader = vertex;

        let fragment = after(shader.fragmentShader, 'common', TILE_FRAGMENT_PARS);
        fragment = after(fragment, 'clipping_planes_fragment', TILE_FRAGMENT_SETUP);
        for (const chunk of ['map_fragment', 'normal_fragment_begin', 'normal_fragment_maps', 'roughnessmap_fragment']) {
            fragment = withPoolUv(fragment, chunk);
        }
        fragment = after(fragment, 'lights_fragment_end', TILE_FRAGMENT_LIGHTS);
        fragment = fragment.replace('#include <opaque_fragment>', `${TILE_FRAGMENT_OUTPUT}\n#include <opaque_fragment>`);
        fragment = fragment.replace('#include <fog_fragment>', TILE_FRAGMENT_FOG);
        fragment = after(fragment, 'dithering_fragment', TILE_FRAGMENT_DARKNESS);
        shader.fragmentShader = fragment;
    };
    material.customProgramCacheKey = () => 'pool-tile-v3';
    return material;
}

const SUN_UNIFORMS = ['poolPlayer', 'poolSunMap', 'poolSunMatrix', 'poolSunTexel', 'poolSunOn', 'poolSunDirection', 'poolSunColor'];

/** Lets an ordinary MeshStandardMaterial (steel, signs, the slide) catch the sun through the skylights. */
export function applyPoolSun(material) {
    material.onBeforeCompile = (shader) => {
        for (const name of SUN_UNIFORMS) shader.uniforms[name] = poolUniforms[name];
        let vertex = after(shader.vertexShader, 'common', 'varying vec3 vPoolWorld;\nvarying vec3 vPoolNormal;');
        vertex = after(vertex, 'beginnormal_vertex', 'vPoolNormal = normalize(mat3(modelMatrix) * objectNormal);');
        shader.vertexShader = after(vertex, 'begin_vertex', 'vPoolWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        const fragment = after(shader.fragmentShader, 'common', `
            uniform vec3 poolPlayer;
            uniform sampler2D poolSunMap;
            uniform mat4 poolSunMatrix;
            uniform float poolSunTexel;
            uniform float poolSunOn;
            uniform vec3 poolSunDirection;
            uniform vec3 poolSunColor;
            varying vec3 vPoolWorld;
            varying vec3 vPoolNormal;
            ${SUN_GLSL}
        `);
        shader.fragmentShader = after(fragment, 'lights_fragment_end',
            'reflectedLight.directDiffuse += diffuseColor.rgb * poolSunColor * poolSunlight(vPoolWorld, normalize(vPoolNormal)) * RECIPROCAL_PI;');
    };
    material.customProgramCacheKey = () => 'pool-sun-v1';
    return material;
}

const WATER_VERTEX = /* glsl */`
    attribute float poolLight;
    varying vec3 vPoolWorld;
    varying float vPoolLight;
    #include <fog_pars_vertex>

    void main() {
        vec4 poolWorld = modelMatrix * vec4(position, 1.0);
        vPoolWorld = poolWorld.xyz;
        vPoolLight = poolLight;
        vec4 mvPosition = viewMatrix * poolWorld;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;

// The surface itself only reflects; everything seen through it is tinted by the tile shader.
const WATER_FRAGMENT = /* glsl */`
    ${UNIFORM_DECLARATIONS}
    uniform vec3 poolSky;
    uniform vec3 entityWorldPos;
    uniform float entityVisible;
    uniform float darknessRadius;
    uniform float darknessIntensity;
    varying vec3 vPoolWorld;
    varying float vPoolLight;
    #include <common>
    #include <fog_pars_fragment>
    ${RIPPLE_GLSL}
    ${SUN_GLSL}

    void main() {
        vec3 toEye = cameraPosition - vPoolWorld;
        float range = length(toEye);
        vec3 view = toEye / range;
        vec2 slope = poolRipple(vPoolWorld.xz, poolTime) / (1.0 + range * 0.05);
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        float facing = max(dot(normal, view), 0.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);

        vec3 mirrored = poolSky * (0.04 + vPoolLight * 0.16);
        if (poolReflectionOn > 0.5) {
            vec4 mirror = poolReflectionMatrix * vec4(vPoolWorld, 1.0);
            mirrored = texture2D(poolReflection, mirror.xy / mirror.w + slope * 0.55).rgb;
        }
        mirrored *= mix(1.0, 0.5, poolUnease);

        // A faint milky body keeps the surface readable where it reflects nothing.
        vec3 body = vec3(0.4, 0.8, 0.62) * vPoolLight * 0.006;
        float alpha = min(fresnel + 0.03, 1.0);
        gl_FragColor = vec4(mirrored * fresnel + body, alpha);

        // Where the sun reaches the surface, the ripples flash it back.
        float sun = poolSunlight(vPoolWorld, vec3(0.0, 1.0, 0.0));
        float glint = pow(max(dot(normal, normalize(poolSunDirection + view)), 0.0), 900.0) * sun;
        gl_FragColor.rgb += poolSunColor * glint * 6.0;

        if (entityVisible > 0.5) {
            gl_FragColor.rgb *= mix(1.0 - darknessIntensity, 1.0, smoothstep(0.0, darknessRadius, distance(vPoolWorld, entityWorldPos)));
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #ifdef USE_FOG
            float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            float fogLight = mix(0.07, 1.0, saturate((vPoolLight + sun * 2.5) * 0.45));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * fogLight * gl_FragColor.a, fogFactor);
        #endif
    }
`;

export function createPoolWaterMaterial() {
    const darknessUniforms = createDarknessUniforms();
    const material = new THREE.ShaderMaterial({
        uniforms: {
            ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
            ...poolUniforms,
            ...darknessUniforms,
            poolSky: { value: new THREE.Color(0xf3efd2) },
        },
        vertexShader: WATER_VERTEX,
        fragmentShader: WATER_FRAGMENT,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        fog: true,
    });
    material.userData.darknessUniforms = darknessUniforms;
    return material;
}
