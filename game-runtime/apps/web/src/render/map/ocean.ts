import * as THREE from 'three';
import { FLOW_NOISE_GLSL } from '../shading/flow-water';
import { hash2 } from '../shading/noise';
import { windTimeUniform } from '../shading/wind';
import { AUTUMN_STORM } from './autumn-storm';
import {
  FALL_LEAN_METERS,
  type RimSample,
  riverLipOffsetMeters,
  riverSurfaceLevels,
  sampleRim,
  seaLevelMeters,
} from './boundary-river';

/**
 * The sea the boundary river falls into.
 *
 * Everything outside the rim used to be one slate-coloured slab sloping away
 * into the fog, which read as a painted floor rather than as water. This is a
 * real sea surface: a flat sheet at the level every waterfall now reaches,
 * with a long swell displaced in the vertex stage, ripple normals, Fresnel sky
 * reflection, sun glitter, whitecaps on the crests, and a plunge pool churned
 * white for the first tens of metres out from the falls. Scene fog carries the
 * far rings into the horizon so the sheet never ends on a visible edge.
 *
 * One static mesh, one unlit shader, one draw call. Nothing here is sampled
 * by the simulation: the playable world still ends at MAP_BOUNDARY.
 */

/** How far the sea reaches past the plunge line, metres. Rings widen outward. */
export const OCEAN_RING_OFFSETS: readonly number[] = [
  0, 4, 9, 16, 26, 40, 60, 88, 125, 175, 240, 330, 450, 600, 800, 1_050, 1_350, 1_750, 2_250, 2_900,
];
/** The scene fog is tuned for the 840 m playfield. The sea damps it so water
 * keeps its own colour, then fades into a sea horizon rather than flat grey. */
const OCEAN_FOG_SCALE = 0.3;
const OCEAN_FOG_STRENGTH = 0.82;
/** The inner ring tucks under the waterfall face so the plunge shows no seam. */
const PLUNGE_TUCK_METERS = 0.35;
/** Plunge ring sits a touch below sea so the fall's foot lands in it, not on it. */
const PLUNGE_SINK_METERS = 0.3;

export const OCEAN_PALETTE = {
  deep: 0x0b2b3f,
  mid: 0x1d7c92,
  shallow: 0x59c2bb,
  shore: 0x8fe0d2,
  /** Reflection tint: cooler than the storm sky so grazing water stays blue. */
  sky: 0x8fb0c2,
  /** Where water meets sky: colder and lighter than the scene fog. */
  horizon: 0x7d9cb2,
  foam: 0xf2f8f5,
  sun: 0xfff3d8,
} as const;

