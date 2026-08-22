/**
 * Authoritative walkable height for 百眼迷城.
 *
 * Sim, web renderer, and the C# port share this integer-mm function so a
 * hill that lifts a character also blocks line of sight. Roads drape over
 * local relief with a shallow camber; shops and spawn pads flatten to the
 * local hillside instead of punching a pit to y=0. Authored highlands stamp
 * up to their compiled top height. The noise seed is the compiled geometry
 * hash, not a per-match roll.
 */

import {
  MAP_COURTS,
  MAP_DRAGONS,
  MAP_ELITES,
  MAP_GEOMETRY_HASH,
  MAP_HIGHLANDS,
  MAP_NESTS,
  MAP_PIGS,
  MAP_ROCKS,
  MAP_ROUTE_EDGES,
  MAP_ROUTE_NODES,
  MAP_SHOPS,
  MAP_SPAWN_POINTS,
} from './map-geometry.generated';
import type { MapPointMm } from './map-geometry-types';

/**
 * Terrain profile revision. Bump on every change to this file that moves the
 * height field, and carry it in the state hash beside `mapGeometryHash` so a
 * cross-language mismatch is attributable to terrain rather than geometry.
 * The compiled map JSON is untouched, so `map:authority` stays independent.
 */
export const TERRAIN_PROFILE_VERSION = 2;

/**
 * Peak-to-trough of the wilderness noise before stamps, millimetres.
 *
 * Read together with NOISE_CELL_MM: those two set the terrain's character.
 * A 14 m wavelength carrying 5.2 m of amplitude — the pre-2026-08-22 pairing
 * — implies roughly `5.2 * pi / 14` of slope, which measured as a p95 of
 * 39 degrees and blocked 37% of all 25 m sightlines. That occlusion bought
 * nothing: the bumps were smaller than the 4 m render grid, so players were
 * blinded by relief they could not see. Stretching the wavelength to 110 m
 * and raising amplitude to 18 m yields 3.4x the relief for 40% of the
 * occlusion, and is what makes the map read as landforms rather than gravel.
 */
export const TERRAIN_AMPLITUDE_MM = 18_000;
/** Quiet water surface in valley floors. */
export const TERRAIN_WATER_LEVEL_MM = -550;
/** Eye / projectile height used when terrain occludes a 2D walk line. */
export const TERRAIN_EYE_HEIGHT_MM = 1_500;
const TERRAIN_SIGHT_CLEARANCE_MM = 220;
const TERRAIN_SIGHT_STEP_MM = 2_000;

/** Coarsest noise octave; the dominant landform scale. See TERRAIN_AMPLITUDE_MM. */
const NOISE_CELL_MM = 110_000;
/**
 * Finest noise octave, matched to the renderer's 4 m ground grid. A finer
 * floor only produces sub-grid bumps that the player never sees but that
 * still clip the line-of-sight ray.
 */
const NOISE_MIN_CELL_MM = 4_000;
/**
 * Narrowest transition a stamp may fall off over.
 *
 * The renderer samples this function on a 4 m grid, so anything that changes
 * height over less than two cells is a feature the ground mesh cannot carry:
 * the sim reads the true function, the player stands on the interpolated
 * triangle, and the two disagree. Before this floor existed the stamp edges
 * ran as narrow as 2.4 m and characters sank up to 4.8 m below the rendered
 * ground across 38% of the map. Every edge below is clamped up to it.
 */
const MIN_STAMP_EDGE_MM = 8_000;
/**
 * Grid the authoritative height is quantised to. Must equal the renderer's
 * GROUND_CELL_METERS; a ground mesh built on any other spacing reintroduces
 * the sim/render disagreement this grid exists to remove.
 */
export const TERRAIN_LATTICE_MM = 4_000;
const UNIT = 10_000;
const ROAD_CAMBER_MM = 180;
const ROAD_EDGE_MM = 8_000;
const COURT_EDGE_MM = 8_000;
const HIGHLAND_EDGE_MM = 8_000;
const PAD_RADIUS_MM = 7_000;
const PAD_EDGE_MM = 8_000;
const SHOP_RADIUS_MM = 8_000;
const MAX_STAMP_SEGMENT_MM = 30_000;
const ROAD_GRID_MM = 16_000;

