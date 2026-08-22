/**
 * P0 baseline metrics for the terrain landform work.
 *
 * Measures the four guardrail quantities on whatever height field is
 * currently compiled, so the redesign in
 * docs/superpowers/specs/2026-08-22-map-landform-quality-design.md can be
 * held to "no worse than baseline + X" instead of an invented threshold.
 *
 * Sampling is deterministic: a fixed-seed integer PRNG, so re-running on an
 * unchanged height field reproduces every number exactly.
 *
 * Usage: npx tsx tools/map/measure-terrain-baseline.ts [--out <path>]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  MAP_BOUNDARY,
  MAP_CHESTS,
  MAP_COURTS,
  MAP_DRAGONS,
  MAP_ELITES,
  MAP_NESTS,
  MAP_ROCKS,
  MAP_SPAWN_POINTS,
  TERRAIN_AMPLITUDE_MM,
  terrainBlocksLineOfSight,
  terrainHeightMm,
} from '../../packages/content/src/index';
import type { MapPointMm } from '../../packages/content/src/map-geometry-types';

const SIGHT_RANGES_MM = [12_000, 25_000, 40_000, 60_000] as const;
const SIGHT_PAIRS_PER_RANGE = 25_000;
const RELIEF_SAMPLES = 40_000;
const SLOPE_STEP_MM = 2_000;
const BLIND_CELL_MM = 5_000;
const BLIND_PROBE_RANGE_MM = 25_000;
const BLIND_PROBE_DIRECTIONS = 12;
const BLIND_VISIBLE_FLOOR = 0.35;

/** Deterministic 32-bit LCG; identical output in TypeScript and C#. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function boundsOf(ring: readonly MapPointMm[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function ringContains(ring: readonly MapPointMm[], point: MapPointMm): boolean {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] as MapPointMm;
    const b = ring[(index + 1) % ring.length] as MapPointMm;
    if (a.z > point.z === b.z > point.z) {
      continue;
    }
    const deltaZ = b.z - a.z;
    const left = (point.x - a.x) * deltaZ;
    const right = (point.z - a.z) * (b.x - a.x);
    if (deltaZ > 0 ? left < right : left > right) {
      inside = !inside;
    }
  }
  return inside;
}

const BOUNDS = boundsOf(MAP_BOUNDARY);

function randomInsidePoint(random: () => number): MapPointMm {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const point = {
      x: Math.round(BOUNDS.minX + random() * (BOUNDS.maxX - BOUNDS.minX)),
      z: Math.round(BOUNDS.minZ + random() * (BOUNDS.maxZ - BOUNDS.minZ)),
    };
    if (ringContains(MAP_BOUNDARY, point)) {
      return point;
    }
  }
  return { x: 0, z: 0 };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(fraction * (sorted.length - 1))),
  );
  return sorted[index] as number;
}

function measureRelief(): {
  minMm: number;
  maxMm: number;
  spanMm: number;
  reliefRatio: number;
  slopeP50Degrees: number;
  slopeP95Degrees: number;
  slopeMaxDegrees: number;
} {
  const random = makeRandom(0x5eed_1001);
  let minMm = Number.POSITIVE_INFINITY;
  let maxMm = Number.NEGATIVE_INFINITY;
  const slopes: number[] = [];
  for (let sample = 0; sample < RELIEF_SAMPLES; sample += 1) {
    const point = randomInsidePoint(random);
    const height = terrainHeightMm(point.x, point.z);
    minMm = Math.min(minMm, height);
    maxMm = Math.max(maxMm, height);
    const dx = terrainHeightMm(point.x + SLOPE_STEP_MM, point.z) - height;
    const dz = terrainHeightMm(point.x, point.z + SLOPE_STEP_MM) - height;
    slopes.push((Math.atan(Math.hypot(dx, dz) / SLOPE_STEP_MM) * 180) / Math.PI);
  }
  slopes.sort((a, b) => a - b);
  const widthMm = Math.max(BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxZ - BOUNDS.minZ);
  return {
    minMm,
    maxMm,
    spanMm: maxMm - minMm,
    reliefRatio: (maxMm - minMm) / widthMm,
    slopeP50Degrees: percentile(slopes, 0.5),
    slopeP95Degrees: percentile(slopes, 0.95),
    slopeMaxDegrees: slopes[slopes.length - 1] as number,
  };
}

function measureSight(): Record<string, { pairs: number; blocked: number; blockedRatio: number }> {
  const out: Record<string, { pairs: number; blocked: number; blockedRatio: number }> = {};
  for (const rangeMm of SIGHT_RANGES_MM) {
    const random = makeRandom(0x51_6b_7000 + rangeMm);
    let pairs = 0;
    let blocked = 0;
    while (pairs < SIGHT_PAIRS_PER_RANGE) {
      const start = randomInsidePoint(random);
      const angle = random() * Math.PI * 2;
      const end = {
        x: Math.round(start.x + Math.cos(angle) * rangeMm),
        z: Math.round(start.z + Math.sin(angle) * rangeMm),
      };
      if (!ringContains(MAP_BOUNDARY, end)) {
        continue;
      }
      pairs += 1;
      if (terrainBlocksLineOfSight(start, end)) {
        blocked += 1;
      }
    }
    out[`${rangeMm / 1_000}m`] = { pairs, blocked, blockedRatio: blocked / pairs };
  }
  return out;
}

/**
 * Blind-domain probe: for a coarse lattice of standing points, what fraction
 * of 12 evenly-spaced 25 m sightlines are clear? Cells under the floor are
 * "blind"; the redesign must not create a connected cluster of them.
 */
