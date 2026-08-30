import { MAP_HIGHLANDS, terrainHeightMeters } from '@jwgb/content';
import { describe, expect, it } from 'vitest';
import {
  GRASSWORKS_SOURCE_PROFILE,
  sampleGrassworksGrassPoints,
} from '../apps/web/src/render/map/grassworks-vegetation';
import {
  dressingSurfaceMeters,
  highlandTopMeters,
  ringContains,
} from '../apps/web/src/render/map/map-sampling';
import { waterSurfaceAt } from '../apps/web/src/render/map/water';

/**
 * Ground cover has to actually cover the ground.
 *
 * The clustered sampler this replaced could not: anchors landed at random, so
 * raising the instance count only thickened the clumps and left the ground
 * between them bare. These tests pin the three properties that made the switch
 * to a jittered lattice worth it — no bare gaps, plateaus included, ponds
 * excluded — because all three are invisible to a type check and easy to lose.
 */

const MM = 1_000;

function grassPoints(): readonly { readonly x: number; readonly z: number }[] {
  return sampleGrassworksGrassPoints(0xdc80a9ec);
}

describe('Grassworks ground cover lattice', () => {
  const points = grassPoints();

  it('places enough clumps to read as cover rather than as scatter', () => {
    // The runtime lattice crosses the old invisible road ribbons and carries
    // enough overlapping clumps to cover the 500,000 m2 playfield.
    expect(GRASSWORKS_SOURCE_PROFILE.runtimeSpacingMeters).toBe(1.25);
    expect(GRASSWORKS_SOURCE_PROFILE.runtimeRoadVergeMm).toBe(-1);
    expect(GRASSWORKS_SOURCE_PROFILE.runtimeJitter).toBeLessThanOrEqual(0.55);
    expect(GRASSWORKS_SOURCE_PROFILE.runtimeClumpWidthMeters.min).toBeGreaterThan(
      GRASSWORKS_SOURCE_PROFILE.runtimeSpacingMeters,
    );
    expect(points.length).toBeGreaterThan(250_000);
  });

  it('leaves no bare patch large enough to read as an empty field', () => {
    // Bucket by 8 m cell and require neighbours-of-neighbours coverage: a
    // clustered sampler fails this immediately, a lattice cannot.
    const occupied = new Set<string>();
    for (const point of points) {
      occupied.add(`${Math.floor(point.x / MM / 8)}:${Math.floor(point.z / MM / 8)}`);
    }
    // Probe the interior of the playfield well away from the rim, where the
    // boundary polygon legitimately clips the lattice.
    let probed = 0;
    let covered = 0;
    for (let x = -200; x <= 200; x += 16) {
      for (let z = -200; z <= 200; z += 16) {
        if (waterSurfaceAt(x, z) !== null) {
          continue;
        }
        probed += 1;
        const cellX = Math.floor(x / 8);
        const cellZ = Math.floor(z / 8);
        let hit = false;
        for (let dx = -1; dx <= 1 && !hit; dx += 1) {
          for (let dz = -1; dz <= 1 && !hit; dz += 1) {
            if (occupied.has(`${cellX + dx}:${cellZ + dz}`)) {
              hit = true;
            }
          }
        }
        if (hit) {
          covered += 1;
        }
      }
    }
    expect(probed).toBeGreaterThan(100);
    // Roads, courts and landmark footprints are deliberately clear, so this is
    // a high floor rather than a demand for every probe.
    expect(covered / probed).toBeGreaterThan(0.9);
  });

  it('carries cover onto the highland plateaus', () => {
    // The plateaus read as bare because the clustered sampler was sparse
    // everywhere, and a flat pale table shows that more plainly than broken
    // ground does — not because anything was buried: the caps sit only about
    // half a metre over terrain the height field has already raised into a
    // hill. What matters is simply that the lattice reaches them.
    expect(MAP_HIGHLANDS.length).toBeGreaterThan(0);
    let onPlateau = 0;
    for (const point of points) {
      const top = highlandTopMeters(point);
      if (top === null) {
        continue;
      }
      onPlateau += 1;
      const under = terrainHeightMeters(point.x / MM, point.z / MM);
      // Placed on whichever surface is on top: the cap where it stands clear,
      // the terrain where the hillside rises through it.
      expect(dressingSurfaceMeters(point)).toBeCloseTo(Math.max(top, under), 6);
    }
    expect(onPlateau).toBeGreaterThan(200);
  });

  it('keeps cover out of the ponds', () => {
    for (const point of points) {
      expect(waterSurfaceAt(point.x / MM, point.z / MM)).toBeNull();
    }
  });

  it('reports a plateau top only inside a highland footprint', () => {
    const highland = MAP_HIGHLANDS[0];
    if (!highland) {
      throw new Error('missing highland');
    }
    let cx = 0;
    let cz = 0;
    for (const vertex of highland.vertices) {
      cx += vertex.x;
      cz += vertex.z;
    }
    const centre = {
      x: Math.round(cx / highland.vertices.length),
      z: Math.round(cz / highland.vertices.length),
    };
    expect(ringContains(highland.vertices, centre)).toBe(true);
    expect(highlandTopMeters(centre)).toBeCloseTo(highland.topHeightMm / MM, 6);
    // Far outside every plateau there is no top to stand on.
    expect(highlandTopMeters({ x: 0, z: 0 })).toBeNull();
  });
});