const TERRAIN_SEED = Number.parseInt(MAP_GEOMETRY_HASH.slice(0, 8), 16) >>> 0 || 1;

interface SegmentStamp {
  readonly a: MapPointMm;
  readonly b: MapPointMm;
  readonly halfWidthMm: number;
  readonly edgeMm: number;
  readonly targetMm: number;
}

interface PolyStamp {
  readonly vertices: readonly MapPointMm[];
  readonly targetMm: number;
  readonly edgeMm: number;
}

interface CircleStamp {
  readonly x: number;
  readonly z: number;
  readonly radiusMm: number;
  readonly edgeMm: number;
  readonly targetMm: number;
}

interface StampIndex {
  readonly roads: readonly SegmentStamp[];
  readonly roadCells: ReadonlyMap<number, readonly number[]>;
  readonly courts: readonly PolyStamp[];
  readonly highlands: readonly PolyStamp[];
  readonly pads: readonly CircleStamp[];
  readonly features: readonly CircleStamp[];
  readonly bowls: readonly CircleStamp[];
}

let stamps: StampIndex | null = null;
const latticeCache = new Map<number, number>();

export function terrainHeightMeters(xMeters: number, zMeters: number): number {
  return terrainHeightMm(Math.round(xMeters * 1_000), Math.round(zMeters * 1_000)) / 1_000;
}

/**
 * Authoritative walkable height, defined as the ground mesh's own triangle
 * interpolation over a fixed TERRAIN_LATTICE_MM grid.
 *
 * The quantisation is the point, not an optimisation. The renderer can only
 * draw a triangle mesh sampled on that same grid, so any relief finer than a
 * cell exists for the sim and not for the player: before this, characters
 * stood on the mesh while line of sight was traced against the continuous
 * function, and the two disagreed by as much as 4.8 m over 38% of the map.
 * Interpolating the same lattice the mesh is built from makes them equal by
 * construction, everywhere, with no tolerance to tune.
 *
 * Lattice samples are memoised. The grid holds at most a few tens of
 * thousands of points, and the cache is a pure function of the compiled map,
 * so it neither affects determinism nor needs invalidating.
 */
export function terrainHeightMm(xMm: number, zMm: number): number {
  const cellX = floorDiv(xMm, TERRAIN_LATTICE_MM);
  const cellZ = floorDiv(zMm, TERRAIN_LATTICE_MM);
  const localX = xMm - cellX * TERRAIN_LATTICE_MM;
  const localZ = zMm - cellZ * TERRAIN_LATTICE_MM;
  // Corner names and the diagonal match buildGroundGeometry's winding, which
  // emits triangles (a, b, c) and (a, c, d). Bilinear interpolation would not
  // reproduce a triangle mesh, so the split has to be replicated exactly.
  const a = latticeHeightMm(cellX, cellZ);
  const b = latticeHeightMm(cellX, cellZ + 1);
  const c = latticeHeightMm(cellX + 1, cellZ + 1);
  const d = latticeHeightMm(cellX + 1, cellZ);
  if (localX <= localZ) {
    return (
      a +
      Math.trunc(((b - a) * (localZ - localX)) / TERRAIN_LATTICE_MM) +
      Math.trunc(((c - b) * localX) / TERRAIN_LATTICE_MM)
    );
  }
  return (
    a +
    Math.trunc(((d - a) * (localX - localZ)) / TERRAIN_LATTICE_MM) +
    Math.trunc(((c - d) * localZ) / TERRAIN_LATTICE_MM)
  );
}

function latticeHeightMm(cellX: number, cellZ: number): number {
  const key = cellX * 1_000_003 + cellZ;
  const cached = latticeCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const height = continuousHeightMm(cellX * TERRAIN_LATTICE_MM, cellZ * TERRAIN_LATTICE_MM);
  latticeCache.set(key, height);
  return height;
}

/** Relief before lattice quantisation. Stamp targets are authored against this. */
function continuousHeightMm(xMm: number, zMm: number): number {
  const index = stampIndex();
  let height = heightBeforeFeatures(xMm, zMm, index);
  height = applyCircleStamps(height, xMm, zMm, index.features);
  height = applyCircleStamps(height, xMm, zMm, index.bowls);
  return height;
}

