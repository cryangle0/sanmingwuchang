import { MAP_BOUNDARY, TERRAIN_LATTICE_MM, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { ringContains } from './map-sampling';
import { localBaseMeters } from './region-climate';

const MM = 1_000;
const CELL_METERS = TERRAIN_LATTICE_MM / MM;
const PONDING_DEPTH_METERS = 4.5;
const MIN_POND_CELLS = 10;
const POND_DEPTH_METERS = 2.6;
const DEEP_METERS = 2.2;
const FOAM_METERS = 0.42;
const SHORE_SUBDIVISIONS = 8;
const PARTIAL_CELL_MARGIN_METERS = 0.025;
const PARTIAL_CELL_EXPANSION_STEPS = 1;
const WATER_SHALLOW = new THREE.Color(0x2f9ca2);
const WATER_DEEP = new THREE.Color(0x0d5974);
const WATER_FOAM = new THREE.Color(0x86cfc2);

export function buildWaterGeometry(): THREE.BufferGeometry | null {
  const bounds = boundaryBoundsMeters();
  const columns = Math.ceil((bounds.maxX - bounds.minX) / CELL_METERS);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL_METERS);
  const cellCount = columns * rows;
  if (cellCount <= 0) {
    return null;
  }

  const submerged = new Uint8Array(cellCount);
  const centreHeight = new Float32Array(cellCount);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = bounds.minX + column * CELL_METERS + CELL_METERS / 2;
      const z = bounds.minZ + row * CELL_METERS + CELL_METERS / 2;
      if (!ringContains(MAP_BOUNDARY, { x: x * MM, z: z * MM })) {
        continue;
      }
      const height = terrainHeightMeters(x, z);
      centreHeight[row * columns + column] = height;
      if (height < localBaseMeters(x, z) - PONDING_DEPTH_METERS) {
        submerged[row * columns + column] = 1;
      }
    }
  }

  const levels = floodBasins(submerged, centreHeight, columns, rows);
  if (levels.size === 0) {
    return null;
  }
  const flooded = expandToPartialCells(
    levels,
    bounds.minX,
    bounds.minZ,
    columns,
    rows,
  );
  const boundaryCells = new Set<number>();
  for (const [cell, level] of flooded) {
    if (
      isWaterBoundaryCell(
        cell,
        level,
        flooded,
        bounds.minX,
        bounds.minZ,
        columns,
        rows,
      )
    ) {
      boundaryCells.add(cell);
    }
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const waterDepths: number[] = [];
  const indices: number[] = [];
  const vertexCache = new Map<string, number>();
  const shade = new THREE.Color();

  const pushVertex = (x: number, z: number, level: number): number => {
    const quantizedX = quantizeMeters(x);
    const quantizedZ = quantizeMeters(z);
    const key = `${Math.round(level * MM)}:${Math.round(quantizedX * MM)}:${Math.round(quantizedZ * MM)}`;
    const cached = vertexCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const depth = level - terrainHeightMeters(quantizedX, quantizedZ);
    const clampedDepth = Math.max(0, depth);
    shade.copy(WATER_SHALLOW).lerp(WATER_DEEP, Math.min(1, clampedDepth / DEEP_METERS));
    if (depth >= 0 && clampedDepth < FOAM_METERS) {
      shade.lerp(WATER_FOAM, (1 - clampedDepth / FOAM_METERS) ** 2 * 0.42);
    }
    const vertexIndex = positions.length / 3;
    positions.push(quantizedX, level, quantizedZ);
    uvs.push(quantizedX / 18, quantizedZ / 18);
    colours.push(shade.r, shade.g, shade.b);
    waterDepths.push(depth);
    vertexCache.set(key, vertexIndex);
    return vertexIndex;
  };

  const addClippedTriangle = (
    first: WaterPoint,
    second: WaterPoint,
    third: WaterPoint,
    level: number,
  ): void => {
    const clipped = clipTriangleToWater(first, second, third, level);
    if (clipped.length < 3) {
      return;
    }
    const firstPoint = clipped[0];
    if (!firstPoint) {
      return;
    }
    const firstIndex = pushVertex(firstPoint.x, firstPoint.z, level);
    for (let index = 1; index + 1 < clipped.length; index += 1) {
      const secondPoint = clipped[index];
      const thirdPoint = clipped[index + 1];
      if (!secondPoint || !thirdPoint) {
        continue;
      }
      const secondIndex = pushVertex(secondPoint.x, secondPoint.z, level);
      const thirdIndex = pushVertex(thirdPoint.x, thirdPoint.z, level);
      indices.push(firstIndex, secondIndex, thirdIndex);
    }
  };

  for (const [cell, level] of flooded) {
    const column = cell % columns;
    const row = (cell - column) / columns;
    const x0 = bounds.minX + column * CELL_METERS;
    const z0 = bounds.minZ + row * CELL_METERS;
    const centreX = x0 + CELL_METERS / 2;
    const centreZ = z0 + CELL_METERS / 2;
    if (!ringContains(MAP_BOUNDARY, { x: centreX * MM, z: centreZ * MM })) {
      continue;
    }
    const x1 = x0 + CELL_METERS;
    const z1 = z0 + CELL_METERS;
    const waterLevel = level + PARTIAL_CELL_MARGIN_METERS;
    if (!isNearWaterBoundary(cell, level, flooded, boundaryCells, columns, rows)) {
      const first = terrainPoint(x0, z0);
      const second = terrainPoint(x0, z1);
      const third = terrainPoint(x1, z1);
      const fourth = terrainPoint(x1, z0);
      addClippedTriangle(first, second, third, waterLevel);
      addClippedTriangle(first, third, fourth, waterLevel);
      continue;
    }
    const subCell = CELL_METERS / SHORE_SUBDIVISIONS;
    for (let subRow = 0; subRow < SHORE_SUBDIVISIONS; subRow += 1) {
      for (let subColumn = 0; subColumn < SHORE_SUBDIVISIONS; subColumn += 1) {
        const subX0 = x0 + subColumn * subCell;
        const subZ0 = z0 + subRow * subCell;
        const subX1 = subX0 + subCell;
        const subZ1 = subZ0 + subCell;
        const first = terrainPoint(subX0, subZ0);
        const second = terrainPoint(subX0, subZ1);
        const third = terrainPoint(subX1, subZ1);
        const fourth = terrainPoint(subX1, subZ0);
        addClippedTriangle(first, second, third, waterLevel);
        addClippedTriangle(first, third, fourth, waterLevel);
      }
    }
  }

  if (positions.length === 0 || indices.length === 0) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(waterDepths, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

interface WaterPoint {
  x: number;
  z: number;
  height: number;
}

function terrainPoint(x: number, z: number): WaterPoint {
  const quantizedX = quantizeMeters(x);
  const quantizedZ = quantizeMeters(z);
  return {
    x: quantizedX,
    z: quantizedZ,
    height: terrainHeightMeters(quantizedX, quantizedZ),
  };
}

function clipTriangleToWater(
  first: WaterPoint,
  second: WaterPoint,
  third: WaterPoint,
  level: number,
): WaterPoint[] {
  const triangle = [first, second, third];
  const outline: WaterPoint[] = [];
  for (let index = 0; index < triangle.length; index += 1) {
    const current = triangle[index] as WaterPoint;
    const next = triangle[(index + 1) % triangle.length] as WaterPoint;
    const currentWet = current.height <= level;
    const nextWet = next.height <= level;
    if (currentWet) {
      pushDistinctPoint(outline, current);
    }
    if (currentWet !== nextWet) {
      const heightDelta = next.height - current.height;
      const interpolation =
        Math.abs(heightDelta) <= 1e-6 ? 0.5 : (level - current.height) / heightDelta;
      pushDistinctPoint(outline, {
        x: current.x + (next.x - current.x) * interpolation,
        z: current.z + (next.z - current.z) * interpolation,
        height: level,
      });
    }
  }
  if (outline.length < 3) {
    return [];
  }
  const firstPoint = outline[0];
  const secondPoint = outline[1];
  const thirdPoint = outline[2];
  return !firstPoint || !secondPoint || !thirdPoint
    ? []
    : Math.abs(
          (secondPoint.x - firstPoint.x) * (thirdPoint.z - firstPoint.z) -
            (secondPoint.z - firstPoint.z) * (thirdPoint.x - firstPoint.x),
        ) > 1e-6
      ? outline
      : [];
}

function pushDistinctPoint(points: WaterPoint[], point: WaterPoint): void {
  const previous = points[points.length - 1];
  if (
    previous &&
    Math.abs(previous.x - point.x) < 1e-6 &&
    Math.abs(previous.z - point.z) < 1e-6
  ) {
    return;
  }
  points.push(point);
}

function isNearWaterBoundary(
  cell: number,
  level: number,
  flooded: ReadonlyMap<number, number>,
  boundaryCells: ReadonlySet<number>,
  columns: number,
  rows: number,
): boolean {
  const column = cell % columns;
  const row = (cell - column) / columns;
  const neighbours = [
    column > 0 ? cell - 1 : -1,
    row + 1 < rows ? cell + columns : -1,
    column + 1 < columns ? cell + 1 : -1,
    row > 0 ? cell - columns : -1,
  ];
  return boundaryCells.has(cell)
    ? true
    : boundaryCells.has(cell) ||
        neighbours.some((neighbour) => {
          if (neighbour < 0) {
            return false;
          }
          const neighbourLevel = flooded.get(neighbour);
          return (
            neighbourLevel !== undefined &&
            Math.abs(neighbourLevel - level) <= 1e-6 &&
            boundaryCells.has(neighbour)
          );
        });
}

function isWaterBoundaryCell(
  cell: number,
  level: number,
  flooded: ReadonlyMap<number, number>,
  minX: number,
  minZ: number,
  columns: number,
  rows: number,
): boolean {
  if (
    waterlineCrossesCell(
      cell,
      level + PARTIAL_CELL_MARGIN_METERS,
      minX,
      minZ,
      columns,
    )
  ) {
    return true;
  }
  const column = cell % columns;
  return cellNeighbours(cell, column, (cell - column) / columns, columns, rows).some(
    (neighbour) => {
      if (neighbour < 0) {
        return true;
      }
      const neighbourLevel = flooded.get(neighbour);
      return neighbourLevel === undefined || Math.abs(neighbourLevel - level) > 1e-6;
    },
  );
}

function expandToPartialCells(
  levels: ReadonlyMap<number, number>,
  minX: number,
  minZ: number,
  columns: number,
  rows: number,
): Map<number, number> {
  const flooded = new Map<number, number>();
  const queue: number[] = [];
  const distance = new Map<number, number>();
  for (const [cell, level] of levels) {
    flooded.set(cell, level);
    queue.push(cell);
    distance.set(cell, 0);
  }
  let cursor = 0;
  for (; cursor < queue.length; ) {
    const cell = queue[cursor] as number;
    cursor += 1;
    const level = flooded.get(cell);
    if (level === undefined) {
      continue;
    }
    const depth = distance.get(cell) ?? PARTIAL_CELL_EXPANSION_STEPS;
    if (depth >= PARTIAL_CELL_EXPANSION_STEPS) {
      continue;
    }
    const column = cell % columns;
    const row = (cell - column) / columns;
    for (const neighbour of cellNeighbours(cell, column, row, columns, rows)) {
      if (neighbour < 0 || flooded.has(neighbour)) {
        continue;
      }
      const originalLevel = levels.get(neighbour);
      if (originalLevel !== undefined && Math.abs(originalLevel - level) > 1e-6) {
        continue;
      }
      if (canExpandIntoCell(neighbour, level, minX, minZ, columns)) {
        flooded.set(neighbour, level);
        queue.push(neighbour);
        distance.set(neighbour, depth + 1);
      }
    }
  }
  return flooded;
}

function canExpandIntoCell(
  cell: number,
  level: number,
  minX: number,
  minZ: number,
  columns: number,
): boolean {
  const column = cell % columns;
  const row = (cell - column) / columns;
  const x = minX + column * CELL_METERS;
  const z = minZ + row * CELL_METERS;
  const centreX = x + CELL_METERS / 2;
  const centreZ = z + CELL_METERS / 2;
  return ringContains(MAP_BOUNDARY, { x: centreX * MM, z: centreZ * MM })
    ? cellCornerHeights(x, z).some((height) => height <= level)
    : false;
}

function waterlineCrossesCell(
  cell: number,
  level: number,
  minX: number,
  minZ: number,
  columns: number,
): boolean {
  const column = cell % columns;
  const row = (cell - column) / columns;
  const heights = cellCornerHeights(
    minX + column * CELL_METERS,
    minZ + row * CELL_METERS,
  );
  const minimum = Math.min(...heights);
  const maximum = Math.max(...heights);
  return minimum <= level && maximum > level;
}

function cellCornerHeights(x: number, z: number): number[] {
  const rightX = x + CELL_METERS;
  const bottomZ = z + CELL_METERS;
  return [
    terrainHeightMeters(x, z),
    terrainHeightMeters(x, bottomZ),
    terrainHeightMeters(rightX, bottomZ),
    terrainHeightMeters(rightX, z),
  ];
}

function cellNeighbours(
  cell: number,
  column: number,
  row: number,
  columns: number,
  rows: number,
): number[] {
  return [
    column > 0 ? cell - 1 : -1,
    row + 1 < rows ? cell + columns : -1,
    column + 1 < columns ? cell + 1 : -1,
    row > 0 ? cell - columns : -1,
  ];
}

function floodBasins(
  submerged: Uint8Array,
  centreHeight: Float32Array,
  columns: number,
  rows: number,
): Map<number, number> {
  const levels = new Map<number, number>();
  const seen = new Uint8Array(submerged.length);
  const stack: number[] = [];
  for (let start = 0; start < submerged.length; start += 1) {
    if (submerged[start] !== 1 || seen[start] === 1) {
      continue;
    }
    const basin: number[] = [];
    let lowest = Number.POSITIVE_INFINITY;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      basin.push(current);
      lowest = Math.min(lowest, centreHeight[current] as number);
      const column = current % columns;
      const row = (current - column) / columns;
      const neighbours = [
        column > 0 ? current - 1 : -1,
        column + 1 < columns ? current + 1 : -1,
        row > 0 ? current - columns : -1,
        row + 1 < rows ? current + columns : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour >= 0 && submerged[neighbour] === 1 && seen[neighbour] === 0) {
          seen[neighbour] = 1;
          stack.push(neighbour);
        }
      }
    }
    if (basin.length < MIN_POND_CELLS) {
      continue;
    }
    const level = lowest + POND_DEPTH_METERS;
    for (const cell of basin) {
      levels.set(cell, level);
    }
  }
  return levels;
}

function quantizeMeters(value: number): number {
  return Math.round(value * MM) / MM;
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
    const x = point.x / MM;
    const z = point.z / MM;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const cell = TERRAIN_LATTICE_MM / MM;
  return {
    minX: Math.floor(minX / cell) * cell,
    maxX,
    minZ: Math.floor(minZ / cell) * cell,
    maxZ,
  };
}
