import { describe, expect, it } from 'vitest';
import {
  CAMERA_MAX_PAN_METERS,
  CAMERA_MAX_PITCH_RADIANS,
  CAMERA_MAX_ZOOM_SCALE,
  CAMERA_MIN_PITCH_RADIANS,
  CAMERA_MIN_ZOOM_SCALE,
  cameraOffsetFromOrbit,
  cameraOrbitFromOffset,
  dragCameraPan,
  hasCameraDragStarted,
  moveCameraPan,
  normalizeWheelDelta,
  orthographicMetersPerPixel,
  rotateCameraOrbit,
  stepCameraZoomScale,
  tiltCameraPitch,
  zoomCameraScale,
} from '../apps/web/src/render/camera-controls';

describe('web camera controls', () => {
  it('round-trips a preset offset through orbit coordinates', () => {
    const source = [14, 16, 14] as const;
    const orbit = cameraOrbitFromOffset(source);
    const result = cameraOffsetFromOrbit(orbit.distance, orbit.yaw, orbit.pitch);

    expect(result[0]).toBeCloseTo(source[0], 10);
    expect(result[1]).toBeCloseTo(source[1], 10);
    expect(result[2]).toBeCloseTo(source[2], 10);
    expect((orbit.yaw * 180) / Math.PI).toBeCloseTo(45, 10);
  });

  it('uses a drag threshold so a right click remains distinct from an orbit drag', () => {
    expect(hasCameraDragStarted(100, 100, 103, 103)).toBe(false);
    expect(hasCameraDragStarted(100, 100, 104, 103)).toBe(true);
  });

  it('normalizes wheel units and clamps continuous zoom', () => {
    expect(normalizeWheelDelta(3, 1, 800)).toBe(48);
    expect(normalizeWheelDelta(1, 2, 800)).toBe(680);
    expect(zoomCameraScale(1, -120)).toBeGreaterThan(1);
    expect(zoomCameraScale(1, 120)).toBeLessThan(1);
    expect(zoomCameraScale(1, -100_000)).toBe(CAMERA_MAX_ZOOM_SCALE);
    expect(zoomCameraScale(1, 100_000)).toBe(CAMERA_MIN_ZOOM_SCALE);
    expect(stepCameraZoomScale(CAMERA_MAX_ZOOM_SCALE, 1)).toBe(CAMERA_MAX_ZOOM_SCALE);
    expect(stepCameraZoomScale(CAMERA_MIN_ZOOM_SCALE, -1)).toBe(CAMERA_MIN_ZOOM_SCALE);
  });

  it('rotates, tilts, and clamps the camera orbit', () => {
    const raised = rotateCameraOrbit(0, Math.PI / 4, 0, -100_000);
    const lowered = rotateCameraOrbit(0, Math.PI / 4, 0, 100_000);

    expect(raised.pitch).toBe(CAMERA_MAX_PITCH_RADIANS);
    expect(lowered.pitch).toBe(CAMERA_MIN_PITCH_RADIANS);
    expect(rotateCameraOrbit(0, Math.PI / 4, -100, 0).yaw).toBeGreaterThan(0);
    expect(tiltCameraPitch(Math.PI / 4, 100_000)).toBe(CAMERA_MAX_PITCH_RADIANS);
  });

  it('maps drag and keyboard pan to camera-relative ground movement', () => {
    expect(orthographicMetersPerPixel(24, 1.2, 1_000)).toBeCloseTo(0.02, 10);

    const dragged = dragCameraPan({ x: 0, z: 0 }, 100, 0, 0, 0.01);
    expect(dragged.x).toBeCloseTo(-1, 10);
    expect(dragged.z).toBeCloseTo(0, 10);

    const movedUp = moveCameraPan({ x: 0, z: 0 }, 0, 1, 0, 2);
    expect(movedUp.x).toBeCloseTo(0, 10);
    expect(movedUp.z).toBeCloseTo(-2, 10);

    const clamped = moveCameraPan({ x: 0, z: 0 }, 1, 1, 0, 10_000);
    expect(Math.hypot(clamped.x, clamped.z)).toBeCloseTo(CAMERA_MAX_PAN_METERS, 10);
  });
});