/**
 * True when the terrain ridge between two ground points rises through the
 * eye-height ray. Wall collision stays in MapCollisionField; this only
 * accounts for the heightfield.
 */
export function terrainBlocksLineOfSight(
  start: MapPointMm,
  end: MapPointMm,
  eyeHeightMm: number = TERRAIN_EYE_HEIGHT_MM,
): boolean {
  const startY = terrainHeightMm(start.x, start.z) + eyeHeightMm;
  const endY = terrainHeightMm(end.x, end.z) + eyeHeightMm;
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const distanceMm = isqrt(deltaX * deltaX + deltaZ * deltaZ);
  if (distanceMm <= TERRAIN_SIGHT_STEP_MM) {
    return false;
  }
  for (let walked = TERRAIN_SIGHT_STEP_MM; walked < distanceMm; walked += TERRAIN_SIGHT_STEP_MM) {
    const x = start.x + Math.trunc((deltaX * walked) / distanceMm);
    const z = start.z + Math.trunc((deltaZ * walked) / distanceMm);
    const rayY = startY + Math.trunc(((endY - startY) * walked) / distanceMm);
    if (terrainHeightMm(x, z) + TERRAIN_SIGHT_CLEARANCE_MM > rayY) {
      return true;
    }
  }
  return false;
}

function stampIndex(): StampIndex {
  if (stamps) {
    return stamps;
  }
  const nodes = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));
  const roads: SegmentStamp[] = [];
  for (const edge of MAP_ROUTE_EDGES) {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) {
      continue;
    }
    const halfWidthMm = Math.trunc(edge.widthMm / 2) + 1_000;
    for (const [start, end] of subdivideSegment(a, b)) {
      roads.push({
        a: start,
        b: end,
        halfWidthMm,
        edgeMm: ROAD_EDGE_MM,
        targetMm: ROAD_CAMBER_MM,
      });
    }
  }
  const roadCells = new Map<number, number[]>();
  roads.forEach((road, roadIndex) => {
    const pad = road.halfWidthMm + road.edgeMm;
    const minX = Math.min(road.a.x, road.b.x) - pad;
    const maxX = Math.max(road.a.x, road.b.x) + pad;
    const minZ = Math.min(road.a.z, road.b.z) - pad;
    const maxZ = Math.max(road.a.z, road.b.z) + pad;
    const minCellX = floorDiv(minX, ROAD_GRID_MM);
    const maxCellX = floorDiv(maxX, ROAD_GRID_MM);
    const minCellZ = floorDiv(minZ, ROAD_GRID_MM);
    const maxCellZ = floorDiv(maxZ, ROAD_GRID_MM);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        const key = cellKey(cellX, cellZ);
        const bucket = roadCells.get(key);
        if (bucket) {
          bucket.push(roadIndex);
        } else {
          roadCells.set(key, [roadIndex]);
        }
      }
    }
  });

  const pads = [
    ...MAP_SPAWN_POINTS.map((spawn) => ({
      x: spawn.position.x,
      z: spawn.position.z,
      radiusMm: PAD_RADIUS_MM,
      edgeMm: PAD_EDGE_MM,
      targetMm: baseHeightMm(spawn.position.x, spawn.position.z),
    })),
    ...MAP_SHOPS.map((shop) => ({
      x: shop.position.x,
      z: shop.position.z,
      radiusMm: SHOP_RADIUS_MM,
      edgeMm: PAD_EDGE_MM,
      targetMm: baseHeightMm(shop.position.x, shop.position.z),
    })),
  ];
  const draft: StampIndex = {
    roads,
    roadCells,
    courts: MAP_COURTS.map((court) => ({
      vertices: court.hexVertices,
      targetMm: 0,
      edgeMm: COURT_EDGE_MM,
    })),
    highlands: MAP_HIGHLANDS.map((highland) => ({
      vertices: highland.vertices,
      targetMm: highland.topHeightMm,
      edgeMm: HIGHLAND_EDGE_MM,
    })),
    pads,
    features: [],
    bowls: [],
  };
  const features: CircleStamp[] = [];
  const bowls: CircleStamp[] = [];
  const flattenAt = (
    x: number,
    z: number,
    radiusMm: number,
    edgeMm: number,
    bowlMm = 0,
    bowlRadiusMm = 0,
  ): void => {
    const targetMm = heightBeforeFeatures(x, z, draft);
    features.push({ x, z, radiusMm, edgeMm: bandLimitEdge(edgeMm), targetMm });
    if (bowlMm !== 0 && bowlRadiusMm > 0 && !insideHighland(x, z, draft)) {
      bowls.push({
        x,
        z,
        radiusMm: bowlRadiusMm,
        edgeMm: bandLimitEdge(Math.trunc(bowlRadiusMm / 2)),
        targetMm: targetMm + bowlMm,
      });
    }
  };
  for (const rock of MAP_ROCKS) {
    flattenAt(rock.position.x, rock.position.z, 8_500, 4_000);
  }
  for (const nest of MAP_NESTS) {
    const inner = nest.band === '内';
    const mid = nest.band === '中';
    flattenAt(
      nest.base.x,
      nest.base.z,
      inner ? 12_000 : mid ? 10_500 : 9_000,
      5_000,
      inner ? -900 : mid ? -700 : -520,
      inner ? 6_500 : mid ? 5_500 : 4_800,
    );
  }
  for (const pig of MAP_PIGS) {
    flattenAt(pig.position.x, pig.position.z, 12_000, 5_000, -400, 5_500);
  }
  for (const dragon of MAP_DRAGONS) {
    flattenAt(dragon.position.x, dragon.position.z, 14_500, 5_500);
  }
  for (const elite of MAP_ELITES) {
    flattenAt(elite.position.x, elite.position.z, 12_500, 5_000);
  }
  stamps = { ...draft, features, bowls };
  return stamps;
}

