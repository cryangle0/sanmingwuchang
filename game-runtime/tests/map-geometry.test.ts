import {
  MAP_BOUNDARY,
  MAP_CHESTS,
  MAP_COURTS,
  MAP_DRAGONS,
  MAP_ELITES,
  MAP_GEOMETRY_HASH,
  MAP_HIGHLANDS,
  MAP_MONSTER_SLOTS,
  MAP_NESTS,
  MAP_PIGS,
  MAP_ROCKS,
  MAP_SPAWN_POINTS,
  MAP_WALL_PIECES,
  type MapPointMm,
} from '@jwgb/content';
import { MapCollisionField } from '@jwgb/sim';
import { describe, expect, it } from 'vitest';
import { mergeTrianglesIntoConvexPieces } from '../tools/map/convex-merge';
import {
  crossOrientation,
  doubledSignedArea,
  ensureCounterClockwise,
  isConvexRing,
  simplifyRing,
} from '../tools/map/polygon-math';
import { triangulateRing } from '../tools/map/triangulate';

function point(x: number, z: number): MapPointMm {
  return { x, z };
}

describe('polygon math', () => {
  it('computes orientation and area deterministically', () => {
    const square = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
    expect(doubledSignedArea(square)).toBe(32);
    expect(doubledSignedArea([...square].reverse())).toBe(-32);
    expect(ensureCounterClockwise([...square].reverse())).toEqual(square);
  });

  it('drops duplicate and collinear vertices without changing area', () => {
    const noisy = [
      point(0, 0),
      point(2, 0),
      point(2, 0),
      point(4, 0),
      point(4, 4),
      point(0, 4),
      point(0, 2),
    ];
    const simplified = simplifyRing(noisy);
    expect(simplified).toEqual([point(0, 0), point(4, 0), point(4, 4), point(0, 4)]);
    expect(doubledSignedArea(simplified)).toBe(32);
  });
});

describe('map PVE spawn geometry', () => {
  it('keeps every authored monster slot outside walls with its runtime clearance', () => {
    const field = new MapCollisionField(MAP_GEOMETRY_HASH, MAP_BOUNDARY, MAP_WALL_PIECES);
    const radiusByKind = { MEL: 500, RNG: 500, FLY: 400 } as const;

    for (const slot of MAP_MONSTER_SLOTS) {
      const radiusMm = radiusByKind[slot.kind as keyof typeof radiusByKind];
      expect(radiusMm, `${slot.id} has an unsupported kind`).toBeDefined();
      if (radiusMm === undefined) {
        continue;
      }
      expect(field.isCircleBlocked(slot.position, radiusMm), slot.id).toBe(false);
    }
  });
});

describe('triangulation and convex merge', () => {
  it('triangulates a concave L-shape with preserved area', () => {
    const lShape = [point(0, 0), point(4, 0), point(4, 2), point(2, 2), point(2, 4), point(0, 4)];
    const triangles = triangulateRing(lShape);
    expect(triangles).toHaveLength(4);
    const totalArea = triangles.reduce((sum, [a, b, c]) => {
      const ring = [lShape[a] as MapPointMm, lShape[b] as MapPointMm, lShape[c] as MapPointMm];
      return sum + doubledSignedArea(ring);
    }, 0);
    expect(totalArea).toBe(doubledSignedArea(lShape));
  });

  it('merges an L-shape into two convex pieces', () => {
    const lShape = [point(0, 0), point(4, 0), point(4, 2), point(2, 2), point(2, 4), point(0, 4)];
    const pieces = mergeTrianglesIntoConvexPieces(lShape, triangulateRing(lShape));
    expect(pieces.length).toBe(2);
    let area = 0;
    for (const piece of pieces) {
      const ring = piece.map((index) => lShape[index] as MapPointMm);
      expect(isConvexRing(ring)).toBe(true);
      area += doubledSignedArea(ring);
    }
    expect(area).toBe(doubledSignedArea(lShape));
  });

  it('exposes self-intersection through negative pieces, which the compiler rejects', () => {
    const bowTie = [point(0, 0), point(4, 4), point(4, 0), point(0, 4)];
    const triangles = triangulateRing(bowTie);
    const hasInvertedPiece = triangles.some(([a, b, c]) => {
      const ring = [bowTie[a] as MapPointMm, bowTie[b] as MapPointMm, bowTie[c] as MapPointMm];
      return doubledSignedArea(ring) <= 0 || !isConvexRing(ring);
    });
    expect(hasInvertedPiece).toBe(true);
  });
});

describe('generated map geometry', () => {
  it('has the authoritative record counts', () => {
    expect(MAP_BOUNDARY.length).toBeGreaterThanOrEqual(3);
    expect(new Set(MAP_WALL_PIECES.map((piece) => piece.wallId)).size).toBe(42);
    expect(MAP_HIGHLANDS).toHaveLength(3);
    expect(MAP_SPAWN_POINTS).toHaveLength(30);
    expect(MAP_COURTS).toHaveLength(3);
    expect(MAP_PIGS).toHaveLength(12);
    expect(MAP_DRAGONS).toHaveLength(5);
    expect(MAP_ELITES).toHaveLength(4);
    expect(MAP_ROCKS).toHaveLength(24);
    expect(MAP_MONSTER_SLOTS).toHaveLength(108);
    expect(MAP_NESTS).toHaveLength(48);
    expect(MAP_CHESTS).toHaveLength(167);
    expect(MAP_GEOMETRY_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it('emits only convex CCW integer pieces with unique ids', () => {
    const seen = new Set<string>();
    for (const piece of MAP_WALL_PIECES) {
      expect(seen.has(piece.pieceId)).toBe(false);
      seen.add(piece.pieceId);
      expect(piece.vertices.length).toBeGreaterThanOrEqual(3);
      expect(isConvexRing([...piece.vertices])).toBe(true);
      expect(doubledSignedArea([...piece.vertices])).toBeGreaterThan(0);
      for (const vertex of piece.vertices) {
        expect(Number.isSafeInteger(vertex.x)).toBe(true);
        expect(Number.isSafeInteger(vertex.z)).toBe(true);
      }
    }
  });

  it('keeps every spawn point outside all wall pieces', () => {
    for (const spawn of MAP_SPAWN_POINTS) {
      for (const piece of MAP_WALL_PIECES) {
        const inside = piece.vertices.every((vertex, index) => {
          const next = piece.vertices[(index + 1) % piece.vertices.length] as MapPointMm;
          return crossOrientation(vertex, next, spawn.position) >= 0;
        });
        expect(inside).toBe(false);
      }
    }
  });

  it('keeps spawn ids and zones unique per macro zone pairing', () => {
    const ids = new Set(MAP_SPAWN_POINTS.map((spawn) => spawn.id));
    expect(ids.size).toBe(30);
    const zones = new Set(MAP_SPAWN_POINTS.map((spawn) => spawn.zone));
    expect(zones.size).toBe(15);
  });
});
