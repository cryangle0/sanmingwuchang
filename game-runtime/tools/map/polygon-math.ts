/**
 * Integer 2D polygon primitives shared by the map geometry compiler.
 *
 * All coordinates are integer millimeters. Cross products of map-scale
 * coordinates (|v| <= 450_000) stay far inside the float64 exact-integer
 * range, so every predicate here is deterministic across platforms.
 */

export interface CompilePoint {
  readonly x: number;
  readonly z: number;
}

export function crossOrientation(a: CompilePoint, b: CompilePoint, c: CompilePoint): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

/** Twice the signed area; positive for counter-clockwise rings. */
export function doubledSignedArea(ring: readonly CompilePoint[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index] as CompilePoint;
    const next = ring[(index + 1) % ring.length] as CompilePoint;
    sum += current.x * next.z - next.x * current.z;
  }
  return sum;
}

export function ensureCounterClockwise(ring: readonly CompilePoint[]): CompilePoint[] {
  return doubledSignedArea(ring) >= 0 ? [...ring] : [...ring].reverse();
}

/** Removes consecutive duplicates and collinear vertices without changing shape. */
export function simplifyRing(ring: readonly CompilePoint[]): CompilePoint[] {
  const deduped: CompilePoint[] = [];
  for (const point of ring) {
    const previous = deduped[deduped.length - 1];
    if (previous === undefined || previous.x !== point.x || previous.z !== point.z) {
      deduped.push(point);
    }
  }
  while (deduped.length > 1) {
    const first = deduped[0] as CompilePoint;
    const last = deduped[deduped.length - 1] as CompilePoint;
    if (first.x === last.x && first.z === last.z) {
      deduped.pop();
    } else {
      break;
    }
  }

  const simplified: CompilePoint[] = [];
  for (let index = 0; index < deduped.length; index += 1) {
    const previous = deduped[(index + deduped.length - 1) % deduped.length] as CompilePoint;
    const current = deduped[index] as CompilePoint;
    const next = deduped[(index + 1) % deduped.length] as CompilePoint;
    if (crossOrientation(previous, current, next) !== 0) {
      simplified.push(current);
    }
  }
  return simplified;
}

export function isConvexRing(ring: readonly CompilePoint[]): boolean {
  if (ring.length < 3) {
    return false;
  }
  for (let index = 0; index < ring.length; index += 1) {
    const previous = ring[(index + ring.length - 1) % ring.length] as CompilePoint;
    const current = ring[index] as CompilePoint;
    const next = ring[(index + 1) % ring.length] as CompilePoint;
    if (crossOrientation(previous, current, next) < 0) {
      return false;
    }
  }
  return true;
}

/** Inclusive point-in-triangle test for a counter-clockwise triangle. */
export function pointInTriangleInclusive(
  point: CompilePoint,
  a: CompilePoint,
  b: CompilePoint,
  c: CompilePoint,
): boolean {
  return (
    crossOrientation(a, b, point) >= 0 &&
    crossOrientation(b, c, point) >= 0 &&
    crossOrientation(c, a, point) >= 0
  );
}
