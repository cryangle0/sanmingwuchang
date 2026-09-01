import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createSpawnMarkerVisual,
  hasMovedFromSpawn,
  SPAWN_AURA_HEIGHT,
  SPAWN_CIRCLE_RIM_FILL,
  SPAWN_MARKER_DISMISS_DISTANCE_MM,
  SPAWN_MARKER_HEIGHT,
  updateSpawnMarkerVisual,
} from '../apps/web/src/render/spawn-marker';

const spawnVfxRoot = resolve(import.meta.dirname, '../apps/web/public/vfx/spawn');

function disposeSpawnMarker(visual: ReturnType<typeof createSpawnMarkerVisual>): void {
  visual.pillarTexture.dispose();
  visual.sparkTexture.dispose();
  visual.auraTexture.dispose();
  visual.circleTexture.dispose();
  visual.ringTexture.dispose();
  visual.group.traverse((object) => {
    if (object instanceof THREE.Points) {
      object.geometry.dispose();
      object.material.dispose();
      return;
    }
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    object.geometry.dispose();
    object.material.dispose();
  });
}

describe('web spawn marker', () => {
  it('dismisses only after the player has actually left the spawn point', () => {
    expect(hasMovedFromSpawn(100, -200, 100, -200 + SPAWN_MARKER_DISMISS_DISTANCE_MM - 1)).toBe(
      false,
    );
    expect(hasMovedFromSpawn(100, -200, 100, -200 + SPAWN_MARKER_DISMISS_DISTANCE_MM)).toBe(true);
  });

  it('ships packed azure-dragon spawn vfx', () => {
    const manifest = JSON.parse(readFileSync(resolve(spawnVfxRoot, 'manifest.json'), 'utf8')) as {
      readonly schema: string;
      readonly option: number;
      readonly aura: { readonly file: string; readonly frames: number; readonly columns: number };
      readonly circle: { readonly file: string };
      readonly ring: { readonly file: string };
      readonly ray: { readonly file: string };
      readonly spark: { readonly file: string };
    };

    expect(manifest.schema).toBe('jwgb.spawn-vfx.v1');
    expect(manifest.option).toBe(1);
    expect(manifest.aura.frames).toBe(22);
    expect(manifest.aura.columns).toBe(8);
    for (const file of [
      manifest.aura.file,
      manifest.circle.file,
      manifest.ring.file,
      manifest.ray.file,
      manifest.spark.file,
    ]) {
      expect(statSync(resolve(spawnVfxRoot, file)).size).toBeGreaterThan(1_000);
    }
  });

  it('wraps the character with a see-through additive pillar', () => {
    const visual = createSpawnMarkerVisual(0.7, 0.94, 0.085);
    const meshes: THREE.Mesh[] = [];
    visual.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        meshes.push(object);
      }
    });

    expect(visual.group.name).toBe('player-spawn-marker');
    expect(visual.auras).toHaveLength(3);
    expect(visual.planes).toHaveLength(3);
    expect(visual.auras[0]?.geometry.parameters.height).toBe(SPAWN_AURA_HEIGHT);
    expect(visual.auras[0]?.geometry.parameters.height).toBeGreaterThan(4);
    expect(visual.auras[0]?.geometry.parameters.height).toBeLessThan(5.5);
    expect(visual.auras[0]?.geometry.parameters.width).toBeCloseTo(
      visual.circle.geometry.parameters.width * SPAWN_CIRCLE_RIM_FILL,
    );
    expect(visual.auras[0]?.material.opacity).toBeLessThan(0.7);
    expect(visual.planes[0]?.geometry.parameters.height).toBeGreaterThan(18);
    expect(visual.planes[0]?.geometry.parameters.width).toBeCloseTo(
      visual.circle.geometry.parameters.width * SPAWN_CIRCLE_RIM_FILL,
    );
    expect(visual.beam.geometry.parameters.radiusBottom).toBeCloseTo(
      (visual.circle.geometry.parameters.width / 2) * SPAWN_CIRCLE_RIM_FILL,
    );
    expect(visual.beam.geometry.parameters.radiusTop).toBeLessThan(
      visual.beam.geometry.parameters.radiusBottom,
    );
    expect(visual.beam.geometry.parameters.openEnded).toBe(true);
    expect(visual.beam.geometry.parameters.height).toBe(SPAWN_MARKER_HEIGHT);
    expect(visual.group.getObjectByName('player-spawn-marker-circle')).toBeDefined();
    expect(visual.group.getObjectByName('player-spawn-marker-ring')).toBeDefined();
    expect(visual.group.getObjectByName('player-spawn-marker-aura-0')).toBeDefined();
    expect(visual.group.getObjectByName('player-spawn-marker-beam')).toBeDefined();
    expect(visual.group.getObjectByName('player-spawn-marker-core')).toBeDefined();
    expect(visual.group.getObjectByName('player-spawn-marker-motes')).toBeDefined();
    expect(visual.group.getObjectByName('player-spawn-marker-blade-0')).toBeUndefined();
    expect(visual.group.getObjectByName('player-spawn-marker-sigil')).toBeUndefined();
    expect(visual.group.getObjectByName('player-spawn-marker-crest')).toBeUndefined();
    expect(meshes.some((mesh) => mesh.geometry instanceof THREE.ConeGeometry)).toBe(false);
    expect(
      meshes.every((mesh) => {
        const material = mesh.material;
        return material instanceof THREE.Material && material.blending === THREE.AdditiveBlending;
      }),
    ).toBe(true);

    const initialOpacity = visual.beam.material.opacity;
    const initialMoteY = visual.motes.geometry.getAttribute('position').getY(0);
    updateSpawnMarkerVisual(visual, 0);
    expect(visual.auraTexture.offset.x).toBe(0);
    updateSpawnMarkerVisual(visual, 1.25);
    expect(visual.auraTexture.offset.x).toBeCloseTo(0.5);
    expect(visual.beam.material.opacity).not.toBe(initialOpacity);
    expect(visual.beam.scale.x).toBe(1);
    expect(visual.beam.scale.z).toBe(1);
    expect(visual.motes.geometry.getAttribute('position').getY(0)).not.toBe(initialMoteY);
    const moteRadius = Math.hypot(
      visual.motes.geometry.getAttribute('position').getX(0),
      visual.motes.geometry.getAttribute('position').getZ(0),
    );
    expect(moteRadius).toBeGreaterThan(visual.beam.geometry.parameters.radiusBottom * 0.8);

    disposeSpawnMarker(visual);
  });
});