function measureBlindDomains(): {
  cells: number;
  blindCells: number;
  blindRatio: number;
  largestBlindClusterCells: number;
  largestBlindClusterMeters: number;
} {
  const columns = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / BLIND_CELL_MM);
  const rows = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / BLIND_CELL_MM);
  const blind = new Uint8Array(columns * rows);
  const present = new Uint8Array(columns * rows);
  let cells = 0;
  let blindCells = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = {
        x: Math.round(BOUNDS.minX + column * BLIND_CELL_MM),
        z: Math.round(BOUNDS.minZ + row * BLIND_CELL_MM),
      };
      if (!ringContains(MAP_BOUNDARY, point)) {
        continue;
      }
      present[row * columns + column] = 1;
      cells += 1;
      let visible = 0;
      let probes = 0;
      for (let step = 0; step < BLIND_PROBE_DIRECTIONS; step += 1) {
        const angle = (step / BLIND_PROBE_DIRECTIONS) * Math.PI * 2;
        const end = {
          x: Math.round(point.x + Math.cos(angle) * BLIND_PROBE_RANGE_MM),
          z: Math.round(point.z + Math.sin(angle) * BLIND_PROBE_RANGE_MM),
        };
        if (!ringContains(MAP_BOUNDARY, end)) {
          continue;
        }
        probes += 1;
        if (!terrainBlocksLineOfSight(point, end)) {
          visible += 1;
        }
      }
      if (probes > 0 && visible / probes < BLIND_VISIBLE_FLOOR) {
        blind[row * columns + column] = 1;
        blindCells += 1;
      }
    }
  }

  let largest = 0;
  const seen = new Uint8Array(columns * rows);
  const stack: number[] = [];
  for (let index = 0; index < blind.length; index += 1) {
    if (blind[index] !== 1 || seen[index] === 1) {
      continue;
    }
    let size = 0;
    stack.push(index);
    seen[index] = 1;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      size += 1;
      const column = current % columns;
      const row = (current - column) / columns;
      const neighbours = [
        column > 0 ? current - 1 : -1,
        column + 1 < columns ? current + 1 : -1,
        row > 0 ? current - columns : -1,
        row + 1 < rows ? current + columns : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour >= 0 && blind[neighbour] === 1 && seen[neighbour] === 0) {
          seen[neighbour] = 1;
          stack.push(neighbour);
        }
      }
    }
    largest = Math.max(largest, size);
  }

  return {
    cells,
    blindCells,
    blindRatio: cells === 0 ? 0 : blindCells / cells,
    largestBlindClusterCells: largest,
    // Equivalent-disc radius of the largest cluster, in metres.
    largestBlindClusterMeters:
      (Math.sqrt((largest * BLIND_CELL_MM * BLIND_CELL_MM) / Math.PI) / 1_000) *
      (largest > 0 ? 1 : 0),
  };
}

function measureSpawnFairness(): {
  count: number;
  minMm: number;
  maxMm: number;
  spreadMm: number;
  medianMm: number;
  worstNeighbourhoodRiseMm: number;
} {
  const heights = MAP_SPAWN_POINTS.map((spawn) =>
    terrainHeightMm(spawn.position.x, spawn.position.z),
  );
  const sorted = [...heights].sort((a, b) => a - b);
  let worstRise = 0;
  for (const spawn of MAP_SPAWN_POINTS) {
    const base = terrainHeightMm(spawn.position.x, spawn.position.z);
    for (let step = 0; step < 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      for (const radiusMm of [10_000, 18_000, 25_000]) {
        const x = Math.round(spawn.position.x + Math.cos(angle) * radiusMm);
        const z = Math.round(spawn.position.z + Math.sin(angle) * radiusMm);
        worstRise = Math.max(worstRise, terrainHeightMm(x, z) - base);
      }
    }
  }
  return {
    count: heights.length,
    minMm: sorted[0] as number,
    maxMm: sorted[sorted.length - 1] as number,
    spreadMm: (sorted[sorted.length - 1] as number) - (sorted[0] as number),
    medianMm: percentile(sorted, 0.5),
    worstNeighbourhoodRiseMm: worstRise,
  };
}

