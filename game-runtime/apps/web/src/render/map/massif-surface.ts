import { MAP_WALL_PIECES, type MapPointMm } from '@jwgb/content';
import { groundSurfaceMeters } from './ground-surface';
import { convexContains } from './map-polygons';

/**
 * Shape of the 封界级 (BOUND) wall massifs, shared by the mesh that draws them
 * and by the dressing that has to stand on them.
 *
 * The compiled wall pieces come in two classes. VAULT pieces are broad
 * walkable hills: the terrain height field already raises them and the sim
 * lets everything cross, so they need no geometry of their own. BOUND pieces
 * are the true barriers — 6 m solid prisms that stop walking, blink and
 * flight — and this module gives each authored BOUND wall a rocky range.
 *
 * Massifs are built per authored wall rather than per convex piece. A piece
 * boundary is an artefact of the decomposition, not a feature of the terrain,
 * so raising each piece separately would produce disconnected lumps where the
 * map calls for one continuous range. Instead every wall gets one ridge line
 * spanning its longest axis, a chain of summits along it, and slopes rising to
 * that ridge from the edges of all of its pieces at once.
 *
 * The footprint is exactly the compiled polygon, so what the player sees is
 * what the sim blocks. Collision and line of sight are untouched.
 *
 * Everything here is deterministic and pure so the facets used for the mesh
 * are also the facets the height sampler answers from: grass and trees placed
 * through `massifSurfaceMeters` sit on the rock the player sees, not on the
 * flat ground buried inside it.
 */

const MM = 1_000;
/** Summit spacing along a ridge. Closer than this and peaks merge into a wall. */
const SUMMIT_PITCH_METERS = 21;
/** Height of a massif as a fraction of its own half-width. */
const HEIGHT_PER_HALF_WIDTH = 0.45;
/**
 * The camera pitch is player-controlled down to the horizon, so a range that
 * towered over the arena would hide anyone standing behind it. Tall enough to
 * read as rock the sim's 6 m wall cannot be climbed over, low enough that the
 * default chase camera still sees past the crest.
 */
const MIN_PEAK_METERS = 6;
const MAX_PEAK_METERS = 14;
/** Fraction of the peak height a saddle between two summits drops to. */
const SADDLE_DEPTH = 0.26;
/** Facet size along a footprint edge. */
const SLOPE_SEGMENT_METERS = 6;
/** Facet rows between foot and crest. */
const SLOPE_STEPS = 5;
/** Spatial hash cell for facet lookup, in metres. */
const INDEX_CELL_METERS = 4;

export interface MassifVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Ground level under this column, so colour can span the whole massif. */
  readonly footY: number;
}

export interface MassifFacet {
  readonly a: MassifVertex;
  readonly b: MassifVertex;
  readonly c: MassifVertex;
  /** Peak height of the massif this facet belongs to. */
  readonly reliefMeters: number;
}

export interface MassifModel {
  /** Number of authored BOUND walls that produced a range. */
  readonly massifs: number;
  readonly facets: readonly MassifFacet[];
}

type WallPiece = (typeof MAP_WALL_PIECES)[number];

const BOUND_PIECES: readonly WallPiece[] = MAP_WALL_PIECES.filter(
  (piece) => piece.wallClass === 'BOUND',
);
const VAULT_PIECES: readonly WallPiece[] = MAP_WALL_PIECES.filter(
  (piece) => piece.wallClass === 'VAULT',
);

/** True inside the compiled footprint of any BOUND wall piece. */
export function isInsideBoundWall(point: MapPointMm): boolean {
  return BOUND_PIECES.some((piece) => convexContains(piece.vertices, point));
}

/** True inside a walkable VAULT hill — raised terrain the sim already lets you cross. */
export function isInsideVaultWall(point: MapPointMm): boolean {
  return VAULT_PIECES.some((piece) => convexContains(piece.vertices, point));
}

/** Ground a massif stands on: the plateau top where a wall sits on a 高台. */
function footHeightMeters(x: number, z: number): number {
  return groundSurfaceMeters({ x: Math.round(x * MM), z: Math.round(z * MM) });
}

let cachedModel: MassifModel | null = null;

/** The massif facets, built once per page load; both renderer and sampler read it. */
export function massifModel(): MassifModel {
  if (cachedModel) {
    return cachedModel;
  }
  const facets: MassifFacet[] = [];
  let massifs = 0;
  for (const pieces of groupPiecesByWall().values()) {
    const ridge = ridgeOf(pieces);
    if (!ridge) {
      continue;
    }
    massifs += 1;
    for (const [a, b] of outerEdgesOf(pieces)) {
      // Subdivide along the foot and up the slope. A single quad per footprint
      // edge is a tent, not a mountain: there is nowhere for a spur or a gully
      // to live, and the flat-shaded face reads as one triangle of card.
      const runMeters = Math.hypot(b.x - a.x, b.z - a.z);
      const columns = Math.max(1, Math.round(runMeters / SLOPE_SEGMENT_METERS));
      for (let column = 0; column < columns; column += 1) {
        const left = column / columns;
        const right = (column + 1) / columns;
        for (let step = 0; step < SLOPE_STEPS; step += 1) {
          const low = step / SLOPE_STEPS;
          const high = (step + 1) / SLOPE_STEPS;
          const p = slopePoint(ridge, a, b, left, low);
          const q = slopePoint(ridge, a, b, right, low);
          const r = slopePoint(ridge, a, b, right, high);
          const s = slopePoint(ridge, a, b, left, high);
          facets.push({ a: p, b: q, c: r, reliefMeters: ridge.reliefMeters });
          facets.push({ a: p, b: r, c: s, reliefMeters: ridge.reliefMeters });
        }
      }
    }
  }
  cachedModel = { massifs, facets };
  return cachedModel;
}

