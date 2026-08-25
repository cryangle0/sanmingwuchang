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
/** Steepest grade a road may hold, in per mille of run. */
const ROAD_MAX_GRADE_PER_MILLE = 120;
/** Relaxation sweeps over the route graph. Fixed so the result is reproducible. */
const ROAD_RELAX_SWEEPS = 24;
/** Spawn pads are pulled within this of the median spawn elevation. */
const SPAWN_FAIRNESS_BAND_MM = 1_500;
/** Ceiling on the equalisation ramp, so one outlier pad cannot reshape a district. */
const SPAWN_PAD_MAX_EDGE_MM = 40_000;
/** 伏石圈 sits on a lifted dais, ringed by a worn trench. */
const ROCK_PAD_LIFT_MM = 550;
const ROCK_MOAT_MM = -350;

const TERRAIN_SEED = Number.parseInt(MAP_GEOMETRY_HASH.slice(0, 8), 16) >>> 0 || 1;

interface SegmentStamp {
  readonly a: MapPointMm;
  readonly b: MapPointMm;
  readonly halfWidthMm: number;
  readonly edgeMm: number;
  /** Graded surface at each end; the road lerps between them along its run. */
  readonly targetAMm: number;
  readonly targetBMm: number;
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
  /** Stall levelling, laid before roads so a graded corridor still wins. */
  readonly shopPads: readonly CircleStamp[];
  /** Spawn fairness, laid after roads because it is a guarantee, not dressing. */
  readonly spawnPads: readonly CircleStamp[];
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
      Math.trunc(((b - a) * localZ) / TERRAIN_LATTICE_MM) +
      Math.trunc(((c - b) * localX) / TERRAIN_LATTICE_MM)
    );
  }
  return (
    a +
    Math.trunc(((d - a) * localX) / TERRAIN_LATTICE_MM) +
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

/** Per-layer height breakdown at a point. Diagnostics only; not used by the sim. */
export function terrainDebugProfile(
  xMm: number,
  zMm: number,
): {
  base: number;
  road: number;
  pads: number;
  highlands: number;
  courts: number;
  features: number;
  bowls: number;
  lattice: number;
} {
  const index = stampIndex();
  const base = baseHeightMm(xMm, zMm);
  const shops = applyCircleStamps(base, xMm, zMm, index.shopPads);
  const features = applyCircleStamps(shops, xMm, zMm, index.features);
  const bowls = applyCircleStamps(features, xMm, zMm, index.bowls);
  const road = applyRoadStamps(bowls, xMm, zMm, index);
  const pads = applyCircleStamps(road, xMm, zMm, index.spawnPads);
  const highlands = applyPolyStamps(pads, xMm, zMm, index.highlands);
  const courts = applyPolyStamps(highlands, xMm, zMm, index.courts);
  return {
    base,
    road,
    pads,
    highlands,
    courts,
    features,
    bowls,
    lattice: terrainHeightMm(xMm, zMm),
  };
}

/**
 * Where a den's hollow is actually dug, given its authored anchor.
 *
 * Every one of the 48 nest anchors measures as sitting inside a route
 * corridor — the compiled anchors are waypoints on the road network, not
 * clearings in the wild. Digging a hollow at the anchor therefore craters the
 * road: laying roads last filled 41 of 48 hollows back in, and laying dens
 * last broke line of sight along MAIN corridors. Sliding the hollow
 * perpendicular to the nearest route resolves both — the road stays a road
 * and the den gets real ground to sit in.
 *
 * The side is chosen by whichever offset lands farther from the network, with
 * ties going to the positive normal, so the result is a pure function of the
 * compiled map. Renderers must place den dressing on this point rather than on
 * the anchor, or the props will float beside their own hollow.
 */
export function denCentreMm(anchor: MapPointMm, floorRadiusMm: number): MapPointMm {
  const nodes = routeNodePositions();
  let bestDistance = Number.POSITIVE_INFINITY;
  let normalX = 0;
  let normalZ = 0;
  let halfWidthMm = 0;
  for (const edge of MAP_ROUTE_EDGES) {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) {
      continue;
    }
    const distanceMm = isqrt(distanceSquaredToSegment(anchor, a, b));
    if (distanceMm >= bestDistance) {
      continue;
    }
    const deltaX = b.x - a.x;
    const deltaZ = b.z - a.z;
    const lengthMm = isqrt(deltaX * deltaX + deltaZ * deltaZ);
    if (lengthMm === 0) {
      continue;
    }
    bestDistance = distanceMm;
    normalX = Math.trunc((-deltaZ * 1_000) / lengthMm);
    normalZ = Math.trunc((deltaX * 1_000) / lengthMm);
    halfWidthMm = Math.trunc(edge.widthMm / 2);
  }
  if (normalX === 0 && normalZ === 0) {
    return anchor;
  }
  const reachMm = halfWidthMm + MIN_STAMP_EDGE_MM + floorRadiusMm;
  const positive = {
    x: anchor.x + Math.trunc((normalX * reachMm) / 1_000),
    z: anchor.z + Math.trunc((normalZ * reachMm) / 1_000),
  };
  const negative = {
    x: anchor.x - Math.trunc((normalX * reachMm) / 1_000),
    z: anchor.z - Math.trunc((normalZ * reachMm) / 1_000),
  };
  return distanceToRouteNetworkMm(negative) > distanceToRouteNetworkMm(positive)
    ? negative
    : positive;
}

