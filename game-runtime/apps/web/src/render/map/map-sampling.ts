import {
  AUTHORITATIVE_MAP_SHOPS,
  MAP_BOUNDARY,
  MAP_CHESTS,
  MAP_COURTS,
  MAP_DRAGONS,
  MAP_ELITES,
  MAP_PIGS,
  MAP_ROUTE_EDGES,
  MAP_ROUTE_NODES,
  MAP_SPAWN_POINTS,
  type MapPointMm,
} from '@jwgb/content';
import { hash2 } from '../shading/noise';
import { sampleRim } from './boundary-river';
import { groundSurfaceMeters } from './ground-surface';
import { convexContains, ringContains } from './map-polygons';
import { isInsideBoundWall, massifSurfaceMeters } from './massif-surface';

/**
 * Shared deterministic sampling helpers for map dressing builders.
 *
 * All placement is seeded from the compiled map geometry hash so every client
 * builds identical dressing, and every rejection test runs against the same
 * compiled geometry the sim collides with — dressing can never sit inside a
 * wall the player cannot reach.
 */

export { groundSurfaceMeters, highlandTopMeters } from './ground-surface';
export { convexContains, ringContains } from './map-polygons';
export { isInsideBoundWall, isInsideVaultWall, massifSurfaceMeters } from './massif-surface';

const MM = 1_000;

/** xorshift32 stream; render-only determinism, never used by the sim. */
export function createRandomStream(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

interface RoadSegmentMm {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly halfWidthMm: number;
}

const NODE_POSITIONS = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));

const ROAD_SEGMENTS: readonly RoadSegmentMm[] = MAP_ROUTE_EDGES.flatMap((edge) => {
  const a = NODE_POSITIONS.get(edge.a);
  const b = NODE_POSITIONS.get(edge.b);
  if (!a || !b) {
    return [];
  }
  return [{ ax: a.x, az: a.z, bx: b.x, bz: b.z, halfWidthMm: edge.widthMm / 2 }];
});

interface LandmarkClearanceMm {
  readonly x: number;
  readonly z: number;
  readonly radiusMm: number;
}

const LANDMARK_CLEARANCES: readonly LandmarkClearanceMm[] = [
  ...AUTHORITATIVE_MAP_SHOPS.map((shop) => ({
    x: shop.x,
    z: shop.z,
    radiusMm: 6_500,
  })),
  ...MAP_PIGS.map((pig) => ({
    x: pig.position.x,
    z: pig.position.z,
    radiusMm: 10_000,
  })),
  ...MAP_DRAGONS.map((dragon) => ({
    x: dragon.position.x,
    z: dragon.position.z,
    radiusMm: 15_000,
  })),
  ...MAP_ELITES.map((elite) => ({
    x: elite.position.x,
    z: elite.position.z,
    radiusMm: 11_000,
  })),
  ...MAP_SPAWN_POINTS.map((spawn) => ({
    x: spawn.position.x,
    z: spawn.position.z,
    radiusMm: 2_400,
  })),
  ...MAP_CHESTS.map((chest) => ({
    x: chest.position.x,
    z: chest.position.z,
    radiusMm: 1_600,
  })),
];

/** True when the point sits on a road ribbon plus the given verge margin. */
export function isOnRoad(point: MapPointMm, vergeMm: number): boolean {
  for (const segment of ROAD_SEGMENTS) {
    const clearance = segment.halfWidthMm + vergeMm;
    const dx = segment.bx - segment.ax;
    const dz = segment.bz - segment.az;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - segment.ax) * dx + (point.z - segment.az) * dz) / lengthSquared,
            ),
          );
    const nearestX = segment.ax + t * dx;
    const nearestZ = segment.az + t * dz;
    const offX = point.x - nearestX;
    const offZ = point.z - nearestZ;
    if (offX * offX + offZ * offZ <= clearance * clearance) {
      return true;
    }
  }
  return false;
}

