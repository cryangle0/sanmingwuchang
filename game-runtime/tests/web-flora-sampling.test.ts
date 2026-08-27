import { MAP_GEOMETRY_HASH } from '@jwgb/content';
import { describe, expect, it } from 'vitest';
import { sampleFloraTreePoints } from '../apps/web/src/render/map/flora';

const surfaceSeed = Number.parseInt(MAP_GEOMETRY_HASH.slice(0, 8), 16) >>> 0 || 1;

describe('web flora sampling', () => {
  it('builds full forest-scale tree coverage with dense local groves', () => {
    const points = sampleFloraTreePoints(surfaceSeed);
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
  });
});
