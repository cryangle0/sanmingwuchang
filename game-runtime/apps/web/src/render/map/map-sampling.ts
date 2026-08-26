import {
  AUTHORITATIVE_MAP_SHOPS,
  MAP_BOUNDARY,
  MAP_COURTS,
  MAP_DRAGONS,
  MAP_ELITES,
  MAP_HIGHLANDS,
  MAP_PIGS,
  MAP_ROUTE_EDGES,
  MAP_ROUTE_NODES,
  MAP_WALL_PIECES,
  type MapPointMm,
  terrainHeightMeters,
} from '@jwgb/content';

/**
 * Shared deterministic sampling helpers for map dressing builders.
 *
 * All placement is seeded from the compiled map geometry hash so every client
 * builds identical dressing, and every rejection test runs against the same
 * compiled geometry the sim collides with — dressing can never sit inside a
 * wall the player cannot reach.
 */

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

export function ringContains(ring: readonly MapPointMm[], point: MapPointMm): boolean {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] as MapPointMm;
    const b = ring[(index + 1) % ring.length] as MapPointMm;
    if (a.z > point.z === b.z > point.z) {
      continue;
    }
    const intersectX = a.x + ((point.z - a.z) * (b.x - a.x)) / (b.z - a.z);
    if (point.x < intersectX) {
      inside = !inside;
    }
  }
  return inside;
}

export function convexContains(vertices: readonly MapPointMm[], point: MapPointMm): boolean {
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index] as MapPointMm;
    const b = vertices[(index + 1) % vertices.length] as MapPointMm;
    if ((b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x) < 0) {
      return false;
    }
  }
  return true;
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

function isNearLandmark(point: MapPointMm): boolean {
  return LANDMARK_CLEARANCES.some((landmark) => {
    const dx = point.x - landmark.x;
    const dz = point.z - landmark.z;
    return dx * dx + dz * dz <= landmark.radiusMm * landmark.radiusMm;
  });
}

export interface SampleOptions {
  /** Extra keep-out margin around road ribbons; negative skips the road test. */
  readonly roadVergeMm?: number;
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
 * the road network.
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
    if (!isOpenGround(point, { roadVergeMm })) {
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
  return (
    ringContains(MAP_BOUNDARY, point) &&
    !MAP_WALL_PIECES.some((piece) => convexContains(piece.vertices, point)) &&
    !MAP_COURTS.some((court) => convexContains(court.hexVertices, point)) &&
    !isNearLandmark(point) &&
    (roadVergeMm < 0 || !isOnRoad(point, roadVergeMm))
  );
}

const MM_PER_METER = 1_000;

/**
 * Top surface of the plateau a point stands on, or null on open terrain.
 *
 * The three 高台 are drawn as separate raised geometry sitting on the terrain,
 * so `terrainHeightMeters` still reports the ground *under* the table. Dressing
 * placed by that height inside a plateau footprint ends up buried beneath it,
 * which is why the highlands read as bare rock while the lowland around them
 * carries grass.
 */
export function highlandTopMeters(point: MapPointMm): number | null {
  for (const highland of MAP_HIGHLANDS) {
    if (ringContains(highland.vertices, point)) {
      return highland.topHeightMm / MM_PER_METER;
    }
  }
  return null;
}

/**
 * Height to place visual ground dressing at: the plateau top where there is
 * one, the terrain surface everywhere else. Render-only; the simulation keeps
 * using its own height field.
 */
export function dressingSurfaceMeters(point: MapPointMm): number {
  const top = highlandTopMeters(point);
  if (top !== null) {
    return top;
  }
  return terrainHeightMeters(point.x / MM_PER_METER, point.z / MM_PER_METER);
}

export function toMetersPoint(point: MapPointMm): { x: number; z: number } {
  return { x: point.x / MM, z: point.z / MM };
}