function isNearLandmark(point: MapPointMm, clearanceScale: number): boolean {
  return LANDMARK_CLEARANCES.some((landmark) => {
    const dx = point.x - landmark.x;
    const dz = point.z - landmark.z;
    const radiusMm = landmark.radiusMm * clearanceScale;
    return dx * dx + dz * dz <= radiusMm * radiusMm;
  });
}

export interface SampleOptions {
  /** Extra keep-out margin around road ribbons; negative skips the road test. */
  readonly roadVergeMm?: number;
  /**
   * Multiplier for landmark keep-out radii. The default preserves the
   * conservative clearance used by gameplay dressing; foliage can use a
   * smaller value so legal ground around a structure does not read barren.
   */
  readonly landmarkClearanceScale?: number;
  /**
   * Accept points inside BOUND wall footprints. Those walls are drawn as rocky
   * massifs, and vegetation placed there stands on the massif surface through
   * `dressingSurfaceMeters`; gameplay dressing keeps the default keep-out.
   */
  readonly includeBoundMassifs?: boolean;
  /**
   * Extra keep-out discs in millimetres. Vegetation passes the procedural
   * building sites here so every house, hall and pagoda stands in a clearing
   * instead of inside the tree canopy.
   */
  readonly exclusionZones?: readonly ExclusionZone[];
  /**
   * Distance over which vegetation thins towards the boundary, in millimetres.
   * Density falls off continuously instead of stopping on a keep-out line, so
   * the wood dissolves into the shore apron.
   */
  readonly rimThinningMm?: number;
  /**
   * Accept points up to this far *outside* the boundary polygon, in
   * millimetres. The river bank shelf runs a few metres past the polygon and
   * used to stand bare between the last grass and the rock, which drew the
   * map edge as a line; ground cover overhangs onto the shelf instead.
   */
  readonly rimOverhangMm?: number;
}

export interface ExclusionZone {
  readonly x: number;
  readonly z: number;
  readonly radiusMm: number;
}

const BOUNDS = (() => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of MAP_BOUNDARY) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, maxX, minZ, maxZ };
})();

/**
 * Rejection-samples up to `count` points on open walkable ground: inside the
 * boundary, outside every wall piece and court, and (unless disabled) clear of
 * the road network. VAULT footprints are walkable hills, so only BOUND wall
 * pieces remain keep-out geometry.
 */
export function sampleOpenGround(
  count: number,
  attempts: number,
  nextRandom: () => number,
  options: SampleOptions = {},
): MapPointMm[] {
  const roadVergeMm = options.roadVergeMm ?? 1_500;
  const points: MapPointMm[] = [];
  for (let attempt = 0; attempt < attempts && points.length < count; attempt += 1) {
    const point: MapPointMm = {
      x: Math.round(BOUNDS.minX + nextRandom() * (BOUNDS.maxX - BOUNDS.minX)),
      z: Math.round(BOUNDS.minZ + nextRandom() * (BOUNDS.maxZ - BOUNDS.minZ)),
    };
    if (
      !isOpenGround(point, {
        roadVergeMm,
        ...(options.exclusionZones ? { exclusionZones: options.exclusionZones } : {}),
      })
    ) {
      continue;
    }
    points.push(point);
  }
  return points;
}

/**
 * Returns whether a point is legal for purely visual map dressing. Cluster
 * builders use it after offsetting an accepted anchor, so dense scenery still
 * leaves authoritative roads, courts, landmarks and walls visibly clear.
 */
export function isOpenGround(point: MapPointMm, options: SampleOptions = {}): boolean {
  const roadVergeMm = options.roadVergeMm ?? 1_500;
  const landmarkClearanceScale = Math.max(0, options.landmarkClearanceScale ?? 1);
  return (
    (ringContains(MAP_BOUNDARY, point) || withinRimOverhang(point, options.rimOverhangMm)) &&
    (options.includeBoundMassifs === true || !isInsideBoundWall(point)) &&
    !MAP_COURTS.some((court) => convexContains(court.hexVertices, point)) &&
    !isNearLandmark(point, landmarkClearanceScale) &&
    (roadVergeMm < 0 || !isOnRoad(point, roadVergeMm)) &&
    !insideExclusionZone(point, options.exclusionZones) &&
    survivesRimThinning(point, options.rimThinningMm)
  );
}

