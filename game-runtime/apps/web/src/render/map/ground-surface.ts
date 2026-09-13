import { MAP_HIGHLANDS, type MapPointMm, terrainHeightMeters } from '@jwgb/content';
import { ringContains } from './map-polygons';

const MM_PER_METER = 1_000;

/** World metres per repeat of the ground albedo; the bank and apron tile at the same rate. */
export const GROUND_METERS_PER_TILE = 15;

/**
 * Top surface of the plateau a point stands on, or null on open terrain.
 *
 * The three 高台 are drawn as separate raised geometry sitting on the terrain,
 * so `terrainHeightMeters` still reports the ground *under* the table. Dressing
 * placed by that height inside a plateau footprint ends up buried beneath it,
 * which is why the highlands read as bare rock while the lowland around them
 * carries grass.
 */
export function highlandTopMeters(point: MapPointMm): number | null {
  for (const highland of MAP_HIGHLANDS) {
    if (ringContains(highland.vertices, point)) {
      return highland.topHeightMm / MM_PER_METER;
    }
  }
  return null;
}

/**
 * The ground itself: the plateau top where there is one, the terrain surface
 * everywhere else. This is what the massifs stand on and what
 * `dressingSurfaceMeters` falls back to away from them.
 */
export function groundSurfaceMeters(point: MapPointMm): number {
  const terrain = terrainHeightMeters(point.x / MM_PER_METER, point.z / MM_PER_METER);
  const top = highlandTopMeters(point);
  // Whichever surface is actually on top. A plateau usually stands above the
  // ground carrying it, but the terrain rises through the table in part of at
  // least one footprint, and there the plateau is the buried one — taking the
  // plateau unconditionally would plant that dressing inside the hillside.
  return top === null ? terrain : Math.max(top, terrain);
}
