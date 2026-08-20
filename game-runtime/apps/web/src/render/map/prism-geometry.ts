import type { MapPointMm } from '@jwgb/content';
import * as THREE from 'three';

const MM_PER_METER = 1_000;

/**
 * Accumulates flat-shaded prisms and polygon caps into one merged
 * non-indexed BufferGeometry, so each map material costs a single draw call.
 *
 * Input rings are sim-CCW (x east, z north) integer millimeters; output
 * positions are world meters. Triangle winding is flipped where needed so
 * top faces point +Y and side walls point outward.
 *
 * UVs are always emitted in world meters — texture density is chosen by the
 * material's texture repeat. Caps use planar x/z mapping; side walls unwrap
 * as accumulated perimeter distance × height, so vertical faces tile stone
 * courses instead of smearing a planar projection.
 */
export class PrismGeometryAccumulator {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];

  /** Adds the top cap and side walls of an extruded convex ring. */
  addConvexPrism(ring: readonly MapPointMm[], baseYMeters: number, topYMeters: number): void {
    this.addConvexCap(ring, topYMeters);
    this.addSides(ring, baseYMeters, topYMeters);
  }

  /** Adds a flat convex polygon cap facing +Y with planar world UVs. */
  addConvexCap(ring: readonly MapPointMm[], yMeters: number): void {
    for (let index = 1; index + 1 < ring.length; index += 1) {
      this.pushTriangleCap(
        ring[0] as MapPointMm,
        ring[index] as MapPointMm,
        ring[index + 1] as MapPointMm,
        yMeters,
      );
    }
  }

  /** Adds a pre-triangulated (possibly concave) polygon cap facing +Y. */
  addTriangulatedCap(
    ring: readonly MapPointMm[],
    triangles: readonly (readonly [number, number, number])[],
    yMeters: number,
  ): void {
    for (const [a, b, c] of triangles) {
      this.pushTriangleCap(
        ring[a] as MapPointMm,
        ring[b] as MapPointMm,
        ring[c] as MapPointMm,
        yMeters,
      );
    }
  }

  /** Adds outward-facing side quads for an extruded ring. */
  addSides(ring: readonly MapPointMm[], baseYMeters: number, topYMeters: number): void {
    // Perimeter distance accumulates across edges so stone courses continue
    // around corners instead of restarting on every face.
    let perimeter = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index] as MapPointMm;
      const b = ring[(index + 1) % ring.length] as MapPointMm;
      const ax = a.x / MM_PER_METER;
      const az = a.z / MM_PER_METER;
      const bx = b.x / MM_PER_METER;
      const bz = b.z / MM_PER_METER;
      const edgeLength = Math.hypot(bx - ax, bz - az);
      const u0 = perimeter;
      const u1 = perimeter + edgeLength;
      perimeter = u1;
      // Corners: A/B at base, C/D at top; triangles (A,D,C) and (A,C,B)
      // give outward normals for a sim-CCW ring.
      this.pushSideVertex(ax, baseYMeters, az, u0);
      this.pushSideVertex(ax, topYMeters, az, u0);
      this.pushSideVertex(bx, topYMeters, bz, u1);
      this.pushSideVertex(ax, baseYMeters, az, u0);
      this.pushSideVertex(bx, topYMeters, bz, u1);
      this.pushSideVertex(bx, baseYMeters, bz, u1);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  get isEmpty(): boolean {
    return this.positions.length === 0;
  }

  private pushTriangleCap(a: MapPointMm, b: MapPointMm, c: MapPointMm, yMeters: number): void {
    // Sim-CCW rings produce -Y normals in three.js space; flip to face +Y.
    this.pushCapVertex(a.x / MM_PER_METER, yMeters, a.z / MM_PER_METER);
    this.pushCapVertex(c.x / MM_PER_METER, yMeters, c.z / MM_PER_METER);
    this.pushCapVertex(b.x / MM_PER_METER, yMeters, b.z / MM_PER_METER);
  }

  private pushCapVertex(x: number, y: number, z: number): void {
    this.positions.push(x, y, z);
    this.uvs.push(x, z);
  }

  private pushSideVertex(x: number, y: number, z: number, u: number): void {
    this.positions.push(x, y, z);
    this.uvs.push(u, y);
  }
}