function withinRimOverhang(point: MapPointMm, overhangMm: number | undefined): boolean {
  if (!overhangMm || overhangMm <= 0) {
    return false;
  }
  return rimDistanceMeters(point.x, point.z) * MM <= overhangMm;
}

/**
 * Distance to the boundary rim, metres, from a baked field.
 *
 * A hard keep-out band drew its own visible edge where the wood stopped. The
 * thinning test needs the actual distance, and scanning 686 rim samples per
 * candidate is far too slow, so the distance is rasterised once into a 4 m
 * grid with a two-pass chamfer sweep and then read back in O(1).
 */
const RIM_FIELD_CELL_METERS = 4;
let rimDistanceField: {
  minX: number;
  minZ: number;
  columns: number;
  rows: number;
  data: Float32Array;
} | null = null;

function buildRimDistanceField(): NonNullable<typeof rimDistanceField> {
  const rim = sampleRim();
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of MAP_BOUNDARY) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const margin = 60_000;
  const step = RIM_FIELD_CELL_METERS * MM;
  const originX = minX - margin;
  const originZ = minZ - margin;
  const columns = Math.ceil((maxX - minX + margin * 2) / step) + 1;
  const rows = Math.ceil((maxZ - minZ + margin * 2) / step) + 1;
  const data = new Float32Array(columns * rows).fill(Number.POSITIVE_INFINITY);
  for (const sample of rim) {
    // Stamp a 3x3 block so the sweep has a starting value in every direction.
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = sample.x + dx * step;
        const z = sample.z + dz * step;
        const column = Math.round((x - originX) / step);
        const row = Math.round((z - originZ) / step);
        if (column < 0 || row < 0 || column >= columns || row >= rows) {
          continue;
        }
        const index = row * columns + column;
        const distance = Math.hypot(x - sample.x, z - sample.z) / MM;
        if (distance < (data[index] as number)) {
          data[index] = distance;
        }
      }
    }
  }
  const diagonal = RIM_FIELD_CELL_METERS * Math.SQRT2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      let best = data[index] as number;
      if (column > 0) {
        best = Math.min(best, (data[index - 1] as number) + RIM_FIELD_CELL_METERS);
        if (row > 0) {
          best = Math.min(best, (data[index - columns - 1] as number) + diagonal);
        }
      }
      if (row > 0) {
        best = Math.min(best, (data[index - columns] as number) + RIM_FIELD_CELL_METERS);
        if (column + 1 < columns) {
          best = Math.min(best, (data[index - columns + 1] as number) + diagonal);
        }
      }
      data[index] = best;
    }
  }
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      const index = row * columns + column;
      let best = data[index] as number;
      if (column + 1 < columns) {
        best = Math.min(best, (data[index + 1] as number) + RIM_FIELD_CELL_METERS);
        if (row + 1 < rows) {
          best = Math.min(best, (data[index + columns + 1] as number) + diagonal);
        }
      }
      if (row + 1 < rows) {
        best = Math.min(best, (data[index + columns] as number) + RIM_FIELD_CELL_METERS);
        if (column > 0) {
          best = Math.min(best, (data[index + columns - 1] as number) + diagonal);
        }
      }
      data[index] = best;
    }
  }
  return { minX: originX, minZ: originZ, columns, rows, data };
}

