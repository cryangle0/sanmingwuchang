import type { MapPointMm } from '@jwgb/content';

/** Point-in-ring by crossing count; works for concave rings. */
export function ringContains(ring: readonly MapPointMm[], point: MapPointMm): boolean {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] as MapPointMm;
    const b = ring[(index + 1) % ring.length] as MapPointMm;
    if (a.z > point.z === b.z > point.z) {
      continue;
    }
    const intersectX = a.x + ((point.z - a.z) * (b.x - a.x)) / (b.z - a.z);
    if (point.x < intersectX) {
      inside = !inside;
    }
  }
  return inside;
}

/** Half-plane test for the compiled convex pieces (counter-clockwise winding). */
export function convexContains(vertices: readonly MapPointMm[], point: MapPointMm): boolean {
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index] as MapPointMm;
    const b = vertices[(index + 1) % vertices.length] as MapPointMm;
    if ((b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x) < 0) {
      return false;
    }
  }
  return true;
}
