/**
 * Deterministic ear-clipping triangulation for simple polygons.
 *
 * The polygon must be counter-clockwise, deduplicated, and free of collinear
 * vertices (see simplifyRing). Runs in O(n^3) worst case, which is fine for
 * map walls capped at a few dozen vertices. Always clips the lowest-index
 * available ear so output is stable for identical input.
 */

import { type CompilePoint, crossOrientation, pointInTriangleInclusive } from './polygon-math';

export type TriangleIndices = readonly [number, number, number];

export function triangulateRing(ring: readonly CompilePoint[]): TriangleIndices[] {
  if (ring.length < 3) {
    throw new Error(`triangulateRing: ring needs >= 3 vertices, got ${ring.length}`);
  }

  const remaining: number[] = ring.map((_, index) => index);
  const triangles: TriangleIndices[] = [];

  while (remaining.length > 3) {
    const earPosition = findEarPosition(ring, remaining);
    if (earPosition === -1) {
      throw new Error('triangulateRing: no ear found; polygon is not simple');
    }
    const previous = remaining[(earPosition + remaining.length - 1) % remaining.length] as number;
    const current = remaining[earPosition] as number;
    const next = remaining[(earPosition + 1) % remaining.length] as number;
    triangles.push([previous, current, next]);
    remaining.splice(earPosition, 1);
  }

  triangles.push([remaining[0] as number, remaining[1] as number, remaining[2] as number]);
  return triangles;
}

function findEarPosition(ring: readonly CompilePoint[], remaining: readonly number[]): number {
  for (let position = 0; position < remaining.length; position += 1) {
    if (isEar(ring, remaining, position)) {
      return position;
    }
  }
  return -1;
}

function isEar(
  ring: readonly CompilePoint[],
  remaining: readonly number[],
  position: number,
): boolean {
  const count = remaining.length;
  const previousIndex = remaining[(position + count - 1) % count] as number;
  const currentIndex = remaining[position] as number;
  const nextIndex = remaining[(position + 1) % count] as number;
  const a = ring[previousIndex] as CompilePoint;
  const b = ring[currentIndex] as CompilePoint;
  const c = ring[nextIndex] as CompilePoint;

  if (crossOrientation(a, b, c) <= 0) {
    return false;
  }

  for (const otherIndex of remaining) {
    if (otherIndex === previousIndex || otherIndex === currentIndex || otherIndex === nextIndex) {
      continue;
    }
    if (pointInTriangleInclusive(ring[otherIndex] as CompilePoint, a, b, c)) {
      return false;
    }
  }
  return true;
}