let routeNodeCache: Map<string, MapPointMm> | null = null;

function routeNodePositions(): ReadonlyMap<string, MapPointMm> {
  if (!routeNodeCache) {
    routeNodeCache = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));
  }
  return routeNodeCache;
}

function distanceToRouteNetworkMm(point: MapPointMm): number {
  const nodes = routeNodePositions();
  let best = Number.POSITIVE_INFINITY;
  for (const edge of MAP_ROUTE_EDGES) {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) {
      continue;
    }
    best = Math.min(
      best,
      isqrt(distanceSquaredToSegment(point, a, b)) - Math.trunc(edge.widthMm / 2),
    );
  }
  return best;
}

/** Relief before lattice quantisation. Stamp targets are authored against this. */
function continuousHeightMm(xMm: number, zMm: number): number {
  const index = stampIndex();
  let height = heightBeforeFeatures(xMm, zMm, index);
  height = applyCircleStamps(height, xMm, zMm, index.features);
  height = applyCircleStamps(height, xMm, zMm, index.bowls);
  // Roads are laid last on purpose. The corridor carries both connectivity and
  // sightlines along a route, so nothing below may cut into it: a den rim
  // crossing the road left a crest in the middle of a MAIN corridor that broke
  // line of sight between its own endpoints. Dens keep their hollows because
  // they are dug beside the route rather than on it — see denCentreMm.
  // Authored highlands and court floors still outrank the road, and their
  // ramps and gates are where the two meet.
  height = applyRoadStamps(height, xMm, zMm, index);
  // Spawn fairness outranks the corridor: a road may not hand one of the 30
  // starts a height advantage. Its skirt is sized to the correction it needs,
  // so on flat starts it barely touches the road at all.
  height = applyCircleStamps(height, xMm, zMm, index.spawnPads);
  height = applyPolyStamps(height, xMm, zMm, index.highlands);
  height = applyPolyStamps(height, xMm, zMm, index.courts);
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

/**
 * Graded surface height at each route node.
 *
 * Starting from the raw hillside, a fixed number of sweeps pulls neighbouring
 * nodes together until no edge exceeds ROAD_MAX_GRADE_PER_MILLE. Roads then
 * interpolate between node heights instead of draping over the noise, so a
 * road crossing a ridge cuts through it and a road crossing a hollow fills
 * it. Because the route graph spans every POI anchor and the graded corridor
 * is walkable end to end, the graph's own connectivity carries over to the
 * terrain.
 *
 * Sweeps run in compiled edge order for a fixed count, so the result is a
 * pure function of the map and ports to C# unchanged.
 */
function relaxRouteNodeHeights(nodes: ReadonlyMap<string, MapPointMm>): Map<string, number> {
  const heights = new Map<string, number>();
  for (const node of MAP_ROUTE_NODES) {
    heights.set(node.id, baseHeightMm(node.position.x, node.position.z));
  }
  for (let sweep = 0; sweep < ROAD_RELAX_SWEEPS; sweep += 1) {
    let adjusted = false;
    for (const edge of MAP_ROUTE_EDGES) {
      const heightA = heights.get(edge.a);
      const heightB = heights.get(edge.b);
      if (heightA === undefined || heightB === undefined || !nodes.has(edge.a)) {
        continue;
      }
      const allowedMm = Math.trunc((edge.lengthMm * ROAD_MAX_GRADE_PER_MILLE) / 1_000);
      const delta = heightB - heightA;
      const excess = Math.abs(delta) - allowedMm;
      if (excess <= 0) {
        continue;
      }
      // Split the correction across both ends, rounding away from zero so the
      // sweep always makes progress on odd millimetre excesses.
      const shift = Math.trunc(excess / 2) + (excess % 2);
      if (delta > 0) {
        heights.set(edge.a, heightA + shift);
        heights.set(edge.b, heightB - shift);
      } else {
        heights.set(edge.a, heightA - shift);
        heights.set(edge.b, heightB + shift);
      }
      adjusted = true;
    }
    if (!adjusted) {
      break;
    }
  }
  return heights;
}

/** Worst grade left on any route edge after relaxation, in per mille. */
export function routeGradeExtremePerMille(): number {
  const nodes = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));
  const heights = relaxRouteNodeHeights(nodes);
  let worst = 0;
  for (const edge of MAP_ROUTE_EDGES) {
    const heightA = heights.get(edge.a);
    const heightB = heights.get(edge.b);
    if (heightA === undefined || heightB === undefined || edge.lengthMm <= 0) {
      continue;
    }
    worst = Math.max(worst, Math.trunc((Math.abs(heightB - heightA) * 1_000) / edge.lengthMm));
  }
  return worst;
}

