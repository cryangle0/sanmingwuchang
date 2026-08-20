/**
 * Compiles the canonical 840m map engineering JSON into typed integer-mm
 * geometry for the sim, the renderer, and the Unity catalog.
 *
 * Usage: tsx tools/map/compile-map-geometry.ts
 *
 * Walls are decomposed into convex pieces (ear clipping + greedy convex
 * merge). The compiler hard-fails on area drift, non-convex output, spawn
 * points inside solids, or record-count drift against the authoritative map.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MapCollisionField } from '@jwgb/sim';
import {
  type CanonicalMapDocument,
  type CanonicalTraversalFlag,
  degreesToMillidegrees,
  loadCanonicalMap,
  metersPointToMm,
  metersToMm,
  pixelPointToMm,
} from './canonical-map';
import { mergeTrianglesIntoConvexPieces } from './convex-merge';
import {
  type CompilePoint,
  crossOrientation,
  doubledSignedArea,
  ensureCounterClockwise,
  isConvexRing,
  simplifyRing,
} from './polygon-math';
import { triangulateRing } from './triangulate';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '..', '..');
const CANONICAL_PATH = resolve(
  REPO_ROOT,
  'migration',
  'content',
  'map-engineering-840-canonical.json',
);
const OUTPUT_PATH = resolve(REPO_ROOT, 'packages', 'content', 'src', 'map-geometry.generated.ts');
const AUTHORITY_PATH = resolve(REPO_ROOT, 'migration', 'content', 'map-authority-v1.json');

const EXPECTED_COUNTS = {
  routeNodes: 199,
  routeEdges: 342,
  walls: 42,
  highlands: 3,
  shops: 48,
  spawnPoints: 30,
  courts: 3,
  pigs: 12,
  dragons: 5,
  elites: 4,
  rocks: 24,
  monsterSlots: 108,
  nests: 48,
  chests: 167,
} as const;

/**
 * Per-class traversal contract, transcribed from the map source and from
 * 02_百眼迷城_地图工程真源_v2.txt section 4:
 * 外圈 8 组 = 封界级（不可闪现/不可飞越）, 中圈 12 组 = 可越障级（闪现/飞行可过）.
 *
 * The compiler asserts every canonical wall agrees with its class entry, so a
 * wall can never silently change traversal rules by having its height edited.
 */
const WALL_TRAVERSAL = {
  BOUND: { blink: 'DENY', fly: 'DENY' },
  VAULT: { blink: 'ALLOW', fly: 'ALLOW' },
} as const satisfies Record<string, { blink: CanonicalTraversalFlag; fly: CanonicalTraversalFlag }>;

type WallClass = keyof typeof WALL_TRAVERSAL;

function isKnownWallClass(value: string): value is WallClass {
  return Object.hasOwn(WALL_TRAVERSAL, value);
}

interface CompiledPiece {
  readonly pieceId: string;
  readonly wallId: string;
  readonly wallClass: string;
  readonly heightMm: number;
  /** A blink may terminate beyond this piece. */
  readonly blinkPassable: boolean;
  /** A flying actor may cross this piece, subject to its own height budget. */
  readonly flightPassable: boolean;
  readonly vertices: readonly CompilePoint[];
}

function fail(message: string): never {
  throw new Error(`compile-map-geometry: ${message}`);
}

function requireCount(name: string, actual: number, expected: number): void {
  if (actual !== expected) {
    fail(`${name}: expected ${expected}, got ${actual}`);
  }
}

function toMmRing(points: readonly (readonly [number, number])[]): CompilePoint[] {
  return simplifyRing(ensureCounterClockwise(points.map(metersPointToMm)));
}

function decomposeWall(wall: CanonicalMapDocument['walls'][number]): readonly CompilePoint[][] {
  const ring = toMmRing(wall.pts);
  if (ring.length < 3) {
    fail(`${wall.id}: degenerate ring after integerization`);
  }
  const triangles = triangulateRing(ring);
  const indexPieces = mergeTrianglesIntoConvexPieces(ring, triangles);
  const pieces = indexPieces.map((indices) =>
    simplifyRing(indices.map((index) => ring[index] as CompilePoint)),
  );

  const ringArea = doubledSignedArea(ring);
  let pieceArea = 0;
  for (const piece of pieces) {
    if (!isConvexRing(piece)) {
      fail(`${wall.id}: non-convex piece emitted`);
    }
    const area = doubledSignedArea(piece);
    if (area <= 0) {
      fail(`${wall.id}: non-positive piece area ${area}`);
    }
    pieceArea += area;
  }
  if (pieceArea !== ringArea) {
    fail(`${wall.id}: area drift ${pieceArea} != ${ringArea}`);
  }
  return pieces;
}

