import { MAP_ROUTE_NODES, terrainHeightMeters } from '@jwgb/content';
import { describe, expect, it } from 'vitest';
import {
  buildGroundGeometry,
  GROUND_FOOTING_BIAS_METERS,
  groundSurfaceMeters,
  walkSurfaceMeters,
} from '../apps/web/src/render/map/ground';
import { isOnRoad } from '../apps/web/src/render/map/map-sampling';
import { buildWaterGeometry } from '../apps/web/src/render/map/water';

describe('web terrain mesh', () => {
  it('lifts the ground grid off y=0 so hills have real triangles', () => {
    const geometry = buildGroundGeometry();
    const positions = geometry.getAttribute('position');
    if (!positions) {
      throw new Error('missing ground positions');
    }
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 1; index < positions.count * 3; index += 3) {
      const y = positions.array[index] as number;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    geometry.dispose();
    expect(maxY - minY).toBeGreaterThan(2.4);
    expect(maxY).toBeGreaterThan(2);
  });

  it('fills basins with flat water and leaves open ground dry', () => {
    const geometry = buildWaterGeometry();
    expect(geometry).not.toBeNull();
    const positions = geometry?.getAttribute('position');
    const waterDepths = geometry?.getAttribute('waterDepth');
    const index = geometry?.getIndex();
    expect(positions?.count).toBeGreaterThan(12);
    expect(waterDepths?.count).toBe(positions?.count);
    expect(index?.count).toBeGreaterThan(12);
    if (!positions || !waterDepths || !index) {
      throw new Error('missing indexed water geometry');
    }
    let covered = 0;
    const levels = new Set<number>();
    for (let index = 0; index < positions.count; index += 1) {
      const level = positions.getY(index);
      levels.add(Math.round(level * 100));
      // Every water vertex must stand over ground that is actually under it.
      // The tolerance covers quantisation, not slack: shoreline vertices are
      // solved in doubles, stored as float32 and re-sampled through a height
      // function that rounds its input to whole millimetres, which moves the
      // answer by a fraction of a millimetre on a steep bank.
      expect(terrainHeightMeters(positions.getX(index), positions.getZ(index))).toBeLessThanOrEqual(
        level + 0.02,
      );
      covered += 1;
    }
    // Basins each carry their own level, so a single global plane is a bug.
    expect(levels.size).toBeGreaterThan(1);
    // And water must stay a feature, not a flood: the old absolute-level rule
    // drowned more than half the playfield.
    expect(covered).toBeLessThan(120_000);

    const edgeUse = new Map<string, readonly [number, number]>();
    const edgeCounts = new Map<string, number>();
    for (let offset = 0; offset < index.count; offset += 3) {
      const triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
      for (let edge = 0; edge < 3; edge += 1) {
        const a = triangle[edge] as number;
        const b = triangle[(edge + 1) % 3] as number;
        const low = Math.min(a, b);
        const high = Math.max(a, b);
        const key = `${low}:${high}`;
        edgeUse.set(key, [low, high]);
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
    const shorelineLengths = [...edgeCounts.entries()]
      .filter(([, count]) => count === 1)
      .map(([key]) => {
        const [a, b] = edgeUse.get(key) as readonly [number, number];
        return {
          depth: Math.max(Math.abs(waterDepths.getX(a)), Math.abs(waterDepths.getX(b))),
          length: Math.hypot(
            positions.getX(a) - positions.getX(b),
            positions.getZ(a) - positions.getZ(b),
          ),
        };
      })
      // Refined shoreline cells meet coarse, coplanar interior cells at
      // topology-only LOD seams. Water depth separates those invisible joins
      // from the actual zero-depth land/water contour.
      .filter((edge) => edge.depth <= 0.02)
      .map((edge) => edge.length);
    expect(shorelineLengths.length).toBeGreaterThan(100);
    // The old contour exposed one 4 m terrain edge at a time. The refined
    // rounded contour never presents more than one 0.5 m cell diagonal.
    expect(Math.max(...shorelineLengths)).toBeLessThanOrEqual(Math.SQRT1_2 + 0.02);
  });

  it('keeps footing on the rendered triangles instead of under them', () => {
    const x = 88;
    const z = -41;
    expect(groundSurfaceMeters(x, z)).toBeGreaterThan(terrainHeightMeters(x, z));
    expect(groundSurfaceMeters(x, z) - terrainHeightMeters(x, z)).toBeGreaterThanOrEqual(
      GROUND_FOOTING_BIAS_METERS - 0.001,
    );
  });

  it('raises walk height above road overlays', () => {
    const node = MAP_ROUTE_NODES[0];
    if (!node) {
      throw new Error('missing route node');
    }
    const x = node.position.x / 1000;
    const z = node.position.z / 1000;
    expect(isOnRoad({ x: node.position.x, z: node.position.z }, 900)).toBe(true);
    expect(walkSurfaceMeters(x, z)).toBeGreaterThan(groundSurfaceMeters(x, z) + 0.04);
  });
});
