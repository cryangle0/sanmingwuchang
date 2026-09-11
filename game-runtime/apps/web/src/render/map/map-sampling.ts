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
   * Keep-out band inside the boundary polygon, in millimetres. The rim used to
   * carry the same dense forest as the interior right up to the bank, which
   * made the map edge read as a cut-out. Vegetation passes ~12 m here so the
   * woods thin into the shore apron.
   */
  readonly rimClearanceMm?: number;
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
    ringContains(MAP_BOUNDARY, point) &&
    (options.includeBoundMassifs === true || !isInsideBoundWall(point)) &&
    !MAP_COURTS.some((court) => convexContains(court.hexVertices, point)) &&
    !isNearLandmark(point, landmarkClearanceScale) &&
    (roadVergeMm < 0 || !isOnRoad(point, roadVergeMm)) &&
    !insideExclusionZone(point, options.exclusionZones) &&
    !insideRimBand(point, options.rimClearanceMm)
  );
}

/**
 * Rim band membership from a coarse cell set, so the per-candidate cost stays
 * constant instead of scanning the 686 rim samples.
 */
const RIM_CELL_METERS = 8;
let rimCells: Set<string> | null = null;

function rimCellKey(x: number, z: number): string {
  return `${Math.floor(x / RIM_CELL_METERS)}:${Math.floor(z / RIM_CELL_METERS)}`;
}

function rimCellSet(): Set<string> {
  if (rimCells) {
    return rimCells;
  }
  const cells = new Set<string>();
  for (const sample of sampleRim()) {
    cells.add(rimCellKey(sample.x, sample.z));
  }
  rimCells = cells;
  return cells;
}

function insideRimBand(point: MapPointMm, clearanceMm: number | undefined): boolean {
  if (!clearanceMm || clearanceMm <= 0) {
    return false;
  }
  const cells = rimCellSet();
  const metres = clearanceMm / MM;
  const steps = Math.max(1, Math.ceil(metres / RIM_CELL_METERS));
  const x = point.x / MM;
  const z = point.z / MM;
  for (let dx = -steps; dx <= steps; dx += 1) {
    for (let dz = -steps; dz <= steps; dz += 1) {
      if (cells.has(rimCellKey(x + dx * RIM_CELL_METERS, z + dz * RIM_CELL_METERS))) {
        return true;
      }
    }
  }
  return false;
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
  for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += spacingMm) {
    for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += spacingMm) {
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