/** Even-odd containment for validation of a possibly concave CCW ring. */
function ringContainsPoint(ring: readonly CompilePoint[], point: CompilePoint): boolean {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] as CompilePoint;
    const b = ring[(index + 1) % ring.length] as CompilePoint;
    const crossesZ = a.z > point.z !== b.z > point.z;
    if (!crossesZ) {
      continue;
    }
    const intersectX = a.x + ((point.z - a.z) * (b.x - a.x)) / (b.z - a.z);
    if (point.x < intersectX) {
      inside = !inside;
    }
  }
  return inside;
}

function convexContainsPoint(vertices: readonly CompilePoint[], point: CompilePoint): boolean {
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index] as CompilePoint;
    const b = vertices[(index + 1) % vertices.length] as CompilePoint;
    if (crossOrientation(a, b, point) < 0) {
      return false;
    }
  }
  return true;
}

const canonical = loadCanonicalMap(CANONICAL_PATH);

requireCount('route nodes', Object.keys(canonical.nodes).length, EXPECTED_COUNTS.routeNodes);
requireCount('route edges', canonical.edges.length, EXPECTED_COUNTS.routeEdges);
requireCount('walls', canonical.walls.length, EXPECTED_COUNTS.walls);
requireCount('highlands', canonical.highlands.length, EXPECTED_COUNTS.highlands);
requireCount('shops', canonical.shops_micro.length, EXPECTED_COUNTS.shops);
requireCount('spawn points', canonical.spawn_micro.length, EXPECTED_COUNTS.spawnPoints);
requireCount('courts', Object.keys(canonical.courts).length, EXPECTED_COUNTS.courts);
requireCount('pigs', canonical.pigs.length, EXPECTED_COUNTS.pigs);
requireCount('dragons', canonical.dragons.length, EXPECTED_COUNTS.dragons);
requireCount('elites', canonical.elites.length, EXPECTED_COUNTS.elites);
requireCount('rocks', canonical.rocks.length, EXPECTED_COUNTS.rocks);
requireCount('monster slots', canonical.monster_slots.length, EXPECTED_COUNTS.monsterSlots);
requireCount('nests', canonical.nests.length, EXPECTED_COUNTS.nests);
requireCount('chests', canonical.chest_pool.length, EXPECTED_COUNTS.chests);

const boundary = toMmRing(canonical.boundary);
if (boundary.length < 3) {
  fail('boundary: degenerate ring');
}
const boundaryTriangles = triangulateRing(boundary);

const routeNodes = Object.entries(canonical.nodes)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([id, point]) => ({
    id,
    position: metersPointToMm(point),
  }));

const routeEdges = canonical.edges.map((edge) => ({
  id: edge.id,
  a: edge.a,
  b: edge.b,
  roadClass: edge.cls,
  widthMm: metersToMm(edge.width),
  lengthMm: metersToMm(edge.length),
}));

const routeNodeIds = new Set(routeNodes.map((node) => node.id));
const routeEdgeIds = new Set<string>();
const routePairs = new Set<string>();
for (const edge of routeEdges) {
  if (routeEdgeIds.has(edge.id)) {
    fail(`route edge ${edge.id}: duplicate id`);
  }
  routeEdgeIds.add(edge.id);
  if (!routeNodeIds.has(edge.a) || !routeNodeIds.has(edge.b)) {
    fail(`route edge ${edge.id}: missing endpoint`);
  }
  if (edge.a === edge.b) {
    fail(`route edge ${edge.id}: self-loop`);
  }
  const pair = [edge.a, edge.b].sort().join('|');
  if (routePairs.has(pair)) {
    fail(`route edge ${edge.id}: duplicate undirected endpoint pair ${pair}`);
  }
  routePairs.add(pair);
}

const safeCirclePhases = (canonical.meta.safe_circle?.phases ?? []).map((phase) => ({
  startMinutes: phase.t0,
  endMinutes: phase.t1,
  radiusMm: metersToMm(phase.r),
  center: phase.center,
  windowCandidatesSeconds: [...(phase.window_candidates ?? [])],
}));

const wallPieces: CompiledPiece[] = [];
const wallIds = new Set<string>();
for (const wall of canonical.walls) {
  if (wallIds.has(wall.id)) {
    fail(`wall ${wall.id}: duplicate id`);
  }
  wallIds.add(wall.id);

  if (!isKnownWallClass(wall.cls)) {
    fail(`wall ${wall.id}: unknown class ${wall.cls}; add it to WALL_TRAVERSAL first`);
  }
  const traversal = WALL_TRAVERSAL[wall.cls];
  if (wall.blink !== traversal.blink || wall.fly !== traversal.fly) {
    fail(
      `wall ${wall.id}: class ${wall.cls} requires blink=${traversal.blink} fly=${traversal.fly}, ` +
        `canonical has blink=${wall.blink} fly=${wall.fly}`,
    );
  }

  const pieces = decomposeWall(wall);
  pieces.forEach((vertices, pieceIndex) => {
    wallPieces.push({
      pieceId: `${wall.id}#${pieceIndex.toString().padStart(2, '0')}`,
      wallId: wall.id,
      wallClass: wall.cls,
      heightMm: metersToMm(wall.height),
      blinkPassable: traversal.blink === 'ALLOW',
      flightPassable: traversal.fly === 'ALLOW',
      vertices,
    });
  });
}