/** Distance from a point to the boundary rim in metres. */
export function rimDistanceMeters(xMm: number, zMm: number): number {
  rimDistanceField ??= buildRimDistanceField();
  const field = rimDistanceField;
  const step = RIM_FIELD_CELL_METERS * MM;
  const column = Math.round((xMm - field.minX) / step);
  const row = Math.round((zMm - field.minZ) / step);
  if (column < 0 || row < 0 || column >= field.columns || row >= field.rows) {
    return 0;
  }
  const value = field.data[row * field.columns + column] as number;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Continuous density falloff towards the boundary.
 *
 * A point on the rim is always rejected, cover returns to full at
 * `rimThinningMm` inland, and a stable per-point hash turns the ramp into
 * scattered outliers rather than a visible band edge.
 */
function survivesRimThinning(point: MapPointMm, thinningMm: number | undefined): boolean {
  if (!thinningMm || thinningMm <= 0) {
    return true;
  }
  const keep = Math.min(1, rimDistanceMeters(point.x, point.z) / (thinningMm / MM));
  if (keep >= 1) {
    return true;
  }
  return hash2(point.x, point.z, 0x5c1) < keep * keep;
}

function insideExclusionZone(
  point: MapPointMm,
  zones: readonly ExclusionZone[] | undefined,
): boolean {
  if (!zones || zones.length === 0) {
    return false;
  }
  for (const zone of zones) {
    const dx = zone.x - point.x;
    const dz = zone.z - point.z;
    if (dx * dx + dz * dz < zone.radiusMm * zone.radiusMm) {
      return true;
    }
  }
  return false;
}

/**
 * Height to place visual ground dressing at: the massif rock over a BOUND
 * wall, the plateau top where there is one, the terrain surface everywhere
 * else. Render-only; the simulation keeps using its own height field.
 */
export function dressingSurfaceMeters(point: MapPointMm): number {
  const ground = groundSurfaceMeters(point);
  const massif = massifSurfaceMeters(point);
  // A massif foot dips 0.3 m below ground so its skirt never floats; dressing
  // there still belongs on the ground, not in the dip.
  return massif === null ? ground : Math.max(massif, ground);
}

/**
 * Even, gap-free ground coverage on a jittered lattice.
 *
 * `sampleOpenGround` plus `expandClusters` was the wrong tool for ground
 * cover: anchors land at random so the result is a scatter of clumps with bare
 * ground between them, no matter how high the count goes. Walking a lattice
 * and jittering inside each cell gives coverage with no holes and no visible
 * rows, which is what "cover the whole surface" actually needs.
 *
 * Highland plateaus come along for free — they are inside the boundary and are
 * not walls, so the lattice covers them and `dressingSurfaceMeters` puts the
 * dressing on the plateau top rather than on the ground beneath it.
 *
 * `reject` is the caller's extra veto — ground cover uses it to skip ponds,
 * which full coverage would otherwise plant grass in. It is a parameter rather
 * than a direct water lookup because `water.ts` depends on this module, and
 * importing it back would close a cycle.
 */
export function sampleGroundLattice(
  spacingMeters: number,
  nextRandom: () => number,
  options: SampleOptions & {
    readonly jitter?: number;
    readonly reject?: (point: MapPointMm) => boolean;
  } = {},
): MapPointMm[] {
  const spacingMm = Math.max(1, Math.round(spacingMeters * MM));
  const jitter = options.jitter ?? 0.85;
  const points: MapPointMm[] = [];
  const pad = Math.max(0, options.rimOverhangMm ?? 0);
  for (let z = BOUNDS.minZ - pad; z <= BOUNDS.maxZ + pad; z += spacingMm) {
    for (let x = BOUNDS.minX - pad; x <= BOUNDS.maxX + pad; x += spacingMm) {
      const point: MapPointMm = {
        x: Math.round(x + (nextRandom() - 0.5) * spacingMm * jitter),
        z: Math.round(z + (nextRandom() - 0.5) * spacingMm * jitter),
      };
      if (!isOpenGround(point, options)) {
        continue;
      }
      if (options.reject?.(point)) {
        continue;
      }
      points.push(point);
    }
  }
  return points;
}

export function toMetersPoint(point: MapPointMm): { x: number; z: number } {
  return { x: point.x / MM, z: point.z / MM };
}
