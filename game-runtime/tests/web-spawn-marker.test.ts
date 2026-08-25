import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createSpawnMarkerVisual,
  hasMovedFromSpawn,
  SPAWN_MARKER_DISMISS_DISTANCE_MM,
  updateSpawnMarkerVisual,
} from '../apps/web/src/render/spawn-marker';

describe('web spawn marker', () => {
  it('dismisses only after the player has actually left the spawn point', () => {
    expect(hasMovedFromSpawn(100, -200, 100, -200 + SPAWN_MARKER_DISMISS_DISTANCE_MM - 1)).toBe(
      false,
    );
    expect(hasMovedFromSpawn(100, -200, 100, -200 + SPAWN_MARKER_DISMISS_DISTANCE_MM)).toBe(true);
  });

  it('uses additive upward geometry without adding a dynamic light', () => {
    const visual = createSpawnMarkerVisual(0.7, 0.94, 0.085);
    const meshes: THREE.Mesh[] = [];
    visual.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        meshes.push(object);
      }
    });

    expect(visual.group.name).toBe('player-spawn-marker');
    expect(meshes.length).toBeGreaterThan(20);
    expect(meshes.every((mesh) => mesh.material instanceof THREE.Material)).toBe(true);
    expect(
      meshes.some((mesh) => {
        const material = mesh.material;
        return material instanceof THREE.Material && material.blending === THREE.NormalBlending;
      }),
    ).toBe(true);
    expect(
      meshes.some((mesh) => {
        const material = mesh.material;
        return material instanceof THREE.Material && material.blending === THREE.AdditiveBlending;
      }),
    ).toBe(true);
    expect(visual.innerRing.geometry).toBeInstanceOf(THREE.TorusGeometry);
    expect(visual.blades).toHaveLength(6);
    expect(visual.blades[0]?.name).toBe('player-spawn-marker-blade-0');
    expect(visual.sigil.name).toBe('player-spawn-marker-sigil');
    expect(meshes.some((mesh) => mesh.geometry instanceof THREE.CylinderGeometry)).toBe(true);
    expect(visual.group.getObjectByName('player-spawn-marker-beam')).toBeDefined();
    expect(visual.group.getObjectByName('player-spawn-marker-crest')).toBeDefined();
    expect(meshes.some((mesh) => mesh.geometry instanceof THREE.ConeGeometry)).toBe(true);

    const initialOpacity = visual.beam.material.opacity;
    updateSpawnMarkerVisual(visual, 1.25);
    expect(visual.beam.material.opacity).not.toBe(initialOpacity);

    visual.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      object.geometry.dispose();
      object.material.dispose();
    });
  });
});
