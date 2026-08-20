/**
 * Integer 2D geometry primitives for authoritative map collision.
 *
 * Coordinates are integer millimeters with |value| < 1_000_000. Every
 * product stays far below Number.MAX_SAFE_INTEGER provided segment lengths
 * are capped (see MAX_SEGMENT_LENGTH_MM subdivision in the collision field),
 * so all predicates are exact and deterministic across platforms.
 */

import type { Vec2Mm } from '@jwgb/core';

/** Longest segment the distance query accepts without overflow risk. */
export const MAX_SEGMENT_LENGTH_MM = 32_768;

export function crossOrientation(a: Vec2Mm, b: Vec2Mm, point: Vec2Mm): number {
  return (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
}

function isPointOnSegment(a: Vec2Mm, b: Vec2Mm, point: Vec2Mm): boolean {
  return (
    Math.min(a.x, b.x) <= point.x &&
    point.x <= Math.max(a.x, b.x) &&
    Math.min(a.z, b.z) <= point.z &&
    point.z <= Math.max(a.z, b.z)
  );
}

/** Inclusive integer segment intersection used by line-of-sight queries. */
export function segmentsIntersect(
  firstStart: Vec2Mm,
  firstEnd: Vec2Mm,
  secondStart: Vec2Mm,
  secondEnd: Vec2Mm,
): boolean {
  const firstToSecondStart = crossOrientation(firstStart, firstEnd, secondStart);
  const firstToSecondEnd = crossOrientation(firstStart, firstEnd, secondEnd);
  const secondToFirstStart = crossOrientation(secondStart, secondEnd, firstStart);
  const secondToFirstEnd = crossOrientation(secondStart, secondEnd, firstEnd);
  const firstStraddles =
    (firstToSecondStart < 0 && firstToSecondEnd > 0) ||
    (firstToSecondStart > 0 && firstToSecondEnd < 0);
  const secondStraddles =
    (secondToFirstStart < 0 && secondToFirstEnd > 0) ||
    (secondToFirstStart > 0 && secondToFirstEnd < 0);
  if (firstStraddles && secondStraddles) {
    return true;
  }
  return (
    (firstToSecondStart === 0 && isPointOnSegment(firstStart, firstEnd, secondStart)) ||
    (firstToSecondEnd === 0 && isPointOnSegment(firstStart, firstEnd, secondEnd)) ||
    (secondToFirstStart === 0 && isPointOnSegment(secondStart, secondEnd, firstStart)) ||
    (secondToFirstEnd === 0 && isPointOnSegment(secondStart, secondEnd, firstEnd))
  );
}

export function distanceSquaredToSegment(point: Vec2Mm, start: Vec2Mm, end: Vec2Mm): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared === 0) {
    return distanceSquaredBetween(point, start);
  }
  const projection = Math.max(
    0,
    Math.min(lengthSquared, (point.x - start.x) * deltaX + (point.z - start.z) * deltaZ),
  );
  const closest = {
    x: start.x + Math.trunc((deltaX * projection) / lengthSquared),
    z: start.z + Math.trunc((deltaZ * projection) / lengthSquared),
  };
  return distanceSquaredBetween(point, closest);
}

/** Exact even-odd containment for a possibly concave ring. */
export function ringContainsPoint(ring: readonly Vec2Mm[], point: Vec2Mm): boolean {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] as Vec2Mm;
    const b = ring[(index + 1) % ring.length] as Vec2Mm;
    if (a.z > point.z === b.z > point.z) {
      continue;
    }
    // point.x < a.x + (point.z - a.z) * (b.x - a.x) / (b.z - a.z), cross-multiplied.
    const deltaZ = b.z - a.z;
    const left = (point.x - a.x) * deltaZ;
    const right = (point.z - a.z) * (b.x - a.x);
    if (deltaZ > 0 ? left < right : left > right) {
      inside = !inside;
    }
  }
  return inside;
}

/** Exact containment for a convex CCW ring, boundary inclusive. */
export function convexContainsPoint(vertices: readonly Vec2Mm[], point: Vec2Mm): boolean {
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index] as Vec2Mm;
    const b = vertices[(index + 1) % vertices.length] as Vec2Mm;
    if (crossOrientation(a, b, point) < 0) {
      return false;
    }
  }
  return true;
}

/**
 * Closest lattice point on segment [a, b] to the query point.
 *
 * The projection parameter is truncated to integers, so the result can be
 * up to 1 mm away from the mathematically exact foot point. That epsilon is
 * acceptable for wall padding and keeps every intermediate value integral.
 * Requires |b - a| <= MAX_SEGMENT_LENGTH_MM.
 */
export function closestPointOnSegment(a: Vec2Mm, b: Vec2Mm, point: Vec2Mm): Vec2Mm {
  const abX = b.x - a.x;
  const abZ = b.z - a.z;
  const lengthSquared = abX * abX + abZ * abZ;
  if (lengthSquared === 0) {
    return a;
  }
  const apX = point.x - a.x;
  const apZ = point.z - a.z;
  const rawT = apX * abX + apZ * abZ;
  if (rawT <= 0) {
    return a;
  }
  if (rawT >= lengthSquared) {
    return b;
  }
  return {
    x: a.x + Math.trunc((abX * rawT) / lengthSquared),
    z: a.z + Math.trunc((abZ * rawT) / lengthSquared),
  };
}

export function distanceSquaredBetween(a: Vec2Mm, b: Vec2Mm): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/**
 * True when a circle overlaps a convex CCW polygon whose edges are at most
 * MAX_SEGMENT_LENGTH_MM long (enforced by the collision field constructor).
 */
export function circleOverlapsConvex(
  vertices: readonly Vec2Mm[],
  center: Vec2Mm,
  radiusMm: number,
): boolean {
  if (convexContainsPoint(vertices, center)) {
    return true;
  }
  const radiusSquared = radiusMm * radiusMm;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index] as Vec2Mm;
    const b = vertices[(index + 1) % vertices.length] as Vec2Mm;
    const closest = closestPointOnSegment(a, b, center);
    if (distanceSquaredBetween(closest, center) <= radiusSquared) {
      return true;
    }
  }
  return false;
}

/** Splits a segment into deterministic chunks no longer than the cap. */
export function subdivideSegment(a: Vec2Mm, b: Vec2Mm, maximumLengthMm: number): Vec2Mm[][] {
  const spanX = b.x - a.x;
  const spanZ = b.z - a.z;
  const span = Math.max(Math.abs(spanX), Math.abs(spanZ));
  const chunkCount = Math.max(1, Math.ceil(span / maximumLengthMm));
  const segments: Vec2Mm[][] = [];
  let previous = a;
  for (let chunk = 1; chunk <= chunkCount; chunk += 1) {
    const next =
      chunk === chunkCount
        ? b
        : {
            x: a.x + Math.trunc((spanX * chunk) / chunkCount),
            z: a.z + Math.trunc((spanZ * chunk) / chunkCount),
          };
    segments.push([previous, next]);
    previous = next;
  }
  return segments;
}
