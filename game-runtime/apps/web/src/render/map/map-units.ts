/**
 * The one place the renderer converts authoritative integer millimeters into
 * three.js world meters. Every map module imports from here so the conversion
 * can never drift between the collision field and what the player sees.
 */

export const MM_PER_METER = 1_000;

/** Authoritative millimeters to render meters. */
export function toMeters(millimeters: number): number {
  return millimeters / MM_PER_METER;
}

/** Render meters back to millimeters, for picking and minimap hit tests. */
export function toMillimeters(meters: number): number {
  return Math.round(meters * MM_PER_METER);
}

export interface PointMeters {
  readonly x: number;
  readonly z: number;
}

export function pointToMeters(point: { readonly x: number; readonly z: number }): PointMeters {
  return { x: toMeters(point.x), z: toMeters(point.z) };
}

/** Area centroid is overkill here; map rings are convex enough for the mean. */
export function ringCentroidMeters(
  ring: readonly { readonly x: number; readonly z: number }[],
): PointMeters {
  let sumX = 0;
  let sumZ = 0;
  for (const point of ring) {
    sumX += point.x;
    sumZ += point.z;
  }
  return { x: toMeters(sumX / ring.length), z: toMeters(sumZ / ring.length) };
}
