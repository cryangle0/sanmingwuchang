import * as THREE from 'three';
import { stormLevelUniform, windTimeUniform } from './wind';

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
  deep: 0x16586a,
  shallow: 0x5cb0b0,
  foam: 0xe4f0ec,
  fallDark: 0x4d7684,
  fallLight: 0xf8fcfd,
  mist: 0xd0dcde,
} as const;

export const FLOW_NOISE_GLSL = /* glsl */ `
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
uniform float uStorm;
varying vec2 vFlow;
varying float vKind;
#include <fog_pars_fragment>
${FLOW_NOISE_GLSL}
void main() {
  float t = uTime;
  vec3 colour;
  float alpha;
#ifdef FLOW_MIST
  // Spray: billowing plumes that rise and drift, denser near the plunge,
  // with a faint rainbow band where the sun catches the droplets.
  float body = fwFbm(vec2(vFlow.x * 0.18 + t * 0.12, vFlow.y * 1.4 - t * 0.55));
  float wisp = fwNoise(vec2(vFlow.x * 1.1 - t * 0.3, vFlow.y * 3.5 - t * 1.3));
  float puff = fwNoise(vec2(vFlow.x * 0.45 + t * 0.08, vFlow.y * 0.8 - t * 0.25));
  float edge = smoothstep(0.0, 0.18, vFlow.y) * (1.0 - smoothstep(0.55, 1.0, vFlow.y));
  float density = smoothstep(0.3, 0.8, body * 0.7 + wisp * 0.2 + puff * 0.3);
  colour = uMist * (0.9 + puff * 0.2);
  float bow = smoothstep(0.42, 0.5, vFlow.y) * (1.0 - smoothstep(0.5, 0.6, vFlow.y));
  vec3 rainbow = vec3(
    0.5 + 0.5 * sin(vFlow.y * 40.0),
    0.5 + 0.5 * sin(vFlow.y * 40.0 + 2.1),
    0.5 + 0.5 * sin(vFlow.y * 40.0 + 4.2));
  colour = mix(colour, rainbow, bow * 0.28 * density);
  alpha = density * (0.55 + 0.35 * uStorm) * edge;
#else
  // River surface: long streaks pulled along the rim, fine ripples across it,
  // foam brushing the bank and whitening again as the water tips over the lip.
  // The sheet runs *outward*: streaks are long across the strip and travel
  // toward the lip, accelerating as they go, so the water visibly leaves the
  // map instead of circling it.
  float pull = 0.35 + vFlow.y * 0.9;
  vec2 rp = vec2(vFlow.x * 0.16, vFlow.y * 1.6 - t * pull);
  float warp = fwFbm(rp * 0.6 + vec2(t * 0.05, 0.0));
  float streak = fwFbm(rp + vec2(warp * 0.35, 0.0));
  float ripple = fwNoise(vec2(vFlow.x * 0.7 + t * 0.2, vFlow.y * 5.0 - t * 1.6));
  vec3 river = mix(uDeep, uShallow, smoothstep(0.32, 0.76, streak) * 0.8 + ripple * 0.2);
  float shoreFoam =
    (1.0 - smoothstep(0.0, 0.18, vFlow.y)) *
    smoothstep(0.42, 0.8, fwFbm(vec2(vFlow.x * 0.5 - t * 0.5, vFlow.y * 9.0)));
  float lipFoam =
    smoothstep(0.6, 1.0, vFlow.y) *
    smoothstep(0.28, 0.7, fwFbm(vec2(vFlow.x * 0.7 + t * 0.1, vFlow.y * 5.0 - t * 2.2)));
  river = mix(river, uFoam, clamp(shoreFoam * 0.6 + lipFoam * 0.9, 0.0, 1.0));
  river += smoothstep(0.62, 0.8, streak) * 0.22;
  // Shallow and glassy over the grass, opaque by the lip.
  float riverAlpha = mix(0.5, 0.94, smoothstep(0.0, 0.45, vFlow.y));

  // Waterfall face: separate vertical streams over dark rock. Streaks are
  // long in y and fine in x, so the sheet tears into ropes of water with
  // gaps between them where the cliff shows through; everything whitens
  // into spray toward the plunge.
  // Gravity: streaks stretch and speed up down the face (t multiplier grows
  // with vFlow.y), and a slow lateral drift keeps the ropes from reading as
  // a static texture scroll.
  float g = 1.0 + vFlow.y * 1.6;
  float ropes = fwNoise(vec2(vFlow.x * 1.35 + sin(t * 0.3) * 0.2, vFlow.y * 0.9 - t * 1.9 * g));
  float ropes2 = fwNoise(vec2(vFlow.x * 3.1 + 7.0, vFlow.y * 2.4 - t * 3.6 * g));
  float torrent = fwFbm(vec2(vFlow.x * 0.55, vFlow.y * 2.8 - t * 2.6 * g));
  float stream = ropes * 0.55 + ropes2 * 0.2 + torrent * 0.25;
  float body = smoothstep(0.3, 0.62, stream);
  float bright = smoothstep(0.5, 0.86, stream) + smoothstep(0.7, 1.0, vFlow.y) * 0.25;
  vec3 fall = mix(uFallDark, uFallLight, bright);
  float plunge = smoothstep(0.55, 1.0, vFlow.y);
  float lipCurl = 1.0 - smoothstep(0.0, 0.12, vFlow.y);
  fall = mix(fall, uFoam, lipCurl * 0.85);
  fall = mix(fall, uMist, plunge * 0.7);
  // Gaps between the ropes show the rock: the sheet is not a solid curtain.
  float fallAlpha = mix(0.3, 0.98, body);
  fallAlpha = max(fallAlpha, lipCurl * 0.98);
  // Below the plunge line the water explodes into spray: it whitens and
  // thickens toward the foot instead of thinning out.
  float splash = smoothstep(0.62, 1.0, vFlow.y);
  float burst = fwFbm(vec2(vFlow.x * 0.9 + t * 0.4, vFlow.y * 3.0 - t * 4.0));
  fall = mix(fall, uFoam, splash * (0.6 + 0.4 * smoothstep(0.35, 0.7, burst)));
  fallAlpha = mix(fallAlpha, 0.98, splash * 0.8);

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
  material.uniforms.uStorm = stormLevelUniform();
  material.name = options.mist ? 'jwgb-flow-water-mist' : 'jwgb-flow-water';
  return material;
}