let cachedIndex: Map<number, number[]> | null = null;

function indexKey(cellX: number, cellZ: number): number {
  // Cells are well inside ±32k for a map a few hundred metres across.
  return (cellX + 0x8000) * 0x10000 + (cellZ + 0x8000);
}

function facetIndex(): Map<number, number[]> {
  if (cachedIndex) {
    return cachedIndex;
  }
  const index = new Map<number, number[]>();
  const { facets } = massifModel();
  for (let id = 0; id < facets.length; id += 1) {
    const facet = facets[id] as MassifFacet;
    const minX = Math.floor(Math.min(facet.a.x, facet.b.x, facet.c.x) / INDEX_CELL_METERS);
    const maxX = Math.floor(Math.max(facet.a.x, facet.b.x, facet.c.x) / INDEX_CELL_METERS);
    const minZ = Math.floor(Math.min(facet.a.z, facet.b.z, facet.c.z) / INDEX_CELL_METERS);
    const maxZ = Math.floor(Math.max(facet.a.z, facet.b.z, facet.c.z) / INDEX_CELL_METERS);
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
        const key = indexKey(cellX, cellZ);
        const bucket = index.get(key);
        if (bucket) {
          bucket.push(id);
        } else {
          index.set(key, [id]);
        }
      }
    }
  }
  cachedIndex = index;
  return index;
}

/**
 * Height of the massif surface above a point, or null where no massif facet
 * covers it. Slopes from neighbouring footprint edges overlap at corners; the
 * visible rock is the highest one, so that is what dressing stands on.
 */
export function massifSurfaceMeters(point: MapPointMm): number | null {
  const x = point.x / MM;
  const z = point.z / MM;
  const bucket = facetIndex().get(
    indexKey(Math.floor(x / INDEX_CELL_METERS), Math.floor(z / INDEX_CELL_METERS)),
  );
  if (!bucket) {
    return null;
  }
  const { facets } = massifModel();
  let best: number | null = null;
  for (const id of bucket) {
    const y = facetHeightAt(facets[id] as MassifFacet, x, z);
    if (y !== null && (best === null || y > best)) {
      best = y;
    }
  }
  return best;
}

/** Barycentric height of a facet at (x, z), or null outside its plan projection. */
function facetHeightAt(facet: MassifFacet, x: number, z: number): number | null {
  const { a, b, c } = facet;
  const v0x = b.x - a.x;
  const v0z = b.z - a.z;
  const v1x = c.x - a.x;
  const v1z = c.z - a.z;
  const v2x = x - a.x;
  const v2z = z - a.z;
  const denominator = v0x * v1z - v1x * v0z;
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }
  const v = (v2x * v1z - v1x * v2z) / denominator;
  const w = (v0x * v2z - v2x * v0z) / denominator;
  const u = 1 - v - w;
  const slack = -1e-6;
  if (u < slack || v < slack || w < slack) {
    return null;
  }
  return u * a.y + v * b.y + w * c.y;
}

/**
 * A point on the slope between a footprint edge and the crest above it.
 *
 * `across` runs along the edge, `up` from foot to ridge. Intermediate points
 * are pushed around by noise, tapered to nothing at both ends so the crest
 * line stays sharp and the footprint stays exactly on the compiled polygon
 * the sim collides against.
 */
function slopePoint(
  ridge: Ridge,
  a: { x: number; z: number },
  b: { x: number; z: number },
  across: number,
  up: number,
): MassifVertex {
  const footX = a.x + (b.x - a.x) * across;
  const footZ = a.z + (b.z - a.z) * across;
  const crest = ridge.pointFor({ x: footX, z: footZ });
  const x = footX + (crest.x - footX) * up;
  const z = footZ + (crest.z - footZ) * up;
  const footY = footHeightMeters(footX, footZ) - 0.3;
  // Convex profile: slopes steepen near the foot and ease toward the crest,
  // which is what stops a massif reading as a pyramid.
  const climb = Math.sqrt(up);
  const y = footY + (crest.y - footY) * climb;
  const taper = Math.sin(Math.PI * up);
  const rough =
    (noise(x * 0.11, z * 0.11) - 0.5) * ridge.reliefMeters * 0.3 +
    (noise(x * 0.31, z * 0.31) - 0.5) * ridge.reliefMeters * 0.12;
  return { x, y: y + rough * taper, z, footY };
}

