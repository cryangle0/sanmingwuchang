import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createSkyDome,
  SKY_CLOUD_DRIFT_PER_SECOND,
  SKY_DOME_RADIUS_METERS,
} from '../apps/web/src/render/map/atmosphere';

/** Mirrors the far plane of the arena camera in arena-renderer.ts. */
const ARENA_CAMERA_FAR_METERS = 600;

describe('map sky dome', () => {
  it('stays inside the camera far plane so the GPU never clips the sky away', () => {
    expect(SKY_DOME_RADIUS_METERS).toBeGreaterThan(100);
    expect(SKY_DOME_RADIUS_METERS).toBeLessThan(ARENA_CAMERA_FAR_METERS * 0.9);
  });

  it('renders as a camera-centred, direction-keyed dome behind everything else', () => {
    const dome = createSkyDome();
    try {
      expect(dome.material.side).toBe(THREE.BackSide);
      expect(dome.material.depthTest).toBe(false);
      expect(dome.material.depthWrite).toBe(false);
      expect(dome.renderOrder).toBeLessThan(0);
      expect(dome.frustumCulled).toBe(false);
      // Clouds must be a function of the world view direction, not screen UVs,
      // otherwise they slide with every mouse orbit.
      expect(dome.material.vertexShader).toContain('vDirection = position');
      expect(dome.material.fragmentShader).toContain('normalize(vDirection)');
      expect(dome.material.fragmentShader).not.toContain('gl_FragCoord');
      expect(dome.material.uniforms.uTime?.value).toBe(0);
      const wind = dome.material.uniforms.uWind?.value as THREE.Vector2;
      expect(wind.length()).toBeCloseTo(SKY_CLOUD_DRIFT_PER_SECOND, 6);
      expect(SKY_CLOUD_DRIFT_PER_SECOND).toBeLessThan(0.02);
      // The sky is never a pick target.
      const hits: THREE.Intersection[] = [];
      dome.raycast(new THREE.Raycaster(), hits);
      expect(hits).toHaveLength(0);
    } finally {
      dome.geometry.dispose();
      dome.material.dispose();
    }
  });
});
