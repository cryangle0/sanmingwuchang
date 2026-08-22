import {
  MAP_BOUNDARY,
  MAP_COURTS,
  MAP_SPAWN_POINTS,
  TERRAIN_LATTICE_MM,
  TERRAIN_WATER_LEVEL_MM,
  terrainHeightMeters,
} from '@jwgb/content';
import * as THREE from 'three';
import { regionBlendAt } from './map-regions';
import { convexContains, isOnRoad, ringContains } from './map-sampling';
import { climateSplatAt } from './region-climate';
import { MAX_ROAD_SURFACE_Y } from './roads';

/**
 * The walkable ground plane, built as a regular grid so district palettes can
 * be painted per vertex — the single boundary-polygon cap has only 21 vertices
 * and cannot hold a colour gradient.
 *
 * Grid cells keep any corner inside the boundary polygon, so coverage reaches
 * the boundary cliffs with slight overhang that the cliffs themselves hide.
 * A deterministic value-noise mottle is baked into the vertex colours, which
 * is what makes the 840 m plain read as terrain instead of a billiard table.
 */

const MM = 1_000;
/**
 * Ground cell size. Derived from the authoritative height lattice rather than
 * chosen here: the sim defines walkable height as this mesh's own triangle
 * interpolation, so the two spacings cannot be allowed to drift apart.
 * ~210x195 cells => ~80k triangles in one static draw call.
 */
export const GROUND_CELL_METERS = TERRAIN_LATTICE_MM / MM;
/** Sit characters on the rendered triangles, not under bilinear ramps. */
export const GROUND_FOOTING_BIAS_METERS = 0.05;
const GROUND_METERS_PER_TILE = 15;