/**
 * Edges on the outside of a wall's footprint.
 *
 * Convex decomposition leaves seams where two pieces meet; those edges appear
 * twice, once in each direction. Raising a slope on them would build walls
 * inside the mountain, so only edges seen once are kept.
 */
function outerEdgesOf(
  pieces: readonly WallPiece[],
): readonly (readonly [{ x: number; z: number }, { x: number; z: number }])[] {
  const seen = new Map<string, number>();
  const key = (p: MapPointMm, q: MapPointMm): string =>
    p.x < q.x || (p.x === q.x && p.z <= q.z)
      ? `${p.x},${p.z}|${q.x},${q.z}`
      : `${q.x},${q.z}|${p.x},${p.z}`;
  for (const piece of pieces) {
    for (let index = 0; index < piece.vertices.length; index += 1) {
      const p = piece.vertices[index] as MapPointMm;
      const q = piece.vertices[(index + 1) % piece.vertices.length] as MapPointMm;
      const id = key(p, q);
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  const edges: (readonly [{ x: number; z: number }, { x: number; z: number }])[] = [];
  for (const piece of pieces) {
    for (let index = 0; index < piece.vertices.length; index += 1) {
      const p = piece.vertices[index] as MapPointMm;
      const q = piece.vertices[(index + 1) % piece.vertices.length] as MapPointMm;
      if ((seen.get(key(p, q)) ?? 0) === 1) {
        edges.push([toMeters(p), toMeters(q)]);
      }
    }
  }
  return edges;
}

function groupPiecesByWall(): Map<string, WallPiece[]> {
  const walls = new Map<string, WallPiece[]>();
  for (const piece of BOUND_PIECES) {
    const bucket = walls.get(piece.wallId);
    if (bucket) {
      bucket.push(piece);
    } else {
      walls.set(piece.wallId, [piece]);
    }
  }
  return walls;
}

interface Ridge {
  /** Crest point directly above the ridge line, nearest to a footprint point. */
  pointFor(point: { x: number; z: number }): { x: number; y: number; z: number };
  /** Peak height of this massif. */
  readonly reliefMeters: number;
}

/**
 * The crest line of one authored wall.
 *
 * The axis runs between the two most distant vertices of the whole wall, which
 * for the long thin polygons that divide districts is their length. Summits
 * ride that axis at a fixed pitch with saddles between, so a range reads as
 * peaks rather than as an extruded roof beam.
 */
function ridgeOf(pieces: readonly WallPiece[]): Ridge | null {
  const points: { x: number; z: number }[] = [];
  for (const piece of pieces) {
    for (const vertex of piece.vertices) {
      points.push(toMeters(vertex));
    }
  }
  if (points.length < 3) {
    return null;
  }

  let start = points[0] as { x: number; z: number };
  let end = points[0] as { x: number; z: number };
  let longest = 0;
  for (const a of points) {
    for (const b of points) {
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      if (span > longest) {
        longest = span;
        start = a;
        end = b;
      }
    }
  }
  if (longest < 1) {
    return null;
  }
  const dirX = (end.x - start.x) / longest;
  const dirZ = (end.z - start.z) / longest;

  // Half-width sets the height: a broad massif earns a tall peak, a thin
  // spur stays a rocky rib, and neither has to be authored by hand.
  let halfWidth = 0;
  for (const point of points) {
    const across = Math.abs(-(point.x - start.x) * dirZ + (point.z - start.z) * dirX);
    halfWidth = Math.max(halfWidth, across);
  }
  const reliefMeters = Math.min(
    MAX_PEAK_METERS,
    Math.max(MIN_PEAK_METERS, halfWidth * HEIGHT_PER_HALF_WIDTH),
  );
  const seed = Math.abs(Math.round(start.x * 7 + start.z * 13));

  const heightAt = (along: number): number => {
    // A cosine over the summit pitch makes peaks and saddles; the noise term
    // keeps neighbouring summits from matching each other exactly.
    const phase = (along / SUMMIT_PITCH_METERS) * Math.PI * 2;
    const crown = 1 - SADDLE_DEPTH * (0.5 - 0.5 * Math.cos(phase));
    const vary = 0.78 + 0.44 * noise(along * 0.06, seed * 0.001);
    // Taper to nothing at both ends so a range dies into the ground rather
    // than stopping at a cliff.
    const taper = Math.min(1, Math.min(along, longest - along) / 12 + 0.25);
    return reliefMeters * crown * vary * taper;
  };

  return {
    reliefMeters,
    pointFor(point) {
      const along = Math.max(
        0,
        Math.min(longest, (point.x - start.x) * dirX + (point.z - start.z) * dirZ),
      );
      const x = start.x + dirX * along;
      const z = start.z + dirZ * along;
      return { x, y: footHeightMeters(x, z) + heightAt(along), z };
    },
  };
}

function toMeters(point: MapPointMm): { x: number; z: number } {
  return { x: point.x / MM, z: point.z / MM };
}

/** Deterministic value noise in [0, 1]; ranges must rebuild identically. */
function noise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}
