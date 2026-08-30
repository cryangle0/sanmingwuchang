import { MAP_BOUNDARY, TERRAIN_LATTICE_MM, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { ringContains } from './map-sampling';
import { localBaseMeters } from './region-climate';

const MM = 1_000;
const CELL_METERS = TERRAIN_LATTICE_MM / MM;
const PONDING_DEPTH_METERS = 9;
const MIN_POND_CELLS = 200;
const POND_DEPTH_METERS = 2.2;
const DEEP_METERS = 2.2;
const FOAM_METERS = 0.42;
/**
 * Shoreline cells only.
 *
 * Contour fidelity and vertex budget pull against each other: subdividing
 * every flooded cell 8x8 costs 128 triangles per cell, which is what a pond
 * large enough to reach its true waterline cannot afford. Only the cells the
 * contour actually crosses need the detail, so those get refined and the
 * fully submerged interior stays two triangles.
 *
 * The T-junction this leaves where fine meets coarse is harmless here: the
 * surface of one pond is a single flat level, so the shared edge is collinear
 * and cannot crack. Only per-vertex depth shading changes across it, and the
 * shallow band that shading describes lives inside the refined cells anyway.
 */
const WATER_SUBDIVISIONS = 8;
const PARTIAL_CELL_MARGIN_METERS = 0.025;
/**
 * Hard ceiling on a single pond, in cells. The rim normally stops the water
 * long before this; the cap only guards against a hollow that drains toward
 * the map edge filling the playfield.
 */
const MAX_BASIN_CELLS = 260;
const WATER_SHALLOW = new THREE.Color(0x2f9ca2);
const WATER_DEEP = new THREE.Color(0x0d5974);
const WATER_FOAM = new THREE.Color(0x86cfc2);

interface WaterSolve {
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly columns: number;
  readonly rows: number;
  readonly flooded: ReadonlyMap<number, number>;
}

let cachedSolve: WaterSolve | null = null;

/**
 * Solves every basin once. Deterministic for a given compiled map, so the
 * result is memoised: the mesh builder and the dressing samplers both need it
 * and the watershed is the expensive part of this module.
 */
function solveWater(): WaterSolve {
  if (cachedSolve) {
    return cachedSolve;
  }
  const bounds = boundaryBoundsMeters();
  const columns = Math.max(0, Math.ceil((bounds.maxX - bounds.minX) / CELL_METERS));
  const rows = Math.max(0, Math.ceil((bounds.maxZ - bounds.minZ) / CELL_METERS));
  const cellCount = columns * rows;
  if (cellCount <= 0) {
    cachedSolve = { bounds, columns, rows, flooded: new Map() };
    return cachedSolve;
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
  const flooded =
    levels.size === 0
      ? new Map<number, number>()
      : expandToPartialCells(levels, bounds.minX, bounds.minZ, columns, rows);
  cachedSolve = { bounds, columns, rows, flooded };
  return cachedSolve;
}

/**
 * Water surface height at a point, or null on dry land.
 *
 * Ground dressing uses this so that covering the whole playfield with grass
 * does not sprout a meadow in the middle of a pond.
 */
export function waterSurfaceAt(xMeters: number, zMeters: number): number | null {
  const { bounds, columns, rows, flooded } = solveWater();
  if (flooded.size === 0) {
    return null;
  }
  const column = Math.floor((xMeters - bounds.minX) / CELL_METERS);
  const row = Math.floor((zMeters - bounds.minZ) / CELL_METERS);
  if (column < 0 || row < 0 || column >= columns || row >= rows) {
    return null;
  }
  const level = flooded.get(row * columns + column);
  if (level === undefined) {
    return null;
  }
  // A partial cell is only wet where the terrain actually sits below the
  // surface, so the shoreline stays a contour here too.
  return terrainHeightMeters(xMeters, zMeters) <= level + PARTIAL_CELL_MARGIN_METERS ? level : null;
}

export function buildWaterGeometry(): THREE.BufferGeometry | null {
  const { bounds, columns, flooded } = solveWater();
  if (flooded.size === 0) {
    return null;
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
    const waterLevel = level + PARTIAL_CELL_MARGIN_METERS;
    // A cell may stay coarse only if it is a true interior cell: the contour
    // must not cross it AND it must not sit on the outer edge of the flooded
    // set. Miss the second condition and the coarse cell's own 4 m boundary
    // edge becomes the shoreline, which is the grid staircase this whole pass
    // exists to remove.
    const corners = cellCornerHeights(x0, z0);
    const deepest = Math.max(...corners);
    const enclosed =
      flooded.has(cell - 1) &&
      flooded.has(cell + 1) &&
      flooded.has(cell - columns) &&
      flooded.has(cell + columns);
    if (deepest <= waterLevel && enclosed) {
      // Fully submerged interior: two triangles carry it and the clip has
      // nothing to remove.
      const first = terrainPoint(x0, z0);
      const second = terrainPoint(x0, z0 + CELL_METERS);
      const third = terrainPoint(x0 + CELL_METERS, z0 + CELL_METERS);
      const fourth = terrainPoint(x0 + CELL_METERS, z0);
      addClippedTriangle(first, second, third, waterLevel);
      addClippedTriangle(first, third, fourth, waterLevel);
      continue;
    }
    const subCell = CELL_METERS / WATER_SUBDIVISIONS;
    for (let subRow = 0; subRow < WATER_SUBDIVISIONS; subRow += 1) {
      for (let subColumn = 0; subColumn < WATER_SUBDIVISIONS; subColumn += 1) {
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
  if (previous && Math.abs(previous.x - point.x) < 1e-6 && Math.abs(previous.z - point.z) < 1e-6) {
    return;
  }
  points.push(point);
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
  // One ring only: the watershed already carried each pond to its waterline,
  // so this just admits the cells the contour crosses.
  const expanded = new Set<number>();
  for (const [cell, level] of levels) {
    flooded.set(cell, level);
    queue.push(cell);
  }
  let cursor = 0;
  for (; cursor < queue.length; ) {
    const cell = queue[cursor] as number;
    cursor += 1;
    const level = flooded.get(cell);
    if (level === undefined) {
      continue;
    }
    if (expanded.has(cell)) {
      continue;
    }
    expanded.add(cell);
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

/**
 * Raises water in each hollow until it hits the depth cap or spills.
 *
 * `submerged` marks deeply recessed cells and is used only to seed a pond.
 * From there the frontier is consumed lowest-cell-first, so the level at any
 * moment is the height of the highest cell admitted — exactly how a filling
 * hollow behaves. Reaching the map rim means the hollow drains off the
 * playfield, so that pond is abandoned rather than flooded to the cap.
 */
function floodBasins(
  submerged: Uint8Array,
  centreHeight: Float32Array,
  columns: number,
  rows: number,
): Map<number, number> {
  const levels = new Map<number, number>();
  const claimed = new Uint8Array(submerged.length);

  for (let start = 0; start < submerged.length; start += 1) {
    if (submerged[start] !== 1 || claimed[start] === 1) {
      continue;
    }

    const floor = centreHeight[start] as number;
    const ceiling = floor + POND_DEPTH_METERS;
    const frontier = new MinHeap();
    const visited = new Set<number>();
    const basin: number[] = [];
    let level = floor;
    let spilled = false;

    frontier.push(start, floor);
    visited.add(start);

    while (frontier.size > 0) {
      const cell = frontier.pop() as number;
      const height = centreHeight[cell] as number;
      if (height > ceiling) {
        // The rim is higher than the pond is allowed to be: it holds.
        break;
      }
      if (basin.length >= MAX_BASIN_CELLS) {
        break;
      }
      level = Math.max(level, height);
      basin.push(cell);

      const column = cell % columns;
      const row = (cell - column) / columns;
      if (column === 0 || row === 0 || column + 1 === columns || row + 1 === rows) {
        // Water reached the sampled area's edge, so this hollow drains away.
        spilled = true;
        break;
      }
      for (const neighbour of [cell - 1, cell + 1, cell - columns, cell + columns]) {
        if (neighbour < 0 || neighbour >= submerged.length || visited.has(neighbour)) {
          continue;
        }
        visited.add(neighbour);
        frontier.push(neighbour, centreHeight[neighbour] as number);
      }
    }

    for (const cell of basin) {
      claimed[cell] = 1;
    }
    if (spilled || basin.length < MIN_POND_CELLS) {
      continue;
    }
    const surface = quantizeMeters(level);
    for (const cell of basin) {
      levels.set(cell, surface);
    }
  }
  return levels;
}

/** Binary heap over (cell, height); the watershed needs the lowest cell next. */
class MinHeap {
  private readonly cells: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, key: number): void {
    this.cells.push(cell);
    this.keys.push(key);
    let index = this.cells.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if ((this.keys[parent] as number) <= (this.keys[index] as number)) {
        break;
      }
      this.swap(parent, index);
      index = parent;
    }
  }

  pop(): number | undefined {
    if (this.cells.length === 0) {
      return undefined;
    }
    const top = this.cells[0] as number;
    const lastCell = this.cells.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.cells.length > 0) {
      this.cells[0] = lastCell;
      this.keys[0] = lastKey;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (
          left < this.cells.length &&
          (this.keys[left] as number) < (this.keys[smallest] as number)
        ) {
          smallest = left;
        }
        if (
          right < this.cells.length &&
          (this.keys[right] as number) < (this.keys[smallest] as number)
        ) {
          smallest = right;
        }
        if (smallest === index) {
          break;
        }
        this.swap(smallest, index);
        index = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const cell = this.cells[a] as number;
    this.cells[a] = this.cells[b] as number;
    this.cells[b] = cell;
    const key = this.keys[a] as number;
    this.keys[a] = this.keys[b] as number;
    this.keys[b] = key;
  }
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
