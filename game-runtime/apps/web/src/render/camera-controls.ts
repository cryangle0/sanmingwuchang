export interface CameraOrbit {
  readonly distance: number;
  readonly yaw: number;
  readonly pitch: number;
}

export interface CameraPan {
  readonly x: number;
  readonly z: number;
}

export const CAMERA_DRAG_THRESHOLD_PX = 5;
export const CAMERA_MIN_ZOOM_SCALE = 0.58;
export const CAMERA_MAX_ZOOM_SCALE = 1.8;
export const CAMERA_MIN_PITCH_RADIANS = 0;
export const CAMERA_MAX_PITCH_RADIANS = (68 * Math.PI) / 180;
export const CAMERA_MAX_PAN_METERS = 34;

const FULL_TURN_RADIANS = Math.PI * 2;
const CAMERA_ROTATION_RADIANS_PER_PIXEL = 0.0045;
const CAMERA_TILT_RADIANS_PER_WHEEL_PIXEL = 0.0008;
const CAMERA_ZOOM_RESPONSE_PER_PIXEL = 0.0015;
const CAMERA_KEY_ZOOM_FACTOR = 1.12;
const MOVEMENT_AXIS_SCALE = 1_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeCameraYaw(yaw: number): number {
  const wrapped = (yaw + Math.PI) % FULL_TURN_RADIANS;
  return (wrapped < 0 ? wrapped + FULL_TURN_RADIANS : wrapped) - Math.PI;
}

export function clampCameraPitch(pitch: number): number {
  return clamp(pitch, CAMERA_MIN_PITCH_RADIANS, CAMERA_MAX_PITCH_RADIANS);
}

export function cameraOrbitFromOffset(offset: readonly [number, number, number]): CameraOrbit {
  const horizontalDistance = Math.hypot(offset[0], offset[2]);
  return {
    distance: Math.hypot(horizontalDistance, offset[1]),
    yaw: normalizeCameraYaw(Math.atan2(offset[0], offset[2])),
    pitch: clampCameraPitch(Math.atan2(offset[1], horizontalDistance)),
  };
}

export function cameraOffsetFromOrbit(
  distance: number,
  yaw: number,
  pitch: number,
): readonly [number, number, number] {
  const safeDistance = Math.max(0.001, distance);
  const safePitch = clampCameraPitch(pitch);
  const horizontalDistance = Math.cos(safePitch) * safeDistance;
  return [
    Math.sin(yaw) * horizontalDistance,
    Math.sin(safePitch) * safeDistance,
    Math.cos(yaw) * horizontalDistance,
  ];
}

export function rotateCameraOrbit(
  yaw: number,
  pitch: number,
  deltaX: number,
  deltaY: number,
): Pick<CameraOrbit, 'yaw' | 'pitch'> {
  return {
    yaw: normalizeCameraYaw(yaw - deltaX * CAMERA_ROTATION_RADIANS_PER_PIXEL),
    pitch: clampCameraPitch(pitch - deltaY * CAMERA_ROTATION_RADIANS_PER_PIXEL),
  };
}

export function tiltCameraPitch(pitch: number, wheelDeltaPixels: number): number {
  return clampCameraPitch(pitch + wheelDeltaPixels * CAMERA_TILT_RADIANS_PER_WHEEL_PIXEL);
}

export function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  if (deltaMode === 1) {
    return deltaY * 16;
  }
  if (deltaMode === 2) {
    return deltaY * Math.max(1, viewportHeight) * 0.85;
  }
  return deltaY;
}

export function zoomCameraScale(currentScale: number, wheelDeltaPixels: number): number {
  return clamp(
    currentScale * Math.exp(-wheelDeltaPixels * CAMERA_ZOOM_RESPONSE_PER_PIXEL),
    CAMERA_MIN_ZOOM_SCALE,
    CAMERA_MAX_ZOOM_SCALE,
  );
}

export function stepCameraZoomScale(currentScale: number, direction: number): number {
  return clamp(
    currentScale * CAMERA_KEY_ZOOM_FACTOR ** Math.sign(direction),
    CAMERA_MIN_ZOOM_SCALE,
    CAMERA_MAX_ZOOM_SCALE,
  );
}

export function hasCameraDragStarted(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): boolean {
  return (currentX - startX) ** 2 + (currentY - startY) ** 2 >= CAMERA_DRAG_THRESHOLD_PX ** 2;
}

export function orthographicMetersPerPixel(
  verticalSpan: number,
  zoom: number,
  viewportHeight: number,
): number {
  return Math.max(0, verticalSpan) / Math.max(0.001, zoom) / Math.max(1, viewportHeight);
}

export function clampCameraPan(pan: CameraPan): CameraPan {
  const distance = Math.hypot(pan.x, pan.z);
  if (distance <= CAMERA_MAX_PAN_METERS || distance <= 0.001) {
    return pan;
  }
  const scale = CAMERA_MAX_PAN_METERS / distance;
  return { x: pan.x * scale, z: pan.z * scale };
}

export function dragCameraPan(
  pan: CameraPan,
  deltaX: number,
  deltaY: number,
  yaw: number,
  metersPerPixel: number,
): CameraPan {
  const distance = Math.max(0, metersPerPixel);
  return clampCameraPan({
    x: pan.x + (-deltaX * Math.cos(yaw) - deltaY * Math.sin(yaw)) * distance,
    z: pan.z + (deltaX * Math.sin(yaw) - deltaY * Math.cos(yaw)) * distance,
  });
}

export function moveCameraPan(
  pan: CameraPan,
  screenX: number,
  screenY: number,
  yaw: number,
  distance: number,
): CameraPan {
  const step = Math.max(0, distance);
  return clampCameraPan({
    x: pan.x + (screenX * Math.cos(yaw) - screenY * Math.sin(yaw)) * step,
    z: pan.z + (-screenX * Math.sin(yaw) - screenY * Math.cos(yaw)) * step,
  });
}

/**
 * Converts screen-relative movement into the world axes used by the sim.
 * Positive screen Z is backward (S), matching the existing input contract;
 * at yaw 0 this therefore preserves the original world X/Z directions.
 */
export function cameraRelativeMovement(
  screenX: number,
  screenZ: number,
  yaw: number,
): { readonly x: number; readonly z: number } {
  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  let worldX = screenX * Math.cos(safeYaw) + screenZ * Math.sin(safeYaw);
  let worldZ = -screenX * Math.sin(safeYaw) + screenZ * Math.cos(safeYaw);
  const largestAxis = Math.max(1, Math.abs(worldX), Math.abs(worldZ));
  if (largestAxis > MOVEMENT_AXIS_SCALE) {
    const factor = MOVEMENT_AXIS_SCALE / largestAxis;
    worldX *= factor;
    worldZ *= factor;
  }
  return {
    x: Math.max(-MOVEMENT_AXIS_SCALE, Math.min(MOVEMENT_AXIS_SCALE, Math.round(worldX))),
    z: Math.max(-MOVEMENT_AXIS_SCALE, Math.min(MOVEMENT_AXIS_SCALE, Math.round(worldZ))),
  };
}
