import * as THREE from 'three';
import { FLOW_NOISE_GLSL } from '../shading/flow-water';
import { hash2 } from '../shading/noise';
import { windTimeUniform } from '../shading/wind';
import { SKY_PALETTE } from './atmosphere';
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
  0, 4, 9, 16, 26, 40, 60, 88, 125, 175, 240, 330, 450, 600, 800, 1_050,
];
/** The inner ring tucks under the waterfall face so the plunge shows no seam. */
const PLUNGE_TUCK_METERS = 0.35;
/** Plunge ring sits a touch below sea so the fall's foot lands in it, not on it. */
const PLUNGE_SINK_METERS = 0.3;

export const OCEAN_PALETTE = {
  deep: 0x0a2434,
  mid: 0x1a6274,
  shallow: 0x4aa8a4,
  sky: SKY_PALETTE.horizon,
  foam: 0xe8f2ee,
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
  return a * 0.58 + b * 0.72 + c * 0.22 + d * 0.16;
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
uniform vec3 uSky;
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
  float dx = a * 0.58 * 0.042 + b * 0.72 * -0.017 + c * 0.22 * 0.11 + d * 0.16 * 0.19;
  float dz = a * 0.58 * 0.021 + b * 0.72 * 0.063 + c * 0.22 * 0.11 + d * 0.16 * -0.14;
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

  // Body colour: turquoise churn at the plunge, deepening with distance.
  vec3 body = mix(uShallow, uMid, smoothstep(0.0, 48.0, vSea.x));
  body = mix(body, uDeep, smoothstep(36.0, 220.0, vSea.x));
  float crest = smoothstep(-0.4, 1.2, vSwell);
  body = mix(body, uMid * 1.28, crest * 0.4 * mask);
  vec3 colour = mix(body, uSky, fresnel * 0.68);

  // Sun glitter: a tight highlight over a broad sheen.
  vec3 h = normalize(uSunDirection + toCamera);
  float ndh = max(0.0, dot(n, h));
  float glint = pow(ndh, 240.0) * 1.85 + pow(ndh, 22.0) * 0.18;
  colour += uSunColor * glint * (0.38 + 0.62 * fresnel);

  // Whitecaps ride the swell crests in open water.
  float capNoise = fwFbm(vWorld.xz * 0.075 + vec2(t * 0.09, t * 0.05));
  float caps = smoothstep(0.54, 0.78, capNoise) * smoothstep(0.28, 1.0, crest) * mask;

  // Plunge pool: the falls boil the first tens of metres white, and long
  // foam streaks are driven outward from the rim.
  float churn = 1.0 - smoothstep(0.0, 38.0, vSea.x);
  float boil = fwFbm(vec2(vSea.y * 0.16 + t * 0.35, vSea.x * 0.42 - t * 2.4));
  float streak = fwNoise(vec2(vSea.y * 0.45, vSea.x * 0.08 - t * 0.85));
  float foamPlunge = churn * (0.5 + 0.5 * smoothstep(0.28, 0.72, boil)) + churn * churn * 0.4;
  float foamStreaks = (1.0 - smoothstep(4.0, 88.0, vSea.x)) * smoothstep(0.5, 0.88, streak) * 0.62;
  float foam = clamp(foamPlunge + foamStreaks + caps * 0.9, 0.0, 1.0);
  colour = mix(colour, uFoam, foam);

  // Far water darkens toward the fog so the sheet does not read as a painted
  // floor sitting under the horizon.
  colour = mix(colour, uDeep * 0.72, smoothstep(280.0, 780.0, vSea.x) * 0.55);

  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
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
      // Wound to face +Y so the front side is what the player sees.
      indices.push(a + ring, a + ring + 1, b + ring, b + ring, a + ring + 1, b + ring + 1);
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
  buildHorizonIsles(group, track, rim, sea, base);
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
      indices.push(a + ring, a + ring + 1, b + ring, b + ring, a + ring + 1, b + ring + 1);
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

function buildHorizonIsles(
  group: THREE.Group,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
  rim: readonly RimSample[],
  sea: number,
  base: number,
): void {
  const dummy = new THREE.Object3D();
  const count = 9;
  const mesh = new THREE.InstancedMesh(
    track(new THREE.ConeGeometry(1, 1, 7)),
    new THREE.MeshStandardMaterial({
      color: 0x2c3c38,
      roughness: 0.92,
      metalness: 0,
      fog: true,
    }),
    count,
  );
  mesh.name = 'beyond-horizon-isles';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  for (let index = 0; index < count; index += 1) {
    const sample = rim[Math.floor((index / count) * rim.length) % rim.length] as RimSample;
    const distance = 420 + hash2(index, 1, 0xe1) * 380;
    const breadth = 28 + hash2(index, 2, 0xe2) * 48;
    const peak = 18 + hash2(index, 3, 0xe3) * 36;
    dummy.position.set(
      sample.x + sample.outX * (base + distance),
      sea + peak * 0.42,
      sample.z + sample.outZ * (base + distance),
    );
    dummy.rotation.set(0, hash2(index, 4, 0xe4) * Math.PI * 2, 0);
    dummy.scale.set(breadth, peak, breadth * (0.7 + hash2(index, 5, 0xe5) * 0.5));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}