function stampIndex(): StampIndex {
  if (stamps) {
    return stamps;
  }
  const nodes = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));
  const nodeHeights = relaxRouteNodeHeights(nodes);
  const roads: SegmentStamp[] = [];
  for (const edge of MAP_ROUTE_EDGES) {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) {
      continue;
    }
    const heightA = nodeHeights.get(edge.a) ?? baseHeightMm(a.x, a.z);
    const heightB = nodeHeights.get(edge.b) ?? baseHeightMm(b.x, b.z);
    const halfWidthMm = Math.trunc(edge.widthMm / 2) + 1_000;
    const parts = subdivideSegment(a, b);
    parts.forEach(([start, end], part) => {
      roads.push({
        a: start,
        b: end,
        halfWidthMm,
        edgeMm: bandLimitEdge(ROAD_EDGE_MM),
        targetAMm: heightA + Math.trunc(((heightB - heightA) * part) / parts.length),
        targetBMm: heightA + Math.trunc(((heightB - heightA) * (part + 1)) / parts.length),
      });
    });
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

  const spawnMedianMm = medianOf(
    MAP_SPAWN_POINTS.map((spawn) => baseHeightMm(spawn.position.x, spawn.position.z)),
  );
  const spawnPads = MAP_SPAWN_POINTS.map((spawn) => {
    const groundMm = baseHeightMm(spawn.position.x, spawn.position.z);
    // Nobody starts the match looking down on the other 29, so pads are
    // pulled into a narrow band around the median spawn elevation. The
    // approach is only as long as the correction needs at road grade: a
    // fixed long skirt would have made every pad a 47 m radius terrain
    // modifier that swamped the graded road corridors running past it.
    const targetMm = clampToBand(groundMm, spawnMedianMm, SPAWN_FAIRNESS_BAND_MM);
    const rampMm = Math.trunc((Math.abs(targetMm - groundMm) * 1_000) / ROAD_MAX_GRADE_PER_MILLE);
    return {
      x: spawn.position.x,
      z: spawn.position.z,
      radiusMm: PAD_RADIUS_MM,
      edgeMm: Math.min(SPAWN_PAD_MAX_EDGE_MM, bandLimitEdge(rampMm)),
      targetMm,
    };
  });
  const shopPads = MAP_SHOPS.map((shop) => ({
    x: shop.position.x,
    z: shop.position.z,
    radiusMm: SHOP_RADIUS_MM,
    edgeMm: bandLimitEdge(PAD_EDGE_MM),
    targetMm: baseHeightMm(shop.position.x, shop.position.z),
  }));
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
    shopPads,
    spawnPads,
    features: [],
    bowls: [],
  };
  const features: CircleStamp[] = [];
  const bowls: CircleStamp[] = [];

  /** Level a disc onto the surrounding hillside, optionally lifting or sinking it. */
  const terraceAt = (
    x: number,
    z: number,
    radiusMm: number,
    edgeMm: number,
    liftMm = 0,
  ): number => {
    const groundMm = heightBeforeFeatures(x, z, draft);
    features.push({ x, z, radiusMm, edgeMm: bandLimitEdge(edgeMm), targetMm: groundMm + liftMm });
    return groundMm;
  };

  /**
   * A hollow with a raised lip.
   *
   * Order matters and does the work of a ring stamp we would otherwise need:
   * the berm is laid down over the whole disc first, then the floor overwrites
   * its interior, leaving the lip standing as a rim. Both falloffs are band
   * limited, so the wall is the steepest thing here at roughly 25-30 degrees
   * — dramatic to look at, still climbable, no authored ramp required.
   */
  const denAt = (
    x: number,
    z: number,
    groundMm: number,
    floorRadiusMm: number,
    floorMm: number,
    bermMm: number,
  ): void => {
    if (insideHighland(x, z, draft)) {
      return;
    }
    const wallMm = bandLimitEdge(0);
    if (bermMm !== 0) {
      bowls.push({
        x,
        z,
        radiusMm: floorRadiusMm + wallMm + 3_000,
        edgeMm: wallMm,
        targetMm: groundMm + bermMm,
      });
    }
    bowls.push({
      x,
      z,
      radiusMm: floorRadiusMm,
      edgeMm: wallMm,
      targetMm: groundMm + floorMm,
    });
  };

  // 24 伏石圈 read as raised daises rather than discs pressed into the ground:
  // a flat lifted pad for the stones, ringed by a shallow worn trench.
  for (const rock of MAP_ROCKS) {
    const groundMm = terraceAt(rock.position.x, rock.position.z, 7_000, 8_000, ROCK_PAD_LIFT_MM);
    bowls.push({
      x: rock.position.x,
      z: rock.position.z,
      radiusMm: 10_500,
      edgeMm: bandLimitEdge(0),
      targetMm: groundMm + ROCK_MOAT_MM,
    });
    bowls.push({
      x: rock.position.x,
      z: rock.position.z,
      radiusMm: 7_000,
      edgeMm: bandLimitEdge(0),
      targetMm: groundMm + ROCK_PAD_LIFT_MM,
    });
  }

  // 48 nests become real bowls with a lip. Depth grows toward the inner band
  // so a player can read how dangerous a den is from its silhouette alone.
  for (const nest of MAP_NESTS) {
    const inner = nest.band === '内';
    const mid = nest.band === '中';
    const floorRadiusMm = inner ? 8_000 : mid ? 7_000 : 6_000;
    const centre = denCentreMm(nest.base, floorRadiusMm);
    const groundMm = terraceAt(centre.x, centre.z, inner ? 12_000 : mid ? 10_500 : 9_000, 8_000);
    denAt(
      centre.x,
      centre.z,
      groundMm,
      floorRadiusMm,
      inner ? -4_000 : mid ? -2_800 : -1_800,
      inner ? 1_200 : mid ? 900 : 600,
    );
  }
  for (const pig of MAP_PIGS) {
    const centre = denCentreMm(pig.position, 6_500);
    const groundMm = terraceAt(centre.x, centre.z, 12_000, 8_000);
    denAt(centre.x, centre.z, groundMm, 6_500, -2_200, 700);
  }

  // Boss sites stop being flat discs and become arenas: a sunken floor walled
  // by its own rim, which is what makes them legible from outside.
  for (const dragon of MAP_DRAGONS) {
    const groundMm = terraceAt(dragon.position.x, dragon.position.z, 14_500, 8_000);
    denAt(dragon.position.x, dragon.position.z, groundMm, 16_000, -5_000, 2_000);
  }
  for (const elite of MAP_ELITES) {
    const groundMm = terraceAt(elite.position.x, elite.position.z, 12_500, 8_000);
    denAt(elite.position.x, elite.position.z, groundMm, 13_000, -3_500, 1_500);
  }
  stamps = { ...draft, features, bowls };
  return stamps;
}

