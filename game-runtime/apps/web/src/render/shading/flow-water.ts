import * as THREE from 'three';
import { windTimeUniform } from './wind';

/**
 * Unlit, animated flowing-water shader for the boundary river, its waterfall
 * face and the spray mist below the lip. Render-only.
 *
 * Geometry supplies two attributes:
 *  - `aFlow`  x = metres travelled along the rim (streak phase),
 *             y = 0..1 across the sheet (shore→lip for the river,
 *             top→bottom for the fall, near→far for the mist)
 *  - `aKind`  0 = river surface, 1 = waterfall face (interpolated over the lip)
 *
 * Time comes from the shared wind clock so the water and the vegetation gale
 * stay on the same beat without another per-frame hook.
 */

export const FLOW_WATER_PALETTE = {
  deep: 0x1c4f5e,
  shallow: 0x4d8f96,
  foam: 0xd6e6e3,
  fallDark: 0x7ea8b4,
  fallLight: 0xf2f7f8,
  mist: 0xc6d1d3,
} as const;

const NOISE_GLSL = /* glsl */ `
float fwHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float fwNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fwHash(cell);
  float b = fwHash(cell + vec2(1.0, 0.0));
  float c = fwHash(cell + vec2(0.0, 1.0));
  float d = fwHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fwFbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(0.8, 0.6, -0.6, 0.8);
  for (int octave = 0; octave < 4; octave += 1) {
    total += amplitude * fwNoise(p);
    p = rotate * p * 2.07 + vec2(5.1, 2.3);
    amplitude *= 0.5;
  }
  return total;
}
`;

const VERTEX_SHADER = /* glsl */ `
attribute vec2 aFlow;
attribute float aKind;
varying vec2 vFlow;
varying float vKind;
#include <fog_pars_vertex>
void main() {
  vFlow = aFlow;
  vKind = aKind;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uFallDark;
uniform vec3 uFallLight;
uniform vec3 uMist;
varying vec2 vFlow;
varying float vKind;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  float t = uTime;
  vec3 colour;
  float alpha;
#ifdef FLOW_MIST
  float body = fwFbm(vec2(vFlow.x * 0.22 + t * 0.14, vFlow.y * 1.6 - t * 0.38));
  float wisp = fwNoise(vec2(vFlow.x * 0.9 - t * 0.25, vFlow.y * 4.0 - t * 0.9));
  float edge = smoothstep(0.0, 0.22, vFlow.y) * (1.0 - smoothstep(0.62, 1.0, vFlow.y));
  colour = uMist;
  alpha = smoothstep(0.34, 0.78, body * 0.8 + wisp * 0.2) * 0.62 * edge;
#else
  // River surface: long streaks pulled along the rim, fine ripples across it,
  // foam brushing the bank and whitening again as the water tips over the lip.
  vec2 rp = vec2(vFlow.x * 0.085 - t * 0.5, vFlow.y * 2.4);
  float warp = fwFbm(rp * 0.6 + vec2(t * 0.07, 0.0));
  float streak = fwFbm(rp + vec2(0.0, warp * 0.5));
  float ripple = fwNoise(vec2(vFlow.x * 0.55 - t * 1.2, vFlow.y * 7.0 + t * 0.35));
  vec3 river = mix(uDeep, uShallow, smoothstep(0.32, 0.76, streak) * 0.8 + ripple * 0.2);
  float shoreFoam =
    (1.0 - smoothstep(0.0, 0.2, vFlow.y)) *
    smoothstep(0.42, 0.8, fwFbm(vec2(vFlow.x * 0.5 - t * 0.7, vFlow.y * 9.0)));
  float lipFoam =
    smoothstep(0.76, 1.0, vFlow.y) *
    smoothstep(0.3, 0.72, fwFbm(vec2(vFlow.x * 0.7 + t * 0.15, vFlow.y * 6.0 - t * 1.5)));
  river = mix(river, uFoam, clamp(shoreFoam * 0.7 + lipFoam * 0.85, 0.0, 1.0));
  river += smoothstep(0.66, 0.82, streak) * 0.2;
  float riverAlpha = mix(0.66, 0.92, smoothstep(0.0, 0.3, vFlow.y));

  // Waterfall face: separate vertical streams over dark rock. Streaks are
  // long in y and fine in x, so the sheet tears into ropes of water with
  // gaps between them where the cliff shows through; everything whitens
  // into spray toward the plunge.
  float ropes = fwNoise(vec2(vFlow.x * 1.35, vFlow.y * 0.9 - t * 1.9));
  float ropes2 = fwNoise(vec2(vFlow.x * 3.1 + 7.0, vFlow.y * 2.4 - t * 3.6));
  float torrent = fwFbm(vec2(vFlow.x * 0.55, vFlow.y * 2.8 - t * 2.6));
  float stream = ropes * 0.55 + ropes2 * 0.2 + torrent * 0.25;
  float body = smoothstep(0.34, 0.62, stream);
  float bright = smoothstep(0.52, 0.86, stream);
  vec3 fall = mix(uFallDark, uFallLight, bright);
  float plunge = smoothstep(0.55, 1.0, vFlow.y);
  float lipCurl = 1.0 - smoothstep(0.0, 0.12, vFlow.y);
  fall = mix(fall, uFoam, lipCurl * 0.85);
  fall = mix(fall, uMist, plunge * 0.7);
  float fallAlpha = mix(0.62, 0.98, body);
  fallAlpha = max(fallAlpha, lipCurl * 0.98);
  fallAlpha = mix(fallAlpha, 0.94, plunge * 0.55);

  float kind = clamp(vKind, 0.0, 1.0);
  colour = mix(river, fall, kind);
  alpha = mix(riverAlpha, fallAlpha, kind);
#endif
  gl_FragColor = vec4(colour, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createFlowWaterMaterial(options: { mist?: boolean } = {}): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uDeep: { value: new THREE.Color(FLOW_WATER_PALETTE.deep) },
        uShallow: { value: new THREE.Color(FLOW_WATER_PALETTE.shallow) },
        uFoam: { value: new THREE.Color(FLOW_WATER_PALETTE.foam) },
        uFallDark: { value: new THREE.Color(FLOW_WATER_PALETTE.fallDark) },
        uFallLight: { value: new THREE.Color(FLOW_WATER_PALETTE.fallLight) },
        uMist: { value: new THREE.Color(FLOW_WATER_PALETTE.mist) },
      },
    ]),
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    ...(options.mist ? { defines: { FLOW_MIST: 1 } } : {}),
  });
  // UniformsUtils.merge clones values; the clock has to be the shared object.
  material.uniforms.uTime = windTimeUniform();
  material.name = options.mist ? 'jwgb-flow-water-mist' : 'jwgb-flow-water';
  return material;
}
