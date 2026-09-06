import * as THREE from 'three';
import type { MapMaterialLibrary } from './map-palette';
import { type MassifFacet, type MassifVertex, massifModel } from './massif-surface';

/**
 * 封界级 (BOUND) walls drawn as rocky massifs.
 *
 * The shape lives in `massif-surface.ts` so the grass and trees standing on a
 * range are placed on the same facets that are drawn here. This file only
 * turns those facets into one flat-shaded mesh.
 */

/** World metres per texture tile on a slope. */
const TEXTURE_METERS = 13;

// Same rule as the boundary escarpment: the low end of a ridge is shaded
// stone under an open sky, so it stays a readable cool-warm grey rather than
// sinking toward the dark olive it used to reach.
const SLOPE_LOW = new THREE.Color(0x77806a);
const SLOPE_HIGH = new THREE.Color(0xb3ae99);

export function buildInteriorRidges(
  group: THREE.Group,
  materials: MapMaterialLibrary,
  track: <T extends THREE.BufferGeometry>(geometry: T) => T,
): number {
  const model = massifModel();
  if (model.facets.length === 0) {
    return 0;
  }
  const builder = new FacetBuilder();
  for (const facet of model.facets) {
    builder.triangle(facet);
  }
  const mesh = new THREE.Mesh(track(builder.build()), materials.boundaryCliffFace);
  mesh.name = 'interior-ridges';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return model.massifs;
}

/** Unshared triangles, so every facet keeps its own hard normal. */
class FacetBuilder {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colour = new THREE.Color();

  triangle(facet: MassifFacet): void {
    for (const point of [facet.a, facet.b, facet.c]) {
      this.vertex(point, facet.reliefMeters);
    }
  }

  private vertex(point: MassifVertex, reliefMeters: number): void {
    this.positions.push(point.x, point.y, point.z);
    // Vertical bedding. A top-down planar projection smears the texture to
    // nothing on the steep faces, which is most of a mountain.
    this.uvs.push((point.x + point.z) / TEXTURE_METERS, point.y / TEXTURE_METERS);
    // Climb is measured from the ground under this column, not from the
    // lowest corner of the triangle: a per-triangle datum restarts the ramp
    // on every facet and flattens the whole massif to its darkest tone.
    const climbMeters = Math.max(0, point.y - point.footY);
    const climb = Math.min(1, climbMeters / Math.max(1, reliefMeters));
    this.colour.copy(SLOPE_LOW).lerp(SLOPE_HIGH, climb ** 0.7);
    this.colours.push(this.colour.r, this.colour.g, this.colour.b);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}