function heightBeforeFeatures(xMm: number, zMm: number, index: StampIndex): number {
  let height = baseHeightMm(xMm, zMm);
  height = applyRoadStamps(height, xMm, zMm, index);
  height = applyCircleStamps(height, xMm, zMm, index.pads);
  height = applyPolyStamps(height, xMm, zMm, index.highlands);
  height = applyPolyStamps(height, xMm, zMm, index.courts);
  return height;
}

function insideHighland(xMm: number, zMm: number, index: StampIndex): boolean {
  const point = { x: xMm, z: zMm };
  for (const highland of index.highlands) {
    if (ringContainsPoint(highland.vertices, point)) {
      return true;
    }
  }
  return false;
}

function baseHeightMm(xMm: number, zMm: number): number {
  const warp = warpedUnit(xMm, zMm, TERRAIN_SEED);
  const centered = warp - 5_000;
  const ridge = ridgeUnit(xMm, zMm, TERRAIN_SEED + 5_000);
  const hi = smoothRange(centered, 1_000, 4_500);
  const rolling = Math.trunc((centered * (UNIT - Math.trunc((hi * 5_000) / UNIT))) / UNIT);
  const peaks = Math.trunc((ridge * Math.trunc((hi * 9_000) / UNIT)) / UNIT);
  return Math.trunc(((rolling + peaks) * TERRAIN_AMPLITUDE_MM) / 5_000);
}

function warpedUnit(xMm: number, zMm: number, seed: number): number {
  const qx = fbmUnit(xMm, zMm, seed + 1_000, 3);
  const qy = fbmUnit(xMm + 5_200, zMm + 1_300, seed + 2_000, 3);
  const warpedX = xMm + Math.trunc((12_000 * (qx - 5_000)) / UNIT);
  const warpedZ = zMm + Math.trunc((12_000 * (qy - 5_000)) / UNIT);
  return fbmUnit(warpedX, warpedZ, seed + 3_000, 5);
}

function fbmUnit(xMm: number, zMm: number, seed: number, octaves: number): number {
  let sum = 0;
  let norm = 0;
  let amplitude = UNIT;
  let cell = NOISE_CELL_MM;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += Math.trunc((valueNoiseUnit(xMm, zMm, cell, seed + octave * 1_013) * amplitude) / UNIT);
    norm += amplitude;
    amplitude = Math.trunc(amplitude / 2);
    cell = Math.max(NOISE_MIN_CELL_MM, Math.trunc(cell / 2));
  }
  return norm === 0 ? 5_000 : Math.trunc((sum * UNIT) / norm);
}

