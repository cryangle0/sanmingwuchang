import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  type CameraFollowState,
  exponentialDampingFactor,
  updateCameraFollowState,
} from '../apps/web/src/render/camera-follow';

function cameraPosition(state: CameraFollowState): THREE.Vector3 {
  return state.focus.clone().add(state.offset);
}

describe('web camera follow', () => {
  it('keeps the camera-to-focus direction stable while following discrete movement', () => {
    const state: CameraFollowState = {
      focus: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      zoom: 1,
    };
    const desiredFocus = new THREE.Vector3();
    const desiredOffset = new THREE.Vector3(18, 24, 18);

    updateCameraFollowState(state, desiredFocus, desiredOffset, 1, 0, true);

    for (let frame = 1; frame <= 180; frame += 1) {
      if (frame % 3 === 0) {
        desiredFocus.x += 0.24;
        desiredFocus.z -= 0.08;
      }
      updateCameraFollowState(state, desiredFocus, desiredOffset, 1, 1 / 60, false);
      const relativeOffset = cameraPosition(state).sub(state.focus);
      expect(relativeOffset.distanceTo(state.offset)).toBeLessThan(1e-9);
      expect(relativeOffset.x).toBeCloseTo(18, 8);
      expect(relativeOffset.y).toBeCloseTo(24, 8);
      expect(relativeOffset.z).toBeCloseTo(18, 8);
    }

    expect(state.focus.x).toBeGreaterThan(10);
  });

  it('uses frame-time-independent damping and clamps long frames', () => {
    const oneSixtieth = exponentialDampingFactor(14, 1 / 60);
    const twoSixtieths = exponentialDampingFactor(14, 2 / 60);
    const composed = 1 - (1 - oneSixtieth) ** 2;

    expect(twoSixtieths).toBeCloseTo(composed, 10);
    expect(exponentialDampingFactor(14, 5)).toBe(exponentialDampingFactor(14, 0.075));
  });

  it('limits a delayed network snapshot to a smooth per-frame focus step', () => {
    const state: CameraFollowState = {
      focus: new THREE.Vector3(),
      offset: new THREE.Vector3(18, 24, 18),
      zoom: 1,
    };

    updateCameraFollowState(
      state,
      new THREE.Vector3(12, 0, 0),
      new THREE.Vector3(18, 24, 18),
      1,
      0.075,
      false,
    );

    expect(state.focus.length()).toBeCloseTo(0.38, 10);
  });
});