const highlands = canonical.highlands.map((highland) => {
  const vertices = toMmRing(highland.poly);
  return {
    name: highland.name,
    topHeightMm: metersToMm(highland.z),
    overlookRangeMm: metersToMm(highland.overlook_m),
    vertices,
    triangles: triangulateRing(vertices),
    ramps: highland.ramps.map((ramp) => ({
      a: metersPointToMm(ramp[0] as readonly [number, number]),
      b: metersPointToMm(ramp[1] as readonly [number, number]),
    })),
  };
});

const spawnPoints = canonical.spawn_micro.map((spawn) => {
  const radians = (spawn.facing_deg * Math.PI) / 180;
  return {
    id: spawn.id,
    zone: spawn.zone,
    facingMillidegrees: degreesToMillidegrees(spawn.facing_deg),
    facing: {
      x: Math.round(Math.cos(radians) * 1_000),
      z: Math.round(Math.sin(radians) * 1_000),
    },
    position: metersPointToMm(spawn.pos),
  };
});

/**
 * Player capsule radius; mirrors M0_RULES.playerCapsuleRadiusMm without
 * importing generated content that this compiler is about to overwrite.
 */
const PLAYER_RADIUS_MM = 450;
const SPAWN_NUDGE_STEP_MM = 100;
const SPAWN_NUDGE_LIMIT = 40;

const provisionalField = new MapCollisionField('compile', boundary, wallPieces);
const spawnAdjustments: string[] = [];
for (let index = 0; index < spawnPoints.length; index += 1) {
  const spawn = spawnPoints[index] as (typeof spawnPoints)[number];
  let { x, z } = spawn.position;
  let nudges = 0;
  while (
    (!provisionalField.isCircleInsideBoundary({ x, z }, PLAYER_RADIUS_MM) ||
      provisionalField.circleTouchesWall({ x, z }, PLAYER_RADIUS_MM)) &&
    nudges < SPAWN_NUDGE_LIMIT
  ) {
    // Deterministic inward nudge toward the map origin.
    const length = Math.max(1, Math.round(Math.sqrt(x * x + z * z)));
    x -= Math.round((x * SPAWN_NUDGE_STEP_MM) / length);
    z -= Math.round((z * SPAWN_NUDGE_STEP_MM) / length);
    nudges += 1;
  }
  if (
    !provisionalField.isCircleInsideBoundary({ x, z }, PLAYER_RADIUS_MM) ||
    provisionalField.circleTouchesWall({ x, z }, PLAYER_RADIUS_MM)
  ) {
    fail(`spawn ${spawn.id} illegal even after ${SPAWN_NUDGE_LIMIT} inward nudges`);
  }
  if (nudges > 0) {
    spawnAdjustments.push(`${spawn.id}: nudged ${nudges * SPAWN_NUDGE_STEP_MM} mm inward`);
    spawnPoints[index] = { ...spawn, position: { x, z } };
  }
}

for (const spawn of spawnPoints) {
  if (!ringContainsPoint(boundary, spawn.position)) {
    fail(`spawn ${spawn.id} outside boundary`);
  }
  for (const piece of wallPieces) {
    if (convexContainsPoint(piece.vertices, spawn.position)) {
      fail(`spawn ${spawn.id} inside wall piece ${piece.pieceId}`);
    }
  }
}

const courts = Object.entries(canonical.courts).map(([id, court]) => ({
  id,
  center: metersPointToMm(court.center),
  hexVertices: toMmRing(court.hex),
  gates: court.gates.map(metersPointToMm),
  finalShops: court.final_shops.map(metersPointToMm),
  revivePoints: court.revives.map(metersPointToMm),
  rockPoints: court.rocks.map(metersPointToMm),
}));

const shops = canonical.shops_micro.map((shop) => ({
  id: shop.id,
  macroId: shop.macro,
  position: metersPointToMm(shop.pos),
}));

