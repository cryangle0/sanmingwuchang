import { MAP_WALL_PIECES, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
import * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';

/**
 * Interior barriers drawn as mountain ranges instead of masonry.
 *
 * The 72 VAULT pieces are a convex decomposition of 31 authored wall
 * polygons, extruded to a flat 2.5 m. Two things were wrong with drawing them
 * that way. They read as low blocks scattered over open country, which is not
 * what the map is: these are the ridges that divide the districts. And they
 * lied about the rules — the sim blocks line of sight through every piece
 * regardless of height, so a 2.5 m block that a character plainly towers over
 * was already cutting sightlines as if it were a mountain.
 *
 * Massifs are built per authored wall rather than per convex piece. A piece
 * boundary is an artefact of the decomposition, not a feature of the terrain,
 * so raising each piece separately would produce 72 disconnected lumps where
 * the map calls for continuous ranges. Instead every wall gets one ridge line
 * spanning its longest axis, a chain of summits along it, and slopes rising to
 * that ridge from the edges of all of its pieces at once.
 *
 * The footprint is exactly the compiled polygon, so what the player sees is
 * what the sim blocks. Collision and line of sight are untouched.
 */

const MM = 1_000;
/** Summit spacing along a ridge. Closer than this and peaks merge into a wall. */
const SUMMIT_PITCH_METERS = 21;
/** Height of a massif as a fraction of its own half-width. */
const HEIGHT_PER_HALF_WIDTH = 1.35;
const MIN_PEAK_METERS = 5;
const MAX_PEAK_METERS = 30;
/** Fraction of the peak height a saddle between two summits drops to. */
const SADDLE_DEPTH = 0.26;
/** Relative height above which rock gives way to snow. */
const SNOW_LINE_METERS = 19;
/** Facet size along a footprint edge. */
const SLOPE_SEGMENT_METERS = 6;
/** Facet rows between foot and crest. */
const SLOPE_STEPS = 5;

/** World metres per texture tile on a slope. */
const TEXTURE_METERS = 13;

// Same rule as the boundary escarpment: the low end of a ridge is shaded
// stone under an open sky, so it stays a readable cool-warm grey rather than
// sinking toward the dark olive it used to reach.
const SLOPE_LOW = new THREE.Color(0x77806a);
const SLOPE_HIGH = new THREE.Color(0xb3ae99);
const SNOW = new THREE.Color(0xdde6ea);

export function buildInteriorRidges(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): number {
  const walls = groupPiecesByWall();
  const builder = new FacetBuilder();
  let massifs = 0;

  for (const pieces of walls.values()) {
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
          builder.quad(
            slopePoint(ridge, a, b, left, low),
            slopePoint(ridge, a, b, right, low),
            slopePoint(ridge, a, b, right, high),
            slopePoint(ridge, a, b, left, high),
            ridge.reliefMeters,
          );
        }
      }
    }
  }

  if (builder.isEmpty) {
    return 0;
  }
  const mesh = new THREE.Mesh(track(builder.build()), materials.boundaryCliffFace);
  mesh.name = 'interior-ridges';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return massifs;
}

/**
 * A point on the slope between a footprint edge and the crest above it.
 *
 * `across` runs along the edge, `up` from foot to ridge. Intermediate points
 * are pushed around by noise, tapered to nothing at both ends so the crest
 * line stays sharp and the footprint stays exactly on the compiled polygon
 * the sim collides against.
 */
interface SlopePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Ground level under this column, so colour can span the whole massif. */
  readonly footY: number;
}

function slopePoint(
  ridge: Ridge,
  a: { x: number; z: number },
  b: { x: number; z: number },
  across: number,
  up: number,
): SlopePoint {
  const footX = a.x + (b.x - a.x) * across;
  const footZ = a.z + (b.z - a.z) * across;
  const crest = ridge.pointFor({ x: footX, z: footZ });
  const x = footX + (crest.x - footX) * up;
  const z = footZ + (crest.z - footZ) * up;
  const footY = terrainHeightMeters(footX, footZ) - 0.3;
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
  pieces: readonly (typeof MAP_WALL_PIECES)[number][],
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

function groupPiecesByWall(): Map<string, (typeof MAP_WALL_PIECES)[number][]> {
  const walls = new Map<string, (typeof MAP_WALL_PIECES)[number][]>();
  for (const piece of MAP_WALL_PIECES) {
    if (piece.wallClass === 'BOUND') {
      continue;
    }
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
  /** Peak height of this massif, used to pick rock or snow. */
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
function ridgeOf(pieces: readonly (typeof MAP_WALL_PIECES)[number][]): Ridge | null {
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
      return { x, y: terrainHeightMeters(x, z) + heightAt(along), z };
    },
  };
}

function toMeters(point: MapPointMm): { x: number; z: number } {
  return { x: point.x / MM, z: point.z / MM };
}

/** Unshared triangles, so every facet keeps its own hard normal. */
class FacetBuilder {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colour = new THREE.Color();

  get isEmpty(): boolean {
    return this.positions.length === 0;
  }

  quad(a: SlopePoint, b: SlopePoint, c: SlopePoint, d: SlopePoint, reliefMeters: number): void {
    this.triangle(a, b, c, reliefMeters);
    this.triangle(a, c, d, reliefMeters);
  }

  private triangle(a: SlopePoint, b: SlopePoint, c: SlopePoint, reliefMeters: number): void {
    for (const point of [a, b, c]) {
      this.positions.push(point.x, point.y, point.z);
      // Vertical bedding. A top-down planar projection smears the texture to
      // nothing on the steep faces, which is most of a mountain.
      this.uvs.push((point.x + point.z) / TEXTURE_METERS, point.y / TEXTURE_METERS);
      // Climb is measured from the ground under this column, not from the
      // lowest corner of the triangle: a per-triangle datum restarts the ramp
      // on every facet and flattens the whole massif to its darkest tone.
      const climbMeters = Math.max(0, point.y - point.footY);
      const climb = Math.min(1, climbMeters / Math.max(1, reliefMeters));
      this.colour.copy(SLOPE_LOW).lerp(SLOPE_HIGH, climb ** 0.7);
      if (climbMeters > SNOW_LINE_METERS) {
        this.colour.lerp(SNOW, Math.min(1, (climbMeters - SNOW_LINE_METERS) / 7) * 0.85);
      }
      this.colours.push(this.colour.r, this.colour.g, this.colour.b);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
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