function measurePoiFlatness(): Record<string, { count: number; worstSpanMm: number }> {
  const probe = (points: readonly MapPointMm[], radiusMm: number): number => {
    let worst = 0;
    for (const point of points) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let step = 0; step < 16; step += 1) {
        const angle = (step / 16) * Math.PI * 2;
        for (const factor of [0, 0.5, 1]) {
          const x = Math.round(point.x + Math.cos(angle) * radiusMm * factor);
          const z = Math.round(point.z + Math.sin(angle) * radiusMm * factor);
          const height = terrainHeightMm(x, z);
          min = Math.min(min, height);
          max = Math.max(max, height);
        }
      }
      worst = Math.max(worst, max - min);
    }
    return worst;
  };
  return {
    rocks: {
      count: MAP_ROCKS.length,
      worstSpanMm: probe(
        MAP_ROCKS.map((r) => r.position),
        8_500,
      ),
    },
    nests: {
      count: MAP_NESTS.length,
      worstSpanMm: probe(
        MAP_NESTS.map((n) => n.base),
        9_000,
      ),
    },
    dragons: {
      count: MAP_DRAGONS.length,
      worstSpanMm: probe(
        MAP_DRAGONS.map((d) => d.position),
        14_500,
      ),
    },
    elites: {
      count: MAP_ELITES.length,
      worstSpanMm: probe(
        MAP_ELITES.map((e) => e.position),
        12_500,
      ),
    },
    courts: {
      count: MAP_COURTS.length,
      worstSpanMm: probe(
        MAP_COURTS.map((c) => c.center),
        8_000,
      ),
    },
    chests: { count: MAP_CHESTS.length, worstSpanMm: 0 },
  };
}

function main(): void {
  const outIndex = process.argv.indexOf('--out');
  const outPath =
    outIndex >= 0 && process.argv[outIndex + 1]
      ? (process.argv[outIndex + 1] as string)
      : 'artifacts/terrain-baseline/terrain-baseline.json';

  const report = {
    schema: 'terrain-baseline-v1',
    terrainAmplitudeMm: TERRAIN_AMPLITUDE_MM,
    boundsMm: BOUNDS,
    relief: measureRelief(),
    sight: measureSight(),
    blind: measureBlindDomains(),
    spawn: measureSpawnFairness(),
    poiFlatness: measurePoiFlatness(),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const relief = report.relief;
  console.log('--- terrain baseline ---');
  console.log(
    `relief: ${(relief.spanMm / 1_000).toFixed(2)} m span over ` +
      `${((BOUNDS.maxX - BOUNDS.minX) / 1_000).toFixed(0)} m  ` +
      `=> ratio ${(relief.reliefRatio * 100).toFixed(2)}%`,
  );
  console.log(
    `slope: p50 ${relief.slopeP50Degrees.toFixed(2)}deg  ` +
      `p95 ${relief.slopeP95Degrees.toFixed(2)}deg  max ${relief.slopeMaxDegrees.toFixed(2)}deg`,
  );
  for (const [range, entry] of Object.entries(report.sight)) {
    console.log(`sight ${range.padStart(4)}: blocked ${(entry.blockedRatio * 100).toFixed(2)}%`);
  }
  console.log(
    `blind: ${report.blind.blindCells}/${report.blind.cells} cells ` +
      `(${(report.blind.blindRatio * 100).toFixed(2)}%), largest cluster ` +
      `${report.blind.largestBlindClusterCells} cells ` +
      `(~${report.blind.largestBlindClusterMeters.toFixed(1)} m equivalent radius)`,
  );
  console.log(
    `spawn: spread ${(report.spawn.spreadMm / 1_000).toFixed(2)} m, ` +
      `worst 25 m neighbourhood rise ${(report.spawn.worstNeighbourhoodRiseMm / 1_000).toFixed(2)} m`,
  );
  for (const [name, entry] of Object.entries(report.poiFlatness)) {
    if (name === 'chests') {
      continue;
    }
    console.log(
      `poi ${name.padEnd(8)}: n=${String(entry.count).padStart(3)} worst span ` +
        `${(entry.worstSpanMm / 1_000).toFixed(2)} m`,
    );
  }
  console.log(`written: ${outPath}`);
}

main();