const pigs = canonical.pigs.map((record) => ({
  id: record.id,
  position: metersPointToMm(record.pos),
}));
const dragons = canonical.dragons.map((record) => ({
  id: record.id,
  position: metersPointToMm(record.pos),
}));
const elites = canonical.elites.map((record) => ({
  id: record.id,
  position: metersPointToMm(record.pos),
}));
const rocks = canonical.rocks.map((record) => ({
  id: record.id,
  radiusMm: metersToMm(record.r),
  position: metersPointToMm(record.pos),
}));
const monsterSlots = canonical.monster_slots.map((slot) => ({
  id: slot.id,
  kind: slot.kind,
  band: slot.band,
  nestId: slot.nest,
  position: metersPointToMm(slot.pos),
  migration: slot.migration.map(metersPointToMm),
}));
const monsterSlotRadiusMm: Readonly<Record<string, number>> = {
  MEL: 500,
  RNG: 500,
  FLY: 400,
};
for (const slot of monsterSlots) {
  const radiusMm = monsterSlotRadiusMm[slot.kind];
  if (radiusMm === undefined) {
    fail(`monster slot ${slot.id}: unsupported kind ${slot.kind}`);
  }
  if (
    !provisionalField.isCircleInsideBoundary(slot.position, radiusMm) ||
    provisionalField.circleTouchesWall(slot.position, radiusMm)
  ) {
    fail(
      `monster slot ${slot.id}: position (${slot.position.x}, ${slot.position.z}) ` +
        `is blocked for ${slot.kind} radius ${radiusMm} mm`,
    );
  }
}
const nests = canonical.nests.map((nest) => ({
  id: nest.id,
  kind: nest.kind,
  band: nest.band,
  base: pixelPointToMm(nest.base, canonical.meta),
  slotIds: [...nest.slots],
}));
const chests = canonical.chest_pool.map((point, index) => ({
  id: `C${index.toString().padStart(3, '0')}`,
  position: metersPointToMm(point),
}));
const chokes = canonical.chokes.map((point, index) => ({
  id: `K${index.toString().padStart(2, '0')}`,
  position: metersPointToMm(point),
}));

const payload = {
  routeNodes,
  routeEdges,
  boundary,
  wallPieces,
  highlands,
  safeCirclePhases,
  spawnPoints,
  courts,
  shops,
  pigs,
  dragons,
  elites,
  rocks,
  monsterSlots,
  nests,
  nestLinks: canonical.nest_links,
  chests,
  chokes,
};
const geometryHash = createHash('sha256')
  .update(JSON.stringify(payload))
  .digest('hex')
  .slice(0, 16);

const output = `// Generated by tools/map/compile-map-geometry.ts. Do not edit.
import type {
  MapConvexPieceRecord,
  MapCourtRecord,
  MapHighlandRecord,
  MapMonsterSlotRecord,
  MapNamedPointRecord,
  MapNestRecord,
  MapPointMm,
  MapRockRecord,
  MapRouteEdgeRecord,
  MapRouteNodeRecord,
  MapSafeCirclePhaseRecord,
  MapShopRecord,
  MapSpawnPointRecord,
} from './map-geometry-types';

export const MAP_GEOMETRY_SCHEMA = 'jwgb.map-geometry.v1';

/** Radius of the initial safe circle (meta.safe_circle.initial_diameter / 2). */
export const MAP_INITIAL_SAFE_RADIUS_MM = ${metersToMm((canonical.meta as { safe_circle?: { initial_diameter?: number } }).safe_circle?.initial_diameter ?? 1_040) / 2};

/** Stable digest of every payload below; feeds the state hash when the map is enabled. */
export const MAP_GEOMETRY_HASH = '${geometryHash}';

export const MAP_ROUTE_NODES = ${JSON.stringify(routeNodes)} as const satisfies readonly MapRouteNodeRecord[];

export const MAP_ROUTE_EDGES = ${JSON.stringify(routeEdges)} as const satisfies readonly MapRouteEdgeRecord[];

export const MAP_BOUNDARY = ${JSON.stringify(boundary)} as const satisfies readonly MapPointMm[];

/** Ear-clip triangulation of the boundary ring (index triples, sim-CCW). */
export const MAP_BOUNDARY_TRIANGLES = ${JSON.stringify(boundaryTriangles)} as const satisfies readonly (readonly [number, number, number])[];

export const MAP_WALL_PIECES = ${JSON.stringify(wallPieces)} as const satisfies readonly MapConvexPieceRecord[];

export const MAP_HIGHLANDS = ${JSON.stringify(highlands)} as const satisfies readonly MapHighlandRecord[];

export const MAP_SAFE_CIRCLE_PHASES = ${JSON.stringify(safeCirclePhases)} as const satisfies readonly MapSafeCirclePhaseRecord[];

export const MAP_SPAWN_POINTS = ${JSON.stringify(spawnPoints)} as const satisfies readonly MapSpawnPointRecord[];

export const MAP_COURTS = ${JSON.stringify(courts)} as const satisfies readonly MapCourtRecord[];

export const MAP_SHOPS = ${JSON.stringify(shops)} as const satisfies readonly MapShopRecord[];

export const MAP_PIGS = ${JSON.stringify(pigs)} as const satisfies readonly MapNamedPointRecord[];

export const MAP_DRAGONS = ${JSON.stringify(dragons)} as const satisfies readonly MapNamedPointRecord[];

export const MAP_ELITES = ${JSON.stringify(elites)} as const satisfies readonly MapNamedPointRecord[];

export const MAP_ROCKS = ${JSON.stringify(rocks)} as const satisfies readonly MapRockRecord[];

export const MAP_MONSTER_SLOTS = ${JSON.stringify(monsterSlots)} as const satisfies readonly MapMonsterSlotRecord[];

export const MAP_NESTS = ${JSON.stringify(nests)} as const satisfies readonly MapNestRecord[];

export const MAP_NEST_LINKS = ${JSON.stringify(canonical.nest_links)} as const satisfies readonly (readonly [string, string])[];

export const MAP_CHESTS = ${JSON.stringify(chests)} as const satisfies readonly MapNamedPointRecord[];

export const MAP_CHOKES = ${JSON.stringify(chokes)} as const satisfies readonly MapNamedPointRecord[];
`;

