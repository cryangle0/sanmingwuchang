import { MAP_SPAWN_POINTS, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';
import { isOpenGround } from './map-sampling';

/**
 * A still pool beside every hero spawn, so each 降生地 sits on a waterline.
 *
 * Spawn coordinates are authoritative (they feed the map geometry hash), so
 * the water comes to them instead: a flat stone-rimmed pool is laid on the
 * spawn pad a few metres ahead of the spawn facing, on the first side where
 * it fits inside the boundary and off the roads. Render-only; nothing here
 * is walkable state.
 */

const MM = 1_000;
export const SPAWN_POND_RADIUS_METERS = 4.6;
const SPAWN_POND_OFFSET_METERS = 7.4;
const SPAWN_POND_FALLBACK_RADIUS_METERS = 3.1;
const SPAWN_POND_MIN_RADIUS_METERS = 2.2;
const POND_DEPTH_METERS = 2.2;
const RIM_STONES = 18;
const POND_DEEP = new THREE.Color(0x0f5468);
const POND_SHALLOW = new THREE.Color(0x3b9aa0);
const POND_FOAM = new THREE.Color(0x8fd0c8);

export interface SpawnPond {
  readonly spawnId: string;
  readonly xMeters: number;
  readonly zMeters: number;
  readonly radiusMeters: number;
  readonly surfaceMeters: number;
}

let cachedPonds: readonly SpawnPond[] | null = null;

function pondFits(
  xMeters: number,
  zMeters: number,
  radiusMeters: number,
  roadVergeMm: number,
): boolean {
  const probes = 8;
  for (let index = 0; index <= probes; index += 1) {
    const angle = (index / probes) * Math.PI * 2;
    const reach = index === probes ? 0 : radiusMeters + 1.2;
    const point: MapPointMm = {
      x: Math.round((xMeters + Math.cos(angle) * reach) * MM),
      z: Math.round((zMeters + Math.sin(angle) * reach) * MM),
    };
    if (!isOpenGround(point, { roadVergeMm, landmarkClearanceScale: 0 })) {
      return false;
    }
  }
  return true;
}

export function spawnPonds(): readonly SpawnPond[] {
  if (cachedPonds) {
    return cachedPonds;
  }
  const ponds: SpawnPond[] = [];
  for (const spawn of MAP_SPAWN_POINTS) {
    const sx = spawn.position.x / MM;
    const sz = spawn.position.z / MM;
    const fx = spawn.facing.x / 1_000;
    const fz = spawn.facing.z / 1_000;
    // Ahead first, then either side, then behind.
    const directions: [number, number][] = [];
    for (let step = 0; step < 16; step += 1) {
      // Facing first, then sweep both sides in ever-wider arcs.
      const angle = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * (Math.PI / 8);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      directions.push([fx * cos - fz * sin, fx * sin + fz * cos]);
    }
    let placed: SpawnPond | null = null;
    // Spawns that sit on a road or hug the rim get a small roadside basin:
    // the road test is dropped last, never the boundary or wall tests.
    const attempts: readonly [number, number][] = [
      [SPAWN_POND_RADIUS_METERS, 600],
      [SPAWN_POND_FALLBACK_RADIUS_METERS, 600],
      [SPAWN_POND_MIN_RADIUS_METERS, 600],
      [SPAWN_POND_MIN_RADIUS_METERS, -1],
    ];
    for (const [radius, roadVergeMm] of attempts) {
      for (const [dx, dz] of directions) {
        const offset = SPAWN_POND_OFFSET_METERS - (SPAWN_POND_RADIUS_METERS - radius) * 0.6;
        const x = sx + dx * offset;
        const z = sz + dz * offset;
        if (!pondFits(x, z, radius, roadVergeMm)) {
          continue;
        }
        placed = {
          spawnId: spawn.id,
          xMeters: x,
          zMeters: z,
          radiusMeters: radius,
          surfaceMeters: terrainHeightMeters(x, z) + 0.04,
        };
        break;
      }
      if (placed) {
        break;
      }
    }
    if (placed) {
      ponds.push(placed);
    }
  }
  cachedPonds = ponds;
  return ponds;
}

/** True when the point lies inside a spawn pool (plus its stone rim). */
export function isInSpawnPond(point: MapPointMm): boolean {
  const x = point.x / MM;
  const z = point.z / MM;
  for (const pond of spawnPonds()) {
    const dx = x - pond.xMeters;
    const dz = z - pond.zMeters;
    const reach = pond.radiusMeters + 0.9;
    if (dx * dx + dz * dz <= reach * reach) {
      return true;
    }
  }
  return false;
}

export function buildSpawnPonds(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): void {
  const ponds = spawnPonds();
  if (ponds.length === 0) {
    return;
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const depths: number[] = [];
  const indices: number[] = [];
  const rings = 3;
  const segments = 28;
  const shade = new THREE.Color();
  for (const pond of ponds) {
    const centre = positions.length / 3;
    positions.push(pond.xMeters, pond.surfaceMeters, pond.zMeters);
    uvs.push(pond.xMeters / 18, pond.zMeters / 18);
    colours.push(POND_DEEP.r, POND_DEEP.g, POND_DEEP.b);
    depths.push(POND_DEPTH_METERS);
    for (let ring = 1; ring <= rings; ring += 1) {
      const t = ring / rings;
      const radius = pond.radiusMeters * t;
      const depth = POND_DEPTH_METERS * (1 - t * t);
      shade.copy(POND_DEEP).lerp(POND_SHALLOW, t * t);
      if (ring === rings) {
        shade.lerp(POND_FOAM, 0.55);
      }
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        const wobble = 1 + Math.sin(angle * 3 + pond.xMeters) * 0.06;
        const x = pond.xMeters + Math.cos(angle) * radius * wobble;
        const z = pond.zMeters + Math.sin(angle) * radius * wobble;
        positions.push(x, pond.surfaceMeters, z);
        uvs.push(x / 18, z / 18);
        colours.push(shade.r, shade.g, shade.b);
        depths.push(depth);
      }
    }
    const ringStart = (ring: number): number => centre + 1 + (ring - 1) * segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(centre, ringStart(1) + next, ringStart(1) + segment);
    }
    for (let ring = 1; ring < rings; ring += 1) {
      const inner = ringStart(ring);
      const outer = ringStart(ring + 1);
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        indices.push(inner + segment, outer + next, outer + segment);
        indices.push(inner + segment, inner + next, outer + next);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const water = new THREE.Mesh(track(geometry), materials.valleyWater);
  water.name = 'map-spawn-ponds';
  water.receiveShadow = false;
  water.renderOrder = 3;
  group.add(water);

  // Stone rim: hides the waterline against uneven ground and reads as a
  // built pool rather than a puddle.
  const stone = track(new THREE.DodecahedronGeometry(0.42, 0));
  const stones = new THREE.InstancedMesh(stone, materials.rock, ponds.length * RIM_STONES);
  stones.name = 'map-spawn-pond-rim';
  stones.castShadow = true;
  stones.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  let instance = 0;
  for (const pond of ponds) {
    for (let index = 0; index < RIM_STONES; index += 1) {
      const angle =
        (index / RIM_STONES) * Math.PI * 2 + Math.sin(index * 7.1 + pond.zMeters) * 0.12;
      const wobble = 1 + Math.sin(angle * 3 + pond.xMeters) * 0.06;
      const reach = pond.radiusMeters * wobble + 0.32;
      const x = pond.xMeters + Math.cos(angle) * reach;
      const z = pond.zMeters + Math.sin(angle) * reach;
      const size = 0.7 + ((index * 37 + Math.round(pond.xMeters)) % 7) * 0.09;
      euler.set(index * 0.7, angle, index * 1.3);
      quaternion.setFromEuler(euler);
      scale.set(size * 1.25, size * 0.8, size);
      position.set(x, Math.max(terrainHeightMeters(x, z), pond.surfaceMeters) + 0.08, z);
      matrix.compose(position, quaternion, scale);
      stones.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }
  stones.count = instance;
  stones.instanceMatrix.needsUpdate = true;
  group.add(stones);
}
