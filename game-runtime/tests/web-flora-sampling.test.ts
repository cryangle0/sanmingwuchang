import { MAP_GEOMETRY_HASH } from '@jwgb/content';
import { describe, expect, it } from 'vitest';
import { sampleGrassworksTreePoints } from '../apps/web/src/render/map/grassworks-vegetation';
import { waterSurfaceAt } from '../apps/web/src/render/map/water';

const surfaceSeed = Number.parseInt(MAP_GEOMETRY_HASH.slice(0, 8), 16) >>> 0 || 1;

describe('web Grassworks tree sampling', () => {
  it('builds deterministic forest-scale coverage with dense local groves', () => {
    const points = sampleGrassworksTreePoints(surfaceSeed);
    expect(sampleGrassworksTreePoints(surfaceSeed)).toEqual(points);
    const densestTree = points.reduce(
      (best, point) => {
        const nearby = points.filter((other) => {
          const dx = other.x - point.x;
          const dz = other.z - point.z;
          return dx * dx + dz * dz <= 25_000 ** 2;
        }).length;
        return nearby > best.nearby ? { point, nearby } : best;
      },
      { point: points[0], nearby: 0 },
    );

    expect(points).toHaveLength(960);
    expect(densestTree.nearby).toBeGreaterThanOrEqual(22);
    expect(points.every((point) => waterSurfaceAt(point.x / 1_000, point.z / 1_000) === null)).toBe(
      true,
    );
  });
});
