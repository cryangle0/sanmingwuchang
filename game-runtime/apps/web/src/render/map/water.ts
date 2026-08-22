import { MAP_BOUNDARY, TERRAIN_WATER_LEVEL_MM, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { ringContains } from './map-sampling';

const MM = 1_000;
const CELL_METERS = 6;
const WATER_Y = TERRAIN_WATER_LEVEL_MM / MM;

/**
 * Valley ponds. A cell is water only when every corner sits under the water
 * plane, so sloped grass never gets a cyan 8 m sticker punched through it.
 */
export function buildWaterGeometry(): THREE.BufferGeometry | null {
  const bounds = boundaryBoundsMeters();
  const columns = Math.ceil((bounds.maxX - bounds.minX) / CELL_METERS);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL_METERS);
  const positions: number[] = [];
  const uvs: number[] = [];

  const push = (x: number, z: number): void => {
    positions.push(x, WATER_Y, z);
    uvs.push(x / 18, z / 18);
  };

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = bounds.minX + column * CELL_METERS;
      const z0 = bounds.minZ + row * CELL_METERS;
      const x1 = x0 + CELL_METERS;
      const z1 = z0 + CELL_METERS;
      if (!cellTouchesBoundary(x0, z0, x1, z1)) {
        continue;
      }
      const heights = [
        terrainHeightMeters(x0, z0),
        terrainHeightMeters(x1, z0),
        terrainHeightMeters(x1, z1),
        terrainHeightMeters(x0, z1),
      ];
      if (heights.some((height) => height > WATER_Y - 0.04)) {
        continue;
      }
      push(x0, z0);
      push(x0, z1);
      push(x1, z1);
      push(x0, z0);
      push(x1, z1);
      push(x1, z0);
    }
  }

  if (positions.length === 0) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function boundaryBoundsMeters(): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of MAP_BOUNDARY) {
    const x = point.x / MM;
    const z = point.z / MM;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

function cellTouchesBoundary(minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  return (
    ringContains(MAP_BOUNDARY, { x: minX * MM, z: minZ * MM }) ||
    ringContains(MAP_BOUNDARY, { x: maxX * MM, z: minZ * MM }) ||
    ringContains(MAP_BOUNDARY, { x: maxX * MM, z: maxZ * MM }) ||
    ringContains(MAP_BOUNDARY, { x: minX * MM, z: maxZ * MM })
  );
}