function ridgeUnit(xMm: number, zMm: number, seed: number): number {
  let sum = 0;
  let norm = 0;
  let amplitude = UNIT;
  let cell = Math.trunc(NOISE_CELL_MM * 2.5);
  let signal = UNIT;
  for (let octave = 0; octave < 4; octave += 1) {
    const n = valueNoiseUnit(xMm, zMm, cell, seed + octave * 777);
    const ridge = UNIT - Math.abs(2 * n - UNIT);
    const squared = Math.trunc((ridge * ridge) / UNIT);
    const weighted = Math.trunc((squared * amplitude * signal) / (UNIT * UNIT));
    sum += weighted;
    norm += Math.trunc((amplitude * signal) / UNIT);
    signal = squared;
    amplitude = Math.trunc(amplitude / 2);
    cell = Math.max(NOISE_MIN_CELL_MM, Math.trunc((cell * 10) / 21));
  }
  return norm === 0 ? 0 : Math.trunc((sum * UNIT) / norm);
}

function valueNoiseUnit(xMm: number, zMm: number, cellMm: number, seed: number): number {
  const cellX = floorDiv(xMm, cellMm);
  const cellZ = floorDiv(zMm, cellMm);
  const localX = xMm - cellX * cellMm;
  const localZ = zMm - cellZ * cellMm;
  const u = smoothstep(localX, cellMm);
  const v = smoothstep(localZ, cellMm);
  const a = hashUnit(cellX, cellZ, seed);
  const b = hashUnit(cellX + 1, cellZ, seed);
  const c = hashUnit(cellX, cellZ + 1, seed);
  const d = hashUnit(cellX + 1, cellZ + 1, seed);
  return lerp(lerp(a, b, u, cellMm), lerp(c, d, u, cellMm), v, cellMm);
}

function hash2(x: number, y: number, seed: number): number {
  let hash = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash = hash ^ (hash >>> 16);
  return hash >>> 0;
}

function hashUnit(x: number, y: number, seed: number): number {
  return Math.trunc((hash2(x, y, seed) * UNIT) / 4_294_967_296);
}

function smoothstep(t: number, denom: number): number {
  if (t <= 0) {
    return 0;
  }
  if (t >= denom) {
    return denom;
  }
  return Math.trunc((t * t * (3 * denom - 2 * t)) / (denom * denom));
}

function smoothRange(value: number, edge0: number, edge1: number): number {
  if (value <= edge0) {
    return 0;
  }
  if (value >= edge1) {
    return UNIT;
  }
  const t = Math.trunc(((value - edge0) * UNIT) / (edge1 - edge0));
  return Math.trunc((t * t * (3 * UNIT - 2 * t)) / (UNIT * UNIT));
}

function lerp(a: number, b: number, t: number, denom: number): number {
  return a + Math.trunc(((b - a) * t) / denom);
}

function mixToward(current: number, target: number, weight: number): number {
  if (weight <= 0) {
    return current;
  }
  if (weight >= 1_000) {
    return target;
  }
  return current + Math.trunc(((target - current) * weight) / 1_000);
}

/** Widen any stamp falloff the 4 m ground mesh could not represent. */
function bandLimitEdge(edgeMm: number): number {
  return Math.max(MIN_STAMP_EDGE_MM, edgeMm);
}

function stampWeight(distanceMm: number, innerMm: number, edgeMm: number): number {  if (distanceMm <= innerMm) {
    return 1_000;
  }
  const outer = innerMm + edgeMm;
  if (distanceMm >= outer) {
    return 0;
  }
  return Math.trunc((1_000 * (outer - distanceMm)) / edgeMm);
}

function applyPolyStamps(
  height: number,
  xMm: number,
  zMm: number,
  polys: readonly PolyStamp[],
): number {
  let out = height;
  const point = { x: xMm, z: zMm };
  for (const poly of polys) {
    const inside = ringContainsPoint(poly.vertices, point);
    const distanceMm = inside ? 0 : distanceToRingMm(point, poly.vertices);
    out = mixToward(out, poly.targetMm, stampWeight(distanceMm, 0, poly.edgeMm));
  }
  return out;
}

