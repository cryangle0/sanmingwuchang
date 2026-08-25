import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRoadRibbons } from '../apps/web/src/render/map/roads';

describe('web road rendering', () => {
  const materials = {
    roadShoulder: new THREE.MeshBasicMaterial(),
    roadMinor: new THREE.MeshBasicMaterial(),
    roadRisk: new THREE.MeshBasicMaterial(),
    roadMajor: new THREE.MeshBasicMaterial(),
  } as unknown as Parameters<typeof buildRoadRibbons>[1];
  const meshes: THREE.Mesh[] = [];

  afterEach(() => {
    for (const mesh of meshes.splice(0)) {
      mesh.geometry.dispose();
    }
  });

  it('renders overlapping road layers without writing competing depth values', () => {
    buildRoadRibbons((geometry, material) => {
      const mesh = new THREE.Mesh(geometry, material);
      meshes.push(mesh);
      return mesh;
    }, materials);

    expect(meshes.map((mesh) => mesh.name)).toEqual([
      'map-road-shoulder',
      'map-road-minor',
      'map-road-risk',
      'map-road-major',
    ]);
    expect(meshes.map((mesh) => mesh.renderOrder)).toEqual([1, 2, 3, 4]);

    for (const mesh of meshes) {
      const material = mesh.material as THREE.Material;
      // Overlap is resolved by keeping the overlays out of the depth buffer and
      // letting the fixed renderOrder above decide, so the result is camera
      // independent. Polygon offset was the older mechanism for this and is
      // deliberately off: leaving both on would nudge the ribbons toward the
      // camera for no benefit.
      expect(material.depthWrite).toBe(false);
      expect(material.depthTest).toBe(true);
      expect(material.polygonOffset).toBe(false);
    }
  });
});