const VERTEX_SHADER = /* glsl */ `
attribute vec2 aSea;
uniform float uTime;
varying vec3 vWorld;
varying vec2 vSea;
varying float vSwell;
#include <fog_pars_vertex>

float oceanSwell(vec2 p, float t) {
  float a = sin(p.x * 0.042 + p.y * 0.021 + t * 0.85);
  float b = sin(p.x * -0.017 + p.y * 0.063 - t * 0.62);
  float c = sin((p.x + p.y) * 0.11 + t * 1.35);
  float d = sin(p.x * 0.19 - p.y * 0.14 + t * 1.9);
  // Mid-frequency train: the long swell alone is invisible from the chase lens.
  float e = sin(p.x * 0.052 + p.y * 0.038 + t * 1.1);
  float f = sin(p.x * -0.031 + p.y * 0.047 - t * 0.95);
  return a * 0.62 + b * 0.78 + c * 0.3 + d * 0.24 + e * 0.34 + f * 0.3;
}

void main() {
  vSea = aSea;
  vec4 world = modelMatrix * vec4(position, 1.0);
  // The plunge pool stays anchored to the fall's foot; the swell grows in
  // over the first thirty metres of open water.
  float mask = smoothstep(3.0, 34.0, aSea.x);
  float swell = oceanSwell(world.xz, uTime) * mask;
  world.y += swell;
  vSwell = swell;
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uShore;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uFoam;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
varying vec3 vWorld;
varying vec2 vSea;
varying float vSwell;
#include <fog_pars_fragment>
${FLOW_NOISE_GLSL}

vec3 oceanNormal(vec2 p, float t, float mask) {
  // Analytic slope of the vertex swell, so lighting agrees with the displaced
  // surface, plus a finite-difference ripple field for the small waves.
  float a = cos(p.x * 0.042 + p.y * 0.021 + t * 0.85);
  float b = cos(p.x * -0.017 + p.y * 0.063 - t * 0.62);
  float c = cos((p.x + p.y) * 0.11 + t * 1.35);
  float d = cos(p.x * 0.19 - p.y * 0.14 + t * 1.9);
  float w1 = cos(p.x * 0.052 + p.y * 0.038 + t * 1.1);
  float w2 = cos(p.x * -0.031 + p.y * 0.047 - t * 0.95);
  float dx = a * 0.62 * 0.042 + b * 0.78 * -0.017 + c * 0.3 * 0.11 + d * 0.24 * 0.19
    + w1 * 0.34 * 0.052 + w2 * 0.3 * -0.031;
  float dz = a * 0.62 * 0.021 + b * 0.78 * 0.063 + c * 0.3 * 0.11 + d * 0.24 * -0.14
    + w1 * 0.34 * 0.038 + w2 * 0.3 * 0.047;
  vec2 rp = p * 0.55 + vec2(t * 0.35, -t * 0.22);
  float e = 0.35;
  float r0 = fwFbm(rp);
  float rx = fwFbm(rp + vec2(e, 0.0));
  float rz = fwFbm(rp + vec2(0.0, e));
  float ripple = 0.19;
  dx = dx * mask + (rx - r0) / e * ripple;
  dz = dz * mask + (rz - r0) / e * ripple;
  return normalize(vec3(-dx, 1.0, -dz));
}

void main() {
  float t = uTime;
  float mask = smoothstep(3.0, 34.0, vSea.x);
  vec3 n = oceanNormal(vWorld.xz, t, mask);
  vec3 toCamera = normalize(cameraPosition - vWorld);
  float ndv = max(0.0, dot(n, toCamera));
  float fresnel = 0.04 + 0.96 * pow(1.0 - ndv, 4.2);

  // Body colour: surf-white shallows at the plunge, turquoise shelf, then the
  // open sea. The three bands are what make the sheet read as water rather
  // than one flat tint.
  vec3 body = mix(uShore, uShallow, smoothstep(2.0, 16.0, vSea.x));
  body = mix(body, uMid, smoothstep(12.0, 60.0, vSea.x));
  body = mix(body, uDeep, smoothstep(45.0, 260.0, vSea.x));
  float crest = smoothstep(-0.5, 1.3, vSwell);
  body = mix(body, uMid * 1.45, crest * 0.5 * mask);
  // Swell shading: light on the forward face, dark in the trough, so the
  // surface has readable waves even where nothing reflects.
  body *= 0.9 + crest * 0.22;
  vec3 colour = mix(body, uSky, fresnel * 0.44);

  // Sun glitter: a tight highlight over a broad sheen.
  vec3 h = normalize(uSunDirection + toCamera);
  float ndh = max(0.0, dot(n, h));
  float glint = pow(ndh, 240.0) * 2.4 + pow(ndh, 18.0) * 0.3;
  colour += uSunColor * glint * (0.34 + 0.66 * fresnel);

  // Long crest lines running with the swell: the one cue that still reads as
  // "waves" when the camera is far enough that individual ripple normals
  // vanish. Frequencies are low on purpose so they survive to the horizon.
  float crestField = fwFbm(vec2(vWorld.x * 0.035 + vWorld.z * 0.02, vWorld.z * 0.006 - t * 0.05));
  float crestLines = smoothstep(0.52, 0.86, crestField) * smoothstep(60.0, 320.0, vSea.x);
  body = mix(body, uMid * 1.5, crestLines * 0.35);
  colour = mix(colour, uMid * 1.35, crestLines * 0.3 * (1.0 - fresnel * 0.5));
  colour = mix(colour, uFoam, crestLines * crest * 0.5);

  // Whitecaps ride the swell crests in open water.
  float capNoise = fwFbm(vWorld.xz * 0.075 + vec2(t * 0.09, t * 0.05));
  float caps = smoothstep(0.44, 0.7, capNoise) * smoothstep(0.18, 0.95, crest) * mask;

  // Plunge pool: the falls boil the first tens of metres white, and long
  // foam streaks are driven outward from the rim.
  float churn = 1.0 - smoothstep(0.0, 38.0, vSea.x);
  float boil = fwFbm(vec2(vSea.y * 0.16 + t * 0.35, vSea.x * 0.42 - t * 2.4));
  float streak = fwNoise(vec2(vSea.y * 0.45, vSea.x * 0.08 - t * 0.85));
  float foamPlunge = churn * (0.5 + 0.5 * smoothstep(0.28, 0.72, boil)) + churn * churn * 0.4;
  float foamStreaks = (1.0 - smoothstep(4.0, 88.0, vSea.x)) * smoothstep(0.5, 0.88, streak) * 0.62;
  float foam = clamp(foamPlunge + foamStreaks + caps * 0.9, 0.0, 1.0);
  colour = mix(colour, uFoam, foam);

  // Far water deepens a little, then the horizon takes over.
  colour = mix(colour, uDeep * 0.85, smoothstep(280.0, 900.0, vSea.x) * 0.5);

  // The scene FogExp2 is tuned for the 840 m playfield: applied raw it flattens
  // every wave into the fog colour within 300 m, which is why the sea used to
  // read as a painted grey slab. Damp it, then blend into a colder sea horizon
  // so the water keeps its colour and the sheet still dissolves into the sky.
  float viewDistance = length(cameraPosition - vWorld);
  float oceanFog = 1.0 - exp(-pow(fogDensity * ${OCEAN_FOG_SCALE} * viewDistance, 2.0));
  oceanFog = clamp(oceanFog * ${OCEAN_FOG_STRENGTH}, 0.0, 1.0);
  float horizonFade = smoothstep(2000.0, 5200.0, viewDistance) * 0.78;
  colour = mix(colour, uHorizon, max(oceanFog, horizonFade));

  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createOceanMaterial(): THREE.ShaderMaterial {
  const sun = new THREE.Vector3(
    AUTUMN_STORM.sunOffsetX,
    AUTUMN_STORM.sunHeight,
    AUTUMN_STORM.sunOffsetZ,
  ).normalize();
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uDeep: { value: new THREE.Color(OCEAN_PALETTE.deep) },
        uMid: { value: new THREE.Color(OCEAN_PALETTE.mid) },
        uShallow: { value: new THREE.Color(OCEAN_PALETTE.shallow) },
        uSky: { value: new THREE.Color(OCEAN_PALETTE.sky) },
        uHorizon: { value: new THREE.Color(OCEAN_PALETTE.horizon) },
        uShore: { value: new THREE.Color(OCEAN_PALETTE.shore) },
        uFoam: { value: new THREE.Color(OCEAN_PALETTE.foam) },
        uSunColor: { value: new THREE.Color(OCEAN_PALETTE.sun) },
        uSunDirection: { value: sun },
      },
    ]),
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    fog: true,
    side: THREE.FrontSide,
  });
  // UniformsUtils.merge clones values; the clock has to be the shared object.
  material.uniforms.uTime = windTimeUniform();
  material.name = 'jwgb-ocean';
  return material;
}

/** Sea surface height in world metres, the level every boundary fall reaches. */
export function oceanLevelMeters(rim: readonly RimSample[] = sampleRim()): number {
  return seaLevelMeters(riverSurfaceLevels(rim));
}

export function buildOcean(
  group: THREE.Group,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): THREE.Mesh | null {
  const rim = sampleRim();
  if (rim.length < 3) {
    return null;
  }
  const sea = oceanLevelMeters(rim);
  const base = riverLipOffsetMeters() + FALL_LEAN_METERS - PLUNGE_TUCK_METERS;
  const positions: number[] = [];
  const seaAttribute: number[] = [];
  const indices: number[] = [];
  const count = rim.length;
  const ringCount = OCEAN_RING_OFFSETS.length;
  for (let index = 0; index < count; index += 1) {
    const sample = rim[index] as RimSample;
    for (let ring = 0; ring < ringCount; ring += 1) {
      const offset = base + (OCEAN_RING_OFFSETS[ring] as number);
      positions.push(
        sample.x + sample.outX * offset,
        ring === 0 ? sea - PLUNGE_SINK_METERS : sea,
        sample.z + sample.outZ * offset,
      );
      seaAttribute.push(OCEAN_RING_OFFSETS[ring] as number, sample.distance);
    }
  }
  for (let index = 0; index < count; index += 1) {
    const a = index * ringCount;
    const b = ((index + 1) % count) * ringCount;
    for (let ring = 0; ring + 1 < ringCount; ring += 1) {
      // Wound counter-clockwise seen from above so the front face is the one
      // the player looks down on. The previous order faced the sea away from
      // the camera, so the whole surface was backface-culled and the outer
      // world showed nothing but sky.
      indices.push(a + ring, b + ring, a + ring + 1, b + ring, b + ring + 1, a + ring + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSea', new THREE.Float32BufferAttribute(seaAttribute, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(track(geometry), createOceanMaterial());
  mesh.name = 'beyond-ocean';
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  group.add(mesh);
  buildPlungeApron(group, track, rim, sea, base);
  buildCoastalSkerries(group, track, rim, sea, base);
  return mesh;
}

/**
 * Wet rock shelf between the fall's foot and open water.
 *
 * A waterfall that lands on a perfectly flat sheet still reads as two
 * materials meeting. This apron is the missing shore: dark, wet, slightly
 * raised at the cliff and sinking under the first swell.
 */
function buildPlungeApron(
  group: THREE.Group,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  rim: readonly RimSample[],
  sea: number,
  base: number,
): void {
  const offsets = [0.6, 4.5, 10, 18];
  const heights = [sea + 0.42, sea + 0.12, sea - 0.08, sea - 0.22];
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const wet = new THREE.Color(0x3a4a44);
  const foam = new THREE.Color(0x8aa8a0);
  const count = rim.length;
  const ringCount = offsets.length;
  for (let index = 0; index < count; index += 1) {
    const sample = rim[index] as RimSample;
    for (let ring = 0; ring < ringCount; ring += 1) {
      const offset = base + (offsets[ring] as number);
      positions.push(
        sample.x + sample.outX * offset,
        heights[ring] as number,
        sample.z + sample.outZ * offset,
      );
      const mix = ring / (ringCount - 1);
      const colour = wet.clone().lerp(foam, mix * 0.45);
      colours.push(colour.r, colour.g, colour.b);
    }
  }
  for (let index = 0; index < count; index += 1) {
    const a = index * ringCount;
    const b = ((index + 1) % count) * ringCount;
    for (let ring = 0; ring + 1 < ringCount; ring += 1) {
      indices.push(a + ring, b + ring, a + ring + 1, b + ring, b + ring + 1, a + ring + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.04,
    envMapIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(track(geometry), material);
  mesh.name = 'beyond-ocean-apron';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  group.add(mesh);
}

function buildCoastalSkerries(
  group: THREE.Group,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  rim: readonly RimSample[],
  sea: number,
  base: number,
): void {
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];
  const colours: THREE.Color[] = [];
  const rock = new THREE.Color(0x5a645c);
  const wet = new THREE.Color(0x3d4e48);
  for (let index = 0; index < rim.length; index += 2) {
    const sample = rim[index] as RimSample;
    const n = 1 + (hash2(index, 3, 0x51) < 0.45 ? 1 : 0);
    for (let rockIndex = 0; rockIndex < n; rockIndex += 1) {
      const along = (hash2(index, rockIndex, 0x61) - 0.5) * 3.2;
      const out = 7 + hash2(index, rockIndex, 0x71) * 22;
      const size = 0.7 + hash2(index, rockIndex, 0x81) * 1.8;
      dummy.position.set(
        sample.x + sample.outX * (base + out) - sample.outZ * along,
        sea + size * 0.28,
        sample.z + sample.outZ * (base + out) + sample.outX * along,
      );
      dummy.rotation.set(
        hash2(index, rockIndex, 0x91) * 0.7,
        hash2(index, rockIndex, 0xa1) * Math.PI * 2,
        hash2(index, rockIndex, 0xb1) * 0.5,
      );
      dummy.scale.set(size, size * (0.55 + hash2(index, rockIndex, 0xc1) * 0.7), size * 0.82);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
      colours.push(rock.clone().lerp(wet, hash2(index, rockIndex, 0xd1)));
    }
  }
  if (matrices.length === 0) {
    return;
  }
  const mesh = new THREE.InstancedMesh(
    track(new THREE.IcosahedronGeometry(1, 1)),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.02,
      color: 0xffffff,
    }),
    matrices.length,
  );
  mesh.name = 'beyond-ocean-skerries';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const colour = new THREE.Color();
  for (let index = 0; index < matrices.length; index += 1) {
    mesh.setMatrixAt(index, matrices[index] as THREE.Matrix4);
    mesh.setColorAt(index, colours[index] ?? colour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  group.add(mesh);
}
