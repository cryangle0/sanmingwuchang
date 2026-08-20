import { MAP_BOUNDARY } from '@jwgb/content';
import * as THREE from 'three';
import { regionBlendAt } from './map-regions';
import { ringContains } from './map-sampling';

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
/** 6 m grid ⇒ ~140×130 cells ⇒ ~36k triangles in one static draw call. */
const CELL_METERS = 4;
const GROUND_METERS_PER_TILE = 15;

export function buildGroundGeometry(): THREE.BufferGeometry {
  const bounds = boundaryBoundsMeters();
  const columns = Math.ceil((bounds.maxX - bounds.minX) / CELL_METERS);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL_METERS);

  const positions: number[] = [];
  const colours: number[] = [];
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
    positions.push(x, 0, z);
    uvs.push(x / GROUND_METERS_PER_TILE, z / GROUND_METERS_PER_TILE);
    const blend = regionBlendAt(x, z);
    primaryColour.setHex(blend.primary.ground);
    secondaryColour.setHex(blend.secondary.ground);
    vertexColour.copy(primaryColour).lerp(secondaryColour, blend.mix);
    // The real grass albedo supplies most of the local colour. Region tints
    // stay light enough to preserve that texture instead of multiplying the
    // entire district into one flat green or brown sheet.
    vertexColour.lerp(neutralLight, 0.66);
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
    const soilMix = smoothstep(0.5, 0.78, dryField) * 0.32;
    vertexColour.lerp(soilColour, soilMix);

    const alternateMix = 0.018 + broadField * 0.045 + patchField * 0.03;
    vertexColour.lerp(alternateColour, alternateMix);

    const lightMottle =
      0.985 + 0.026 * valueNoise(x / 74, z / 74, 313) + 0.012 * valueNoise(x / 12, z / 12, 941);
    vertexColour.multiplyScalar(lightMottle);
    colours.push(vertexColour.r, vertexColour.g, vertexColour.b);
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
    pushVertex(bounds.minX + column * CELL_METERS, bounds.minZ + row * CELL_METERS);
    vertexIndexByKey.set(key, index);
    return index;
  };

  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = bounds.minX + column * CELL_METERS;
      const z0 = bounds.minZ + row * CELL_METERS;
      if (!cellTouchesBoundary(x0, z0, x0 + CELL_METERS, z0 + CELL_METERS)) {
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
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
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
  return { minX, maxX, minZ, maxZ };
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
