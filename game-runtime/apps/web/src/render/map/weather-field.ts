import type { RegionId } from './map-regions';
import { precipForRegion } from './region-climate';

export type PrecipMode = 'rain' | 'snow';

export interface RemotePrecipPlan {
  readonly mode: PrecipMode | null;
  readonly local: boolean;
}

export const PRECIP_SCAN_GRID = 7;
export const PRECIP_SPAWN_TRIES = 10;

export function remotePrecipPlan(
  camX: number,
  camZ: number,
  hx: number,
  hz: number,
  regionAt: (x: number, z: number) => RegionId,
): RemotePrecipPlan {
  const own = precipForRegion(regionAt(camX, camZ));
  if (own) {
    return { mode: own, local: true };
  }
  let mode: PrecipMode | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (let column = 0; column < PRECIP_SCAN_GRID; column += 1) {
    const x = camX + (((column + 0.5) / PRECIP_SCAN_GRID) * 2 - 1) * hx;
    for (let row = 0; row < PRECIP_SCAN_GRID; row += 1) {
      const z = camZ + (((row + 0.5) / PRECIP_SCAN_GRID) * 2 - 1) * hz;
      const sample = precipForRegion(regionAt(x, z));
      if (!sample) {
        continue;
      }
      const distance = (x - camX) * (x - camX) + (z - camZ) * (z - camZ);
      if (distance < best) {
        best = distance;
        mode = sample;
      }
    }
  }
  return { mode, local: false };
}

export function precipSpawnXZ(
  rand01: () => number,
  camX: number,
  camZ: number,
  hx: number,
  hz: number,
  mode: PrecipMode,
  regionAt: (x: number, z: number) => RegionId,
): { x: number; z: number } | null {
  for (let attempt = 0; attempt < PRECIP_SPAWN_TRIES; attempt += 1) {
    const x = camX + (rand01() * 2 - 1) * hx;
    const z = camZ + (rand01() * 2 - 1) * hz;
    if (precipForRegion(regionAt(x, z)) === mode) {
      return { x, z };
    }
  }
  return null;
}
