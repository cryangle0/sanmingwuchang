import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addRoof, type GeometryBag } from '../apps/web/src/render/map/dressing/prop-kit';
import {
  buildRoofOcclusionBatch,
  MapOcclusionController,
  occluderSegmentHitsBox,
  roofOccluderSource,
} from '../apps/web/src/render/map/map-occlusion';

function roof(id: string, x: number): ReturnType<typeof roofOccluderSource> {
  const geometries: GeometryBag = [];
  addRoof(geometries, { x, z: 0, yaw: 0 }, 0, 3, 0, 6, 5, 1);
  return roofOccluderSource(id, geometries);
}

describe('web map occlusion', () => {
  it('fades only the blocking structure and restores the shared batch', () => {
    const parent = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    const tracked: THREE.BufferGeometry[] = [];
    const batch = buildRoofOcclusionBatch(
      parent,
      'test-roofs',
      [],
      [roof('near', 0), roof('far', 20)],
      material,
      <T extends THREE.BufferGeometry>(geometry: T): T => {
        tracked.push(geometry);
        return geometry;
      },
    );
    expect(batch).not.toBeNull();
    if (!batch) {
      return;
    }
    const controller = new MapOcclusionController([batch]);
    const near = batch.targets.find((target) => target.id === 'near');
    const far = batch.targets.find((target) => target.id === 'far');
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    if (!near || !far) {
      return;
    }

    controller.update(new THREE.Vector3(0, 10, 10), new THREE.Vector3(0, 0.9, 0));
    const blocked = controller.diagnostics();
    expect(blocked.active).toBe(true);
    expect(blocked.activeOccluderIds).toEqual(['near']);
    expect(blocked.roofIntersections).toBe(1);
    expect(blocked.roofOpacity).toBeLessThan(0.25);
    expect(material.transparent).toBe(false);
    expect(batch.mesh.castShadow).toBe(true);

    const positions = batch.mesh.geometry.getAttribute('position');
    expect(positions.getY(near.startVertex)).toBeLessThan(-9_000);
    const farOriginalY = batch.originalPositions[far.startVertex * 3 + 1];
    expect(positions.getY(far.startVertex)).toBeCloseTo(farOriginalY ?? Number.NaN);
    const nearGhost = parent.getObjectByName('occlusion-ghost-near');
    expect(nearGhost).toBeInstanceOf(THREE.Mesh);
    if (nearGhost instanceof THREE.Mesh && nearGhost.material instanceof THREE.Material) {
      expect(nearGhost.material.depthWrite).toBe(false);
      expect(nearGhost.castShadow).toBe(false);
    }
    expect(parent.getObjectByName('occlusion-ghost-far')).toBeUndefined();

    for (let frame = 0; frame < 60; frame += 1) {
      controller.update(new THREE.Vector3(40, 10, 10), new THREE.Vector3(40, 0.9, 0));
    }
    const clear = controller.diagnostics();
    expect(clear.active).toBe(false);
    expect(clear.roofOpacity).toBe(1);
    expect(clear.fadingOccluderCount).toBe(0);
    expect(positions.getY(near.startVertex)).toBeCloseTo(
      batch.originalPositions[near.startVertex * 3 + 1] ?? Number.NaN,
    );
    expect(parent.getObjectByName('occlusion-ghost-near')?.visible).toBe(false);

    controller.dispose();
    for (const geometry of tracked) {
      geometry.dispose();
    }
    material.dispose();
  });

  it('rejects a structure above the eye-to-camera segment', () => {
    expect(occluderSegmentHitsBox(0, 0, 3, 3, 2, 0, 3, 0, 0, 10, 10)).toBe(false);
  });
});
