import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAP_BOUNDARY, MAP_GEOMETRY_HASH, MAP_WALL_PIECES } from '@jwgb/content';
import { MapCollisionField } from '@jwgb/sim';
import { describe, expect, it } from 'vitest';

interface MapFixtureDocument {
  readonly schema: string;
  readonly geometryHash: string;
  readonly boundaryVertexCount: number;
  readonly wallPieceCount: number;
  readonly spawnPointCount: number;
  readonly blockedQueries: readonly {
    readonly x: number;
    readonly z: number;
    readonly radiusMm: number;
    readonly insideBoundary: boolean;
    readonly wallPieceId: string;
  }[];
  readonly movementQueries: readonly {
    readonly fromX: number;
    readonly fromZ: number;
    readonly toX: number;
    readonly toZ: number;
    readonly radiusMm: number;
    readonly resultX: number;
    readonly resultZ: number;
  }[];
  readonly sweepQueries: readonly {
    readonly startX: number;
    readonly startZ: number;
    readonly endX: number;
    readonly endZ: number;
    readonly sweepDistanceMm: number;
    readonly radiusMm: number;
    readonly hit: boolean;
    readonly distanceMm: number;
    readonly pieceId: string;
  }[];
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'migration', 'fixtures', 'map-v1.json'), 'utf8'),
) as MapFixtureDocument;

describe('map geometry golden fixture', () => {
  const field = new MapCollisionField(MAP_GEOMETRY_HASH, MAP_BOUNDARY, MAP_WALL_PIECES);

  it('matches the compiled geometry identity', () => {
    expect(fixture.schema).toBe('jwgb.map.fixture.v1');
    expect(fixture.geometryHash).toBe(MAP_GEOMETRY_HASH);
    expect(fixture.boundaryVertexCount).toBe(MAP_BOUNDARY.length);
    expect(fixture.wallPieceCount).toBe(MAP_WALL_PIECES.length);
  });

  it('replays every blocked query to the recorded result', () => {
    expect(fixture.blockedQueries.length).toBeGreaterThan(0);
    for (const query of fixture.blockedQueries) {
      const point = { x: query.x, z: query.z };
      expect(field.isCircleInsideBoundary(point, query.radiusMm)).toBe(query.insideBoundary);
      expect(field.firstWallPieceAt(point, query.radiusMm) ?? '').toBe(query.wallPieceId);
    }
  });

  it('replays every movement resolution to the recorded result', () => {
    for (const query of fixture.movementQueries) {
      const result = field.resolveMovement(
        { x: query.fromX, z: query.fromZ },
        { x: query.toX, z: query.toZ },
        query.radiusMm,
      );
      expect(result).toEqual({ x: query.resultX, z: query.resultZ });
    }
  });

  it('replays every sweep contact to the recorded result', () => {
    for (const query of fixture.sweepQueries) {
      const hit = field.sweepCircleFirstWallContact(
        { x: query.startX, z: query.startZ },
        { x: query.endX, z: query.endZ },
        query.sweepDistanceMm,
        query.radiusMm,
      );
      expect(hit !== null).toBe(query.hit);
      if (query.hit) {
        expect(hit?.distanceMm).toBe(query.distanceMm);
        expect(hit?.pieceId).toBe(query.pieceId);
      }
    }
  });
});
