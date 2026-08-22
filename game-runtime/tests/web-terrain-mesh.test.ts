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
    expect(positions?.count).toBeGreaterThan(12);
    if (!positions) {
      throw new Error('missing water positions');
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