export function buildGroundGeometry(): THREE.BufferGeometry {
  const bounds = boundaryBoundsMeters();
  const columns = Math.ceil((bounds.maxX - bounds.minX) / GROUND_CELL_METERS);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / GROUND_CELL_METERS);

  const positions: number[] = [];
  const colours: number[] = [];
  const climates: number[] = [];
  const uvs: number[] = [];

  const vertexColour = new THREE.Color();
  const primaryColour = new THREE.Color();
  const secondaryColour = new THREE.Color();
  const primaryAltColour = new THREE.Color();
  const secondaryAltColour = new THREE.Color();
  const alternateColour = new THREE.Color();
  const primarySoilColour = new THREE.Color();
  const secondarySoilColour = new THREE.Color();
  const soilColour = new THREE.Color();
  const neutralLight = new THREE.Color(0xeee9d7);

  const pushVertex = (x: number, z: number): void => {
    const height = terrainHeightMeters(x, z);
    positions.push(x, height, z);
    uvs.push(x / GROUND_METERS_PER_TILE, z / GROUND_METERS_PER_TILE);
    const blend = regionBlendAt(x, z);
    primaryColour.setHex(blend.primary.ground);
    secondaryColour.setHex(blend.secondary.ground);
    vertexColour.copy(primaryColour).lerp(secondaryColour, blend.mix);
    // The real grass albedo supplies most of the local colour. Region tints
    // stay light enough to preserve that texture instead of multiplying the
    // entire district into one flat green or brown sheet.
    vertexColour.lerp(neutralLight, 0.38);
    primaryAltColour.setHex(blend.primary.groundAlt);
    secondaryAltColour.setHex(blend.secondary.groundAlt);
    alternateColour.copy(primaryAltColour).lerp(secondaryAltColour, blend.mix);
    alternateColour.lerp(neutralLight, 0.54);
    primarySoilColour.setHex(blend.primary.soil);
    secondarySoilColour.setHex(blend.secondary.soil);
    soilColour.copy(primarySoilColour).lerp(secondarySoilColour, blend.mix);
    soilColour.lerp(neutralLight, 0.38);

    // Match the reference terrain's broad dry/lush breakup. Two unrelated
    // noise scales make exposed earth form irregular fields rather than
    // repeated circular stains.
    const broadField = valueNoise(x / 110, z / 110, 101);
    const patchField = valueNoise(x / 34, z / 34, 707);
    const fineField = valueNoise(x / 13, z / 13, 1_391);
    const dryField = broadField * 0.54 + patchField * 0.34 + fineField * 0.12;
    const climate = climateSplatAt(x, z, height);
    const soilMix = smoothstep(0.5, 0.78, dryField) * (0.22 + climate.soil * 0.5);
    vertexColour.lerp(soilColour, soilMix);

    const alternateMix = 0.018 + broadField * 0.045 + patchField * 0.03;
    vertexColour.lerp(alternateColour, alternateMix);

    const lightMottle =
      0.985 + 0.026 * valueNoise(x / 74, z / 74, 313) + 0.012 * valueNoise(x / 12, z / 12, 941);
    vertexColour.multiplyScalar(lightMottle);
    const slope =
      Math.hypot(
        terrainHeightMeters(x + 2.5, z) - terrainHeightMeters(x - 2.5, z),
        terrainHeightMeters(x, z + 2.5) - terrainHeightMeters(x, z - 2.5),
      ) / 5;
    vertexColour.lerp(new THREE.Color(0x5a5346), Math.min(0.42, slope * 1.15));
    if (height > 2.4) {
      vertexColour.lerp(new THREE.Color(0x8a8678), Math.min(1, (height - 2.4) / 2.6));
    } else if (height < TERRAIN_WATER_LEVEL_MM / MM + 0.45) {
      vertexColour.lerp(new THREE.Color(0x3d5346), 0.28);
    }
    if (climate.wet > 0.02) {
      vertexColour.lerp(new THREE.Color(0x3a4a40), climate.wet * 0.34);
      vertexColour.multiplyScalar(1 - climate.wet * 0.16);
    }
    if (climate.frost > 0.02) {
      vertexColour.lerp(new THREE.Color(0xd5e0e6), climate.frost * 0.48);
    }
    colours.push(vertexColour.r, vertexColour.g, vertexColour.b);
    climates.push(climate.soil, climate.wet, climate.frost);
  };

  // Indexed grid: shared vertices give smooth colour gradients across cells.
  const vertexIndexByKey = new Map<number, number>();
  const vertexAt = (column: number, row: number): number => {
    const key = row * (columns + 1) + column;
    const existing = vertexIndexByKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const index = positions.length / 3;
    pushVertex(bounds.minX + column * GROUND_CELL_METERS, bounds.minZ + row * GROUND_CELL_METERS);
    vertexIndexByKey.set(key, index);
    return index;
  };

  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = bounds.minX + column * GROUND_CELL_METERS;
      const z0 = bounds.minZ + row * GROUND_CELL_METERS;
      if (!cellTouchesBoundary(x0, z0, x0 + GROUND_CELL_METERS, z0 + GROUND_CELL_METERS)) {
        continue;
      }
      const a = vertexAt(column, row);
      const b = vertexAt(column, row + 1);
      const c = vertexAt(column + 1, row + 1);
      const d = vertexAt(column + 1, row);
      // Wound to face +Y in three.js space.
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('climate', new THREE.Float32BufferAttribute(climates, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Height of the rendered ground triangles at (x, z).
 *
 * terrainHeightMeters is itself defined as the triangle interpolation of the
 * TERRAIN_LATTICE_MM grid this mesh is built on, so the mesh surface and the
 * authoritative height are the same number; the bias is the only separation,
 * and it exists to keep feet visibly on the triangles rather than coplanar
 * with them.
 */
export function groundSurfaceMeters(xMeters: number, zMeters: number): number {
  return terrainHeightMeters(xMeters, zMeters) + GROUND_FOOTING_BIAS_METERS;
}

const ROAD_FOOTING_LIFT_METERS = MAX_ROAD_SURFACE_Y + 0.05;
const COURT_FOOTING_LIFT_METERS = 0.08;
const SPAWN_PAD_RADIUS_METERS = 1.7;
const SPAWN_FOOTING_LIFT_METERS = 0.08;

/**
 * Visual walk height: ground triangles plus any overlay (road, court, spawn
 * pad) that would otherwise clip through the character's feet.
 */
export function walkSurfaceMeters(xMeters: number, zMeters: number): number {
  const point = { x: Math.round(xMeters * MM), z: Math.round(zMeters * MM) };
  let lift = 0;
  if (isOnRoad(point, 900)) {
    lift = Math.max(lift, ROAD_FOOTING_LIFT_METERS);
  }
  for (const court of MAP_COURTS) {
    if (convexContains(court.hexVertices, point)) {
      lift = Math.max(lift, COURT_FOOTING_LIFT_METERS);
      break;
    }
  }
  for (const spawn of MAP_SPAWN_POINTS) {
    const dx = xMeters - spawn.position.x / MM;
    const dz = zMeters - spawn.position.z / MM;
    if (dx * dx + dz * dz <= SPAWN_PAD_RADIUS_METERS * SPAWN_PAD_RADIUS_METERS) {
      lift = Math.max(lift, SPAWN_FOOTING_LIFT_METERS);
      break;
    }
  }
  const surface = groundSurfaceMeters(xMeters, zMeters) + lift;
  if (terrainHeightMeters(xMeters, zMeters) < TERRAIN_WATER_LEVEL_MM / MM) {
    return Math.max(surface, TERRAIN_WATER_LEVEL_MM / MM + 0.02);
  }
  return surface;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function cellTouchesBoundary(x0: number, z0: number, x1: number, z1: number): boolean {
  return (
    ringContains(MAP_BOUNDARY, { x: x0 * MM, z: z0 * MM }) ||
    ringContains(MAP_BOUNDARY, { x: x1 * MM, z: z0 * MM }) ||
    ringContains(MAP_BOUNDARY, { x: x0 * MM, z: z1 * MM }) ||
    ringContains(MAP_BOUNDARY, { x: x1 * MM, z: z1 * MM })
  );
}

function boundaryBoundsMeters(): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of MAP_BOUNDARY) {
    minX = Math.min(minX, point.x / MM);
    maxX = Math.max(maxX, point.x / MM);
    minZ = Math.min(minZ, point.z / MM);
    maxZ = Math.max(maxZ, point.z / MM);
  }
  // Snap the origin onto the authoritative height lattice. An unaligned grid
  // would sample between lattice points and put the drawn surface back out of
  // step with terrainHeightMeters.
  const cell = TERRAIN_LATTICE_MM / MM;
  return {
    minX: Math.floor(minX / cell) * cell,
    maxX,
    minZ: Math.floor(minZ / cell) * cell,
    maxZ,
  };
}

/** Deterministic 2D value noise in [0, 1] with bilinear smoothing. */
function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function hash2(x: number, z: number, seed: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0xffffffff;
}
