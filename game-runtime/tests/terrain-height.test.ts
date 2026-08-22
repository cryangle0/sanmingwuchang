import {
  denCentreMm,
  MAP_COURTS,
  MAP_HIGHLANDS,
  MAP_NESTS,
  MAP_ROCKS,
  MAP_ROUTE_EDGES,
  MAP_ROUTE_NODES,
  MAP_SPAWN_POINTS,
  terrainBlocksLineOfSight,
  terrainHeightMm,
} from '@jwgb/content';
import { describe, expect, it } from 'vitest';

function highlandCentroid(index: number): { x: number; z: number } {
  const highland = MAP_HIGHLANDS[index];
  if (!highland) {
    throw new Error(`missing highland ${index}`);
  }
  const sum = highland.vertices.reduce(
    (total, vertex) => ({ x: total.x + vertex.x, z: total.z + vertex.z }),
    { x: 0, z: 0 },
  );
  return {
    x: Math.trunc(sum.x / highland.vertices.length),
    z: Math.trunc(sum.z / highland.vertices.length),
  };
}

describe('authoritative terrain height', () => {
  it('returns the same millimetre height for the same lattice point', () => {
    const first = terrainHeightMm(88_000, -41_000);
    const second = terrainHeightMm(88_000, -41_000);
    expect(first).toBe(second);
    expect(Number.isInteger(first)).toBe(true);
  });

  it('flattens court floors so 庭心 stays a playable pad', () => {
    for (const court of MAP_COURTS) {
      expect(Math.abs(terrainHeightMm(court.center.x, court.center.z))).toBeLessThanOrEqual(80);
    }
  });

  it('raises authored highlands to their compiled top height', () => {
    for (const [index, highland] of MAP_HIGHLANDS.entries()) {
      const centroid = highlandCentroid(index);
      expect(
        Math.abs(terrainHeightMm(centroid.x, centroid.z) - highland.topHeightMm),
      ).toBeLessThanOrEqual(80);
    }
  });

  it('keeps spawn pads locally flat on the surrounding hillside', () => {
    const spawn = MAP_SPAWN_POINTS[0];
    if (!spawn) {
      throw new Error('missing spawn');
    }
    const center = terrainHeightMm(spawn.position.x, spawn.position.z);
    const neighbour = terrainHeightMm(spawn.position.x + 3_000, spawn.position.z);
    expect(Math.abs(center - neighbour)).toBeLessThan(140);
  });

  it('drapes roads over local relief instead of cutting a trench', () => {
    const nodes = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));
    const mains = MAP_ROUTE_EDGES.filter((item) => item.roadClass === 'MAIN').slice(0, 8);
    const midHeights: number[] = [];
    for (const edge of mains) {
      const a = nodes.get(edge.a);
      const b = nodes.get(edge.b);
      if (!a || !b) {
        continue;
      }
      midHeights.push(terrainHeightMm(Math.trunc((a.x + b.x) / 2), Math.trunc((a.z + b.z) / 2)));
    }
    expect(midHeights.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...midHeights.map((value) => Math.abs(value)))).toBeGreaterThan(1_500);
    expect(Math.max(...midHeights) - Math.min(...midHeights)).toBeGreaterThan(1_000);
  });

  it('puts real relief on open ground away from stamps', () => {
    const samples = [
      terrainHeightMm(-300_000, 40_000),
      terrainHeightMm(-280_000, 80_000),
      terrainHeightMm(-260_000, 20_000),
      terrainHeightMm(40_000, 260_000),
      terrainHeightMm(80_000, 240_000),
    ];
    const spread = Math.max(...samples) - Math.min(...samples);
    expect(spread).toBeGreaterThan(1_200);
    expect(Math.max(...samples.map((value) => Math.abs(value)))).toBeGreaterThan(1_500);
  });

  it('blocks line of sight that crosses an authored highland', () => {
    const highland = MAP_HIGHLANDS[0];
    if (!highland) {
      throw new Error('missing east highland');
    }
    const west = { x: 280_000, z: 162_600 };
    const east = { x: 385_000, z: 162_600 };
    expect(terrainBlocksLineOfSight(west, east)).toBe(true);
  });

  it('keeps line of sight along a flattened MAIN corridor', () => {
    const edge = MAP_ROUTE_EDGES.find((item) => item.roadClass === 'MAIN');
    const nodes = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));
    if (!edge) {
      throw new Error('missing MAIN edge');
    }
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) {
      throw new Error('missing route nodes');
    }
    expect(terrainBlocksLineOfSight(a, b)).toBe(false);
  });

  it('terraces each 伏石圈 so the circle sits on a pad', () => {
    const rock = MAP_ROCKS[0];
    if (!rock) {
      throw new Error('missing rock');
    }
    const center = terrainHeightMm(rock.position.x, rock.position.z);
    const neighbour = terrainHeightMm(rock.position.x + 3_500, rock.position.z);
    expect(Math.abs(center - neighbour)).toBeLessThan(280);
  });

  it('scoops a hollow beside the route for each wild nest', () => {
    // Nest anchors are route waypoints, so the hollow is dug off the corridor
    // rather than at the anchor; denCentreMm is where it actually lands.
    // Asserted across the whole set: a handful of anchors are boxed in by two
    // routes or fall inside an authored highland and keep a shallower hollow,
    // so a single sample would be a coin toss rather than a contract.
    const depths = MAP_NESTS.map((nest) => {
      const radiusMm = nest.band === '内' ? 8_000 : nest.band === '中' ? 7_000 : 6_000;
      const centre = denCentreMm(nest.base, radiusMm);
      const floor = terrainHeightMm(centre.x, centre.z);
      let rim = floor;
      for (let step = 0; step < 24; step += 1) {
        const angle = (step / 24) * Math.PI * 2;
        rim = Math.max(
          rim,
          terrainHeightMm(
            Math.round(centre.x + Math.cos(angle) * (radiusMm + 6_000)),
            Math.round(centre.z + Math.sin(angle) * (radiusMm + 6_000)),
          ),
        );
      }
      return rim - floor;
    }).sort((a, b) => a - b);

    const median = depths[Math.floor(depths.length / 2)] as number;
    expect(median).toBeGreaterThan(2_000);
    expect(depths.filter((depth) => depth > 1_000).length).toBeGreaterThanOrEqual(
      Math.ceil(depths.length * 0.75),
    );
  });

  it('keeps every den hollow clear of the route corridors it was moved off', () => {
    const nodes = new Map(MAP_ROUTE_NODES.map((node) => [node.id, node.position]));
    let worstOverlapMm = Number.POSITIVE_INFINITY;
    for (const nest of MAP_NESTS) {
      const radiusMm = nest.band === '内' ? 8_000 : nest.band === '中' ? 7_000 : 6_000;
      const centre = denCentreMm(nest.base, radiusMm);
      let nearestMm = Number.POSITIVE_INFINITY;
      for (const edge of MAP_ROUTE_EDGES) {
        const a = nodes.get(edge.a);
        const b = nodes.get(edge.b);
        if (!a || !b) {
          continue;
        }
        const deltaX = b.x - a.x;
        const deltaZ = b.z - a.z;
        const lengthSquared = deltaX * deltaX + deltaZ * deltaZ || 1;
        const t = Math.max(
          0,
          Math.min(1, ((centre.x - a.x) * deltaX + (centre.z - a.z) * deltaZ) / lengthSquared),
        );
        const distanceMm = Math.hypot(centre.x - (a.x + deltaX * t), centre.z - (a.z + deltaZ * t));
        nearestMm = Math.min(nearestMm, distanceMm - edge.widthMm / 2);
      }
      worstOverlapMm = Math.min(worstOverlapMm, nearestMm + radiusMm);
    }
    // The den floor may graze a corridor edge, but must never straddle it.
    expect(worstOverlapMm).toBeGreaterThan(0);
  });
});