writeFileSync(OUTPUT_PATH, output, 'utf8');

const UNITY_OUTPUT_PATH = resolve(
  REPO_ROOT,
  'unity',
  'Packages',
  'com.jwgb.content',
  'Runtime',
  'MapGeometryCatalog.g.cs',
);

function csharpPoint(point: CompilePoint): string {
  return `new MapPointMmRecord(${point.x}, ${point.z})`;
}

function csharpStringArray(values: readonly string[]): string {
  return `new string[] { ${values.map((value) => JSON.stringify(value)).join(', ')} }`;
}

function csharpPointArray(points: readonly { readonly x: number; readonly z: number }[]): string {
  return `new MapPointMmRecord[] { ${points.map(csharpPoint).join(', ')} }`;
}

function csharpIntArray(values: readonly number[]): string {
  return `new int[] { ${values.join(', ')} }`;
}

const csharpRouteNodes = routeNodes
  .map(
    (node) =>
      `            new MapRouteNodeGeometryRecord(${JSON.stringify(node.id)}, ${csharpPoint(
        node.position,
      )})`,
  )
  .join(',\n');
const csharpRouteEdges = routeEdges
  .map(
    (edge) =>
      `            new MapRouteEdgeGeometryRecord(${JSON.stringify(edge.id)}, ${JSON.stringify(
        edge.a,
      )}, ${JSON.stringify(edge.b)}, ${JSON.stringify(edge.roadClass)}, ${
        edge.widthMm
      }, ${edge.lengthMm})`,
  )
  .join(',\n');
const csharpPieces = wallPieces
  .map(
    (piece) =>
      `            new MapConvexPieceGeometryRecord(${JSON.stringify(piece.pieceId)}, ${JSON.stringify(
        piece.wallId,
      )}, ${JSON.stringify(piece.wallClass)}, ${piece.heightMm}, ${
        piece.blinkPassable ? 'true' : 'false'
      }, ${piece.flightPassable ? 'true' : 'false'}, new MapPointMmRecord[] { ${piece.vertices
        .map(csharpPoint)
        .join(', ')} })`,
  )
  .join(',\n');
const csharpSpawns = spawnPoints
  .map(
    (spawn) =>
      `            new MapSpawnPointGeometryRecord(${JSON.stringify(spawn.id)}, ${JSON.stringify(
        spawn.zone,
      )}, ${spawn.facingMillidegrees}, ${csharpPoint(spawn.facing)}, ${csharpPoint(spawn.position)})`,
  )
  .join(',\n');
const csharpHighlands = highlands
  .map((highland) => {
    const triangles = highland.triangles.flatMap((triangle) => [...triangle]);
    const ramps = highland.ramps
      .map((ramp) => `new MapRampGeometryRecord(${csharpPoint(ramp.a)}, ${csharpPoint(ramp.b)})`)
      .join(', ');
    return `            new MapHighlandGeometryRecord(${JSON.stringify(
      highland.name,
    )}, ${highland.topHeightMm}, ${highland.overlookRangeMm}, ${csharpPointArray(
      highland.vertices,
    )}, ${csharpIntArray(triangles)}, new MapRampGeometryRecord[] { ${ramps} })`;
  })
  .join(',\n');
const csharpSafeCirclePhases = safeCirclePhases
  .map(
    (phase) =>
      `            new MapSafeCirclePhaseGeometryRecord(${phase.startMinutes}, ${
        phase.endMinutes ?? 0
      }, ${phase.endMinutes === null}, ${phase.radiusMm}, ${JSON.stringify(
        phase.center,
      )}, ${csharpIntArray(phase.windowCandidatesSeconds)})`,
  )
  .join(',\n');