function applyRoadStamps(height: number, xMm: number, zMm: number, index: StampIndex): number {
  const cellX = floorDiv(xMm, ROAD_GRID_MM);
  const cellZ = floorDiv(zMm, ROAD_GRID_MM);
  const seen = new Set<number>();
  let out = height;
  const point = { x: xMm, z: zMm };
  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
      const bucket = index.roadCells.get(cellKey(cellX + offsetX, cellZ + offsetZ));
      if (!bucket) {
        continue;
      }
      for (const roadIndex of bucket) {
        if (seen.has(roadIndex)) {
          continue;
        }
        seen.add(roadIndex);
        const road = index.roads[roadIndex];
        if (!road) {
          continue;
        }
        const distanceMm = isqrt(distanceSquaredToSegment(point, road.a, road.b));
        const targetMm = baseHeightMm(xMm, zMm) + road.targetMm;
        out = mixToward(out, targetMm, stampWeight(distanceMm, road.halfWidthMm, road.edgeMm));
      }
    }
  }
  return out;
}

function applyCircleStamps(
  height: number,
  xMm: number,
  zMm: number,
  circles: readonly CircleStamp[],
): number {
  let out = height;
  for (const circle of circles) {
    const distanceMm = isqrt((xMm - circle.x) ** 2 + (zMm - circle.z) ** 2);
    out = mixToward(out, circle.targetMm, stampWeight(distanceMm, circle.radiusMm, circle.edgeMm));
  }
  return out;
}

function ringContainsPoint(ring: readonly MapPointMm[], point: MapPointMm): boolean {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] as MapPointMm;
    const b = ring[(index + 1) % ring.length] as MapPointMm;
    if (a.z > point.z === b.z > point.z) {
      continue;
    }
    const deltaZ = b.z - a.z;
    const left = (point.x - a.x) * deltaZ;
    const right = (point.z - a.z) * (b.x - a.x);
    if (deltaZ > 0 ? left < right : left > right) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToRingMm(point: MapPointMm, ring: readonly MapPointMm[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] as MapPointMm;
    const b = ring[(index + 1) % ring.length] as MapPointMm;
    best = Math.min(best, distanceSquaredToSegment(point, a, b));
  }
  return isqrt(best);
}

function distanceSquaredToSegment(point: MapPointMm, start: MapPointMm, end: MapPointMm): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared === 0) {
    const dx = point.x - start.x;
    const dz = point.z - start.z;
    return dx * dx + dz * dz;
  }
  const projection = Math.max(
    0,
    Math.min(lengthSquared, (point.x - start.x) * deltaX + (point.z - start.z) * deltaZ),
  );
  const closestX = start.x + Math.trunc((deltaX * projection) / lengthSquared);
  const closestZ = start.z + Math.trunc((deltaZ * projection) / lengthSquared);
  const dx = point.x - closestX;
  const dz = point.z - closestZ;
  return dx * dx + dz * dz;
}

function subdivideSegment(
  a: MapPointMm,
  b: MapPointMm,
): readonly (readonly [MapPointMm, MapPointMm])[] {
  const span = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z));
  const chunks = Math.max(1, Math.trunc((span + MAX_STAMP_SEGMENT_MM - 1) / MAX_STAMP_SEGMENT_MM));
  if (chunks === 1) {
    return [[a, b]];
  }
  const parts: [MapPointMm, MapPointMm][] = [];
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const start: MapPointMm = {
      x: a.x + Math.trunc(((b.x - a.x) * chunk) / chunks),
      z: a.z + Math.trunc(((b.z - a.z) * chunk) / chunks),
    };
    const end: MapPointMm =
      chunk + 1 === chunks
        ? b
        : {
            x: a.x + Math.trunc(((b.x - a.x) * (chunk + 1)) / chunks),
            z: a.z + Math.trunc(((b.z - a.z) * (chunk + 1)) / chunks),
          };
    parts.push([start, end]);
  }
  return parts;
}

function floorDiv(value: number, denom: number): number {
  return Math.floor(value / denom);
}

function cellKey(cellX: number, cellZ: number): number {
  return cellX * 100_003 + cellZ;
}

function isqrt(value: number): number {
  if (value <= 0) {
    return 0;
  }
  return Math.trunc(Math.sqrt(value));
}
