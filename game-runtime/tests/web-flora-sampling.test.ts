import { MAP_GEOMETRY_HASH } from '@jwgb/content';
import { describe, expect, it } from 'vitest';
import {
  GRASSWORKS_FOREST_GROVES,
  GRASSWORKS_SOURCE_PROFILE,
  sampleGrassworksTreePoints,
} from '../apps/web/src/render/map/grassworks-vegetation';
import { waterSurfaceAt } from '../apps/web/src/render/map/water';

const surfaceSeed = Number.parseInt(MAP_GEOMETRY_HASH.slice(0, 8), 16) >>> 0 || 1;

describe('web Grassworks tree sampling', () => {
  it('builds deterministic forest-scale coverage with dense local groves', () => {
    const points = sampleGrassworksTreePoints(surfaceSeed);
    expect(sampleGrassworksTreePoints(surfaceSeed)).toEqual(points);

    // Whole-map budget: the clustered open-ground trees plus the upland
    // lattices, with a ceiling so a forest pass cannot quietly triple the
    // instance count the tree LOD was tuned for.
    expect(points.length).toBeGreaterThanOrEqual(GRASSWORKS_SOURCE_PROFILE.runtimeTreeCount);
    expect(points.length).toBeLessThan(GRASSWORKS_SOURCE_PROFILE.runtimeTreeCount * 2.6);

    // Every authored grove is a real wood: its centre has a closed canopy
    // around it, not a few trees on a lawn.
    for (const grove of GRASSWORKS_FOREST_GROVES) {
      const nearby = points.filter((point) => {
        const dx = point.x / 1_000 - grove.centerX;
        const dz = point.z / 1_000 - grove.centerZ;
        return dx * dx + dz * dz <= 25 ** 2;
      }).length;
      // Small shore copses are judged against their own size; a 25 m circle
      // covers under half of the smallest authored ellipse.
      expect(nearby, grove.id).toBeGreaterThanOrEqual(
        Math.min(38, Math.floor(grove.treeCount * 0.3)),
      );
    }
    const densest = Math.max(
      ...GRASSWORKS_FOREST_GROVES.map(
        (grove) =>
          points.filter((point) => {
            const dx = point.x / 1_000 - grove.centerX;
            const dz = point.z / 1_000 - grove.centerZ;
            return dx * dx + dz * dz <= 25 ** 2;
          }).length,
      ),
    );
    expect(densest).toBeGreaterThanOrEqual(60);
    expect(points.every((point) => waterSurfaceAt(point.x / 1_000, point.z / 1_000) === null)).toBe(
      true,
    );
  }, 30_000);
});