const csharpCourts = courts
  .map(
    (court) =>
      `            new MapCourtGeometryRecord(${JSON.stringify(
        court.id,
      )}, ${csharpPoint(court.center)}, ${csharpPointArray(
        court.hexVertices,
      )}, ${csharpPointArray(court.gates)}, ${csharpPointArray(
        court.finalShops,
      )}, ${csharpPointArray(court.revivePoints)}, ${csharpPointArray(court.rockPoints)})`,
  )
  .join(',\n');
const csharpNamedPoints = (
  records: readonly {
    readonly id: string;
    readonly position: CompilePoint;
  }[],
): string =>
  records
    .map(
      (record) =>
        `            new MapNamedPointGeometryRecord(${JSON.stringify(
          record.id,
        )}, ${csharpPoint(record.position)})`,
    )
    .join(',\n');
const csharpShops = shops
  .map(
    (shop) =>
      `            new MapShopGeometryRecord(${JSON.stringify(
        shop.id,
      )}, ${JSON.stringify(shop.macroId)}, ${csharpPoint(shop.position)})`,
  )
  .join(',\n');
const csharpRocks = rocks
  .map(
    (rock) =>
      `            new MapRockGeometryRecord(${JSON.stringify(
        rock.id,
      )}, ${rock.radiusMm}, ${csharpPoint(rock.position)})`,
  )
  .join(',\n');
const csharpMonsterSlots = monsterSlots
  .map(
    (slot) =>
      `            new MapMonsterSlotGeometryRecord(${JSON.stringify(
        slot.id,
      )}, ${JSON.stringify(slot.kind)}, ${JSON.stringify(
        slot.band,
      )}, ${JSON.stringify(slot.nestId)}, ${csharpPoint(
        slot.position,
      )}, ${csharpPointArray(slot.migration)})`,
  )
  .join(',\n');
const csharpNests = nests
  .map(
    (nest) =>
      `            new MapNestGeometryRecord(${JSON.stringify(
        nest.id,
      )}, ${JSON.stringify(nest.kind)}, ${JSON.stringify(
        nest.band,
      )}, ${csharpPoint(nest.base)}, ${csharpStringArray(nest.slotIds)})`,
  )
  .join(',\n');
const csharpNestLinks = canonical.nest_links
  .map(
    (link) =>
      `            new MapStringPairGeometryRecord(${JSON.stringify(
        link[0],
      )}, ${JSON.stringify(link[1])})`,
  )
  .join(',\n');
const csharpChests = csharpNamedPoints(chests);
const csharpChokes = csharpNamedPoints(chokes);
const csharpBoundary = boundary.map(csharpPoint).join(',\n            ');
const csharpBoundaryTriangles = boundaryTriangles
  .map((triangle) => triangle.join(', '))
  .join(',\n            ');