function heightBeforeFeatures(xMm: number, zMm: number, index: StampIndex): number {
  let height = baseHeightMm(xMm, zMm);
  height = applyCircleStamps(height, xMm, zMm, index.shopPads);
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

function medianOf(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : Math.trunc(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

function clampToBand(value: number, centre: number, bandMm: number): number {
  return Math.max(centre - bandMm, Math.min(centre + bandMm, value));
}

function stampWeight(distanceMm: number, innerMm: number, edgeMm: number): number {
  if (distanceMm <= innerMm) {
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
  const point = { x: xMm, z: zMm };
  // Corridors overlap wherever routes meet. Blending every corridor that
  // covers this point by weight keeps junctions smooth and makes the result
  // independent of traversal order; mixing them one after another instead let
  // the last corridor win outright and left steps in the road surface.
  let weightSum = 0;
  let targetSum = 0;
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
        const { distanceMm, alongPerMille } = segmentProjection(point, road.a, road.b);
        const weight = stampWeight(distanceMm, road.halfWidthMm, road.edgeMm);
        if (weight <= 0) {
          continue;
        }
        const gradedMm =
          road.targetAMm + Math.trunc(((road.targetBMm - road.targetAMm) * alongPerMille) / 1_000);
        weightSum += weight;
        targetSum += weight * (gradedMm + ROAD_CAMBER_MM);
      }
    }
  }
  if (weightSum <= 0) {
    return height;
  }
  return mixToward(height, Math.trunc(targetSum / weightSum), Math.min(1_000, weightSum));
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

/** Distance to a segment plus how far along it the closest point lies, in per mille. */
function segmentProjection(
  point: MapPointMm,
  start: MapPointMm,
  end: MapPointMm,
): { distanceMm: number; alongPerMille: number } {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared === 0) {
    const dx = point.x - start.x;
    const dz = point.z - start.z;
    return { distanceMm: isqrt(dx * dx + dz * dz), alongPerMille: 0 };
  }
  const projection = Math.max(
    0,
    Math.min(lengthSquared, (point.x - start.x) * deltaX + (point.z - start.z) * deltaZ),
  );
  const closestX = start.x + Math.trunc((deltaX * projection) / lengthSquared);
  const closestZ = start.z + Math.trunc((deltaZ * projection) / lengthSquared);
  const dx = point.x - closestX;
  const dz = point.z - closestZ;
  return {
    distanceMm: isqrt(dx * dx + dz * dz),
    alongPerMille: Math.trunc((projection * 1_000) / lengthSquared),
  };
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
