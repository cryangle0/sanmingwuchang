import { MAP_BOUNDARY, TERRAIN_LATTICE_MM, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import { ringContains } from './map-sampling';
import { localBaseMeters } from './region-climate';

const MM = 1_000;
/**
 * Cell size and origin both track the authoritative height lattice. Off-grid
 * cells straddle two lattice triangles, so the waterline interpolated along a
 * cell edge no longer lands on the ground it was solved against.
 */
const CELL_METERS = TERRAIN_LATTICE_MM / MM;
/**
 * How far below the surrounding landform a hollow has to sit before it holds
 * water.
 *
 * Chosen above the deepest den floor (4.0 m) and below the 龙宫 basin floor
 * (5.0 m), so the dragon courts fill and become the water courts they are
 * meant to be while monster dens stay dry ground.
 */
const PONDING_DEPTH_METERS = 4.5;
/** Ponds smaller than this are speckle, not water. */
const MIN_POND_CELLS = 10;
/**
 * Depth of a pond, measured up from the lowest ground in its basin.
 *
 * Filling to the basin's highest point instead let one long valley count as a
 * single component and drown its whole length up to the shallowest end.
 */
const POND_DEPTH_METERS = 2.6;
/** Depth at which the surface reaches its deepest colour. */
const DEEP_METERS = 2.2;
/** Band along the shore that carries foam. */
const FOAM_METERS = 0.9;

/**
 * Water has to separate from the ground it sits in, and most of this map's
 * ground is warm earth. An ink-dark pond is the right idea on paper and
 * unreadable in practice: at 0x123a3f the surface resolved to a slightly
 * darker patch of dirt, indistinguishable from shadow at a 32 degree camera
 * pitch. These read as water because they are cool, bright and saturated
 * against everything around them.
 */
const WATER_SHALLOW = new THREE.Color(0x7fd8c6);
const WATER_DEEP = new THREE.Color(0x1c7f8c);
const WATER_FOAM = new THREE.Color(0xecf7f2);

/**
 * Standing water, one surface per basin.
 *
 * A single global water plane worked only while the whole map lived inside a
 * 5 m band. Once the terrain carried 30 m of relief, "below -0.55 m" stopped
 * meaning "in a hollow" and started meaning "over half the map", and the
 * playfield rendered as an ocean with ridge tops sticking out of it.
 *
 * Water is now found rather than assumed: cells that sit well below their
 * surrounding landform are grouped into connected basins, and each basin gets
 * one level of its own, just above the highest ground it covers. That keeps
 * every pond flat — a surface that tracked the landform would visibly run
 * downhill — and leaves dry ground dry no matter what elevation it sits at.
 */
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

  const levelOf = floodBasins(submerged, centreHeight, columns, rows);
  if (levelOf.size === 0) {
    return null;
  }

  // Cells that only partly drown still carry water; without them the sheet
  // would stop at the last fully submerged cell and leave a shoreline made of
  // grid steps rather than of ground contour.
  const flooded = expandToPartialCells(levelOf, columns, rows);

  const positions: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const shade = new THREE.Color();
  // Depth drives the colour so a pond reads as water rather than as a dark
  // sheet: shallows stay bright and green, the middle goes deep blue-green,
  // and the last half metre against the bank carries foam. Without that
  // gradient a flat teal plane at a grazing angle is indistinguishable from a
  // shadowed slope.
  const pushVertex = (x: number, z: number, level: number): void => {
    positions.push(x, level, z);
    uvs.push(x / 18, z / 18);
    const depth = Math.max(0, level - terrainHeightMeters(x, z));
    shade.copy(WATER_SHALLOW).lerp(WATER_DEEP, Math.min(1, depth / DEEP_METERS));
    if (depth < FOAM_METERS) {
      shade.lerp(WATER_FOAM, (1 - depth / FOAM_METERS) ** 2 * 0.7);
    }
    colours.push(shade.r, shade.g, shade.b);
  };

  for (const [cell, level] of flooded) {
    const column = cell % columns;
    const row = (cell - column) / columns;
    const x0 = bounds.minX + column * CELL_METERS;
    const z0 = bounds.minZ + row * CELL_METERS;
    const x1 = x0 + CELL_METERS;
    const z1 = z0 + CELL_METERS;
    // Marching squares against the ground: the sheet is clipped to the exact
    // line where terrain crosses the water level, so the shore follows the
    // hillside instead of the sampling grid.
    // Wound +z before +x. The other way round is the intuitive reading order
    // and gives every triangle a downward normal, which leaves the whole sheet
    // back-facing and invisible from any camera above it.
    const corners = [
      { x: x0, z: z0, h: terrainHeightMeters(x0, z0) },
      { x: x0, z: z1, h: terrainHeightMeters(x0, z1) },
      { x: x1, z: z1, h: terrainHeightMeters(x1, z1) },
      { x: x1, z: z0, h: terrainHeightMeters(x1, z0) },
    ];
    const outline: { x: number; z: number }[] = [];
    for (let index = 0; index < 4; index += 1) {
      const a = corners[index] as { x: number; z: number; h: number };
      const b = corners[(index + 1) % 4] as { x: number; z: number; h: number };
      const aWet = a.h <= level;
      const bWet = b.h <= level;
      if (aWet) {
        outline.push({ x: a.x, z: a.z });
      }
      if (aWet !== bWet) {
        const t = (level - a.h) / (b.h - a.h);
        outline.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    if (outline.length < 3) {
      continue;
    }
    const first = outline[0] as { x: number; z: number };
    for (let index = 1; index + 1 < outline.length; index += 1) {
      const second = outline[index] as { x: number; z: number };
      const third = outline[index + 1] as { x: number; z: number };
      for (const point of [first, second, third]) {
        pushVertex(point.x, point.z, level);
      }
    }
  }

  if (positions.length === 0) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Group submerged cells into basins and give each one a flat level.
 *
 * Returns the level per cell index; cells in basins too small to be water are
 * left out of the map entirely.
 */
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
    let highest = Number.NEGATIVE_INFINITY;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      basin.push(current);
      const height = centreHeight[current] as number;
      lowest = Math.min(lowest, height);
      highest = Math.max(highest, height);
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
    // Depth is measured up from the basin floor and deliberately not capped
    // against its shallowest submerged cell. That cap was meant to stop a
    // valley filling to the brim, but the shallowest cell sits by definition
    // just under the ponding threshold, so it pinned every level a few
    // centimetres over the shallows and turned each pond into a film of water
    // half a metre wide. The shoreline is already clipped to the contour, so
    // nothing escapes the hollow without it.
    void highest;
    const level = lowest + POND_DEPTH_METERS;
    for (const cell of basin) {
      levels.set(cell, level);
    }
  }
  return levels;
}

/**
 * Widen each basin by one ring of cells so the marching-squares pass has the
 * partly drowned cells it needs to draw a real shoreline.
 */
function expandToPartialCells(
  levels: ReadonlyMap<number, number>,
  columns: number,
  rows: number,
): Map<number, number> {
  const flooded = new Map(levels);
  for (const [cell, level] of levels) {
    const column = cell % columns;
    const row = (cell - column) / columns;
    const neighbours = [
      column > 0 ? cell - 1 : -1,
      column + 1 < columns ? cell + 1 : -1,
      row > 0 ? cell - columns : -1,
      row + 1 < rows ? cell + columns : -1,
    ];
    for (const neighbour of neighbours) {
      if (neighbour >= 0 && !flooded.has(neighbour)) {
        flooded.set(neighbour, level);
      }
    }
  }
  return flooded;
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