const unityCatalog = `// Generated by tools/map/compile-map-geometry.ts. Do not edit.
namespace Jwgb.Content
{
    public readonly struct MapPointMmRecord
    {
        public MapPointMmRecord(long x, long z)
        {
            X = x;
            Z = z;
        }

        public long X { get; }
        public long Z { get; }
    }

    public readonly struct MapRouteNodeGeometryRecord
    {
        public MapRouteNodeGeometryRecord(string id, MapPointMmRecord position)
        {
            Id = id;
            Position = position;
        }

        public string Id { get; }
        public MapPointMmRecord Position { get; }
    }

    public readonly struct MapRouteEdgeGeometryRecord
    {
        public MapRouteEdgeGeometryRecord(
            string id,
            string a,
            string b,
            string roadClass,
            long widthMm,
            long lengthMm)
        {
            Id = id;
            A = a;
            B = b;
            RoadClass = roadClass;
            WidthMm = widthMm;
            LengthMm = lengthMm;
        }

        public string Id { get; }
        public string A { get; }
        public string B { get; }
        public string RoadClass { get; }
        public long WidthMm { get; }
        public long LengthMm { get; }
    }

    public readonly struct MapRampGeometryRecord
    {
        public MapRampGeometryRecord(
            MapPointMmRecord a,
            MapPointMmRecord b)
        {
            A = a;
            B = b;
        }

        public MapPointMmRecord A { get; }
        public MapPointMmRecord B { get; }
    }

    public readonly struct MapHighlandGeometryRecord
    {
        public MapHighlandGeometryRecord(
            string name,
            long topHeightMm,
            long overlookRangeMm,
            MapPointMmRecord[] vertices,
            int[] triangles,
            MapRampGeometryRecord[] ramps)
        {
            Name = name;
            TopHeightMm = topHeightMm;
            OverlookRangeMm = overlookRangeMm;
            Vertices = vertices;
            Triangles = triangles;
            Ramps = ramps;
        }

        public string Name { get; }
        public long TopHeightMm { get; }
        public long OverlookRangeMm { get; }
        public MapPointMmRecord[] Vertices { get; }
        public int[] Triangles { get; }
        public MapRampGeometryRecord[] Ramps { get; }
    }

    public readonly struct MapSafeCirclePhaseGeometryRecord
    {
        public MapSafeCirclePhaseGeometryRecord(
            double startMinutes,
            double endMinutes,
            bool hasOpenEnd,
            long radiusMm,
            string center,
            int[] windowCandidatesSeconds)
        {
            StartMinutes = startMinutes;
            EndMinutes = endMinutes;
            HasOpenEnd = hasOpenEnd;
            RadiusMm = radiusMm;
            Center = center;
            WindowCandidatesSeconds = windowCandidatesSeconds;
        }

        public double StartMinutes { get; }
        public double EndMinutes { get; }
        public bool HasOpenEnd { get; }
        public long RadiusMm { get; }
        public string Center { get; }
        public int[] WindowCandidatesSeconds { get; }
    }

    public readonly struct MapConvexPieceGeometryRecord
    {
        public MapConvexPieceGeometryRecord(
            string pieceId,
            string wallId,
            string wallClass,
            long heightMm,
            bool blinkPassable,
            bool flightPassable,
            MapPointMmRecord[] vertices)
        {
            PieceId = pieceId;
            WallId = wallId;
            WallClass = wallClass;
            HeightMm = heightMm;
            BlinkPassable = blinkPassable;
            FlightPassable = flightPassable;
            Vertices = vertices;
        }

        public string PieceId { get; }
        public string WallId { get; }
        public string WallClass { get; }
        public long HeightMm { get; }
        public bool BlinkPassable { get; }
        public bool FlightPassable { get; }
        public MapPointMmRecord[] Vertices { get; }
    }

    public readonly struct MapSpawnPointGeometryRecord
    {
        public MapSpawnPointGeometryRecord(
            string id,
            string zone,
            long facingMillidegrees,
            MapPointMmRecord facing,
            MapPointMmRecord position)
        {
            Id = id;
            Zone = zone;
            FacingMillidegrees = facingMillidegrees;
            Facing = facing;
            Position = position;
        }

        public string Id { get; }
        public string Zone { get; }
        public long FacingMillidegrees { get; }
        public MapPointMmRecord Facing { get; }
        public MapPointMmRecord Position { get; }
    }

    public readonly struct MapCourtGeometryRecord
    {
        public MapCourtGeometryRecord(
            string id,
            MapPointMmRecord center,
            MapPointMmRecord[] hexVertices,
            MapPointMmRecord[] gates,
            MapPointMmRecord[] finalShops,
            MapPointMmRecord[] revivePoints,
            MapPointMmRecord[] rockPoints)
        {
            Id = id;
            Center = center;
            HexVertices = hexVertices;
            Gates = gates;
            FinalShops = finalShops;
            RevivePoints = revivePoints;
            RockPoints = rockPoints;
        }

        public string Id { get; }
        public MapPointMmRecord Center { get; }
        public MapPointMmRecord[] HexVertices { get; }
        public MapPointMmRecord[] Gates { get; }
        public MapPointMmRecord[] FinalShops { get; }
        public MapPointMmRecord[] RevivePoints { get; }
        public MapPointMmRecord[] RockPoints { get; }
    }

    public readonly struct MapNamedPointGeometryRecord
    {
        public MapNamedPointGeometryRecord(
            string id,
            MapPointMmRecord position)
        {
            Id = id;
            Position = position;
        }

        public string Id { get; }
        public MapPointMmRecord Position { get; }
    }

    public readonly struct MapShopGeometryRecord
    {
        public MapShopGeometryRecord(
            string id,
            string macroId,
            MapPointMmRecord position)
        {
            Id = id;
            MacroId = macroId;
            Position = position;
        }

        public string Id { get; }
        public string MacroId { get; }
        public MapPointMmRecord Position { get; }
    }

    public readonly struct MapRockGeometryRecord
    {
        public MapRockGeometryRecord(
            string id,
            long radiusMm,
            MapPointMmRecord position)
        {
            Id = id;
            RadiusMm = radiusMm;
            Position = position;
        }

        public string Id { get; }
        public long RadiusMm { get; }
        public MapPointMmRecord Position { get; }
    }

    public readonly struct MapMonsterSlotGeometryRecord
    {
        public MapMonsterSlotGeometryRecord(
            string id,
            string kind,
            string band,
            string nestId,
            MapPointMmRecord position,
            MapPointMmRecord[] migration)
        {
            Id = id;
            Kind = kind;
            Band = band;
            NestId = nestId;
            Position = position;
            Migration = migration;
        }

        public string Id { get; }
        public string Kind { get; }
        public string Band { get; }
        public string NestId { get; }
        public MapPointMmRecord Position { get; }
        public MapPointMmRecord[] Migration { get; }
    }

    public readonly struct MapNestGeometryRecord
    {
        public MapNestGeometryRecord(
            string id,
            string kind,
            string band,
            MapPointMmRecord basePoint,
            string[] slotIds)
        {
            Id = id;
            Kind = kind;
            Band = band;
            BasePoint = basePoint;
            SlotIds = slotIds;
        }

        public string Id { get; }
        public string Kind { get; }
        public string Band { get; }
        public MapPointMmRecord BasePoint { get; }
        public string[] SlotIds { get; }
    }

    public readonly struct MapStringPairGeometryRecord
    {
        public MapStringPairGeometryRecord(string a, string b)
        {
            A = a;
            B = b;
        }

        public string A { get; }
        public string B { get; }
    }

    public static class MapGeometryCatalog
    {
        public const string Schema = "jwgb.map-geometry.v1";
        public const string GeometryHash = "${geometryHash}";
        public const long InitialSafeRadiusMm = ${metersToMm((canonical.meta as { safe_circle?: { initial_diameter?: number } }).safe_circle?.initial_diameter ?? 1_040) / 2};

        public static readonly MapPointMmRecord[] Boundary =
        {
            ${csharpBoundary}
        };

        /// <summary>Flattened index triples into Boundary (sim-CCW).</summary>
        public static readonly int[] BoundaryTriangles =
        {
            ${csharpBoundaryTriangles}
        };

        public static readonly MapRouteNodeGeometryRecord[] RouteNodes =
        {
${csharpRouteNodes}
        };

        public static readonly MapRouteEdgeGeometryRecord[] RouteEdges =
        {
${csharpRouteEdges}
        };

        public static readonly MapConvexPieceGeometryRecord[] WallPieces =
        {
${csharpPieces}
        };

        public static readonly MapHighlandGeometryRecord[] Highlands =
        {
${csharpHighlands}
        };

        public static readonly MapSafeCirclePhaseGeometryRecord[] SafeCirclePhases =
        {
${csharpSafeCirclePhases}
        };

        public static readonly MapSpawnPointGeometryRecord[] SpawnPoints =
        {
${csharpSpawns}
        };

        public static readonly MapCourtGeometryRecord[] Courts =
        {
${csharpCourts}
        };

        public static readonly MapShopGeometryRecord[] Shops =
        {
${csharpShops}
        };

        public static readonly MapNamedPointGeometryRecord[] Pigs =
        {
${csharpNamedPoints(pigs)}
        };

        public static readonly MapNamedPointGeometryRecord[] Dragons =
        {
${csharpNamedPoints(dragons)}
        };

        public static readonly MapNamedPointGeometryRecord[] Elites =
        {
${csharpNamedPoints(elites)}
        };

        public static readonly MapRockGeometryRecord[] Rocks =
        {
${csharpRocks}
        };

        public static readonly MapMonsterSlotGeometryRecord[] MonsterSlots =
        {
${csharpMonsterSlots}
        };

        public static readonly MapNestGeometryRecord[] Nests =
        {
${csharpNests}
        };

        public static readonly MapStringPairGeometryRecord[] NestLinks =
        {
${csharpNestLinks}
        };

        public static readonly MapNamedPointGeometryRecord[] Chests =
        {
${csharpChests}
        };

        public static readonly MapNamedPointGeometryRecord[] Chokes =
        {
${csharpChokes}
        };
    }
}
`;
writeFileSync(UNITY_OUTPUT_PATH, unityCatalog, 'utf8');

// The authority ledger records human decisions, but currentGeometryHash is a
// derived fingerprint. The compiler owns it so a regenerated map can never
// leave a stale hash behind for verify-map-authority or the golden fixtures.
const authorityText = readFileSync(AUTHORITY_PATH, 'utf8');
const authorityPattern = /("currentGeometryHash":\s*")[0-9a-f]{16}(")/;
if (!authorityPattern.test(authorityText)) {
  fail(`${AUTHORITY_PATH} has no currentGeometryHash field to update`);
}
writeFileSync(
  AUTHORITY_PATH,
  authorityText.replace(authorityPattern, `$1${geometryHash}$2`),
  'utf8',
);

console.log(
  JSON.stringify(
    {
      outputPath: OUTPUT_PATH,
      geometryHash,
      boundaryVertices: boundary.length,
      walls: canonical.walls.length,
      wallPieces: wallPieces.length,
      maxPieceVertices: Math.max(...wallPieces.map((piece) => piece.vertices.length)),
      spawnPoints: spawnPoints.length,
      spawnAdjustments,
    },
    null,
    2,
  ),
);
