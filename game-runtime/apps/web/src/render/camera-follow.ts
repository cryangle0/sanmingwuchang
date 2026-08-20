import * as THREE from 'three';

export interface CameraFollowState {
  readonly focus: THREE.Vector3;
  readonly offset: THREE.Vector3;
  zoom: number;
}

const MAX_CAMERA_DELTA_SECONDS = 0.075;
const MAX_FOCUS_STEP_METERS = 0.38;
const FOLLOW_RESPONSE = 14;
const VIEW_RESPONSE = 11;

export function exponentialDampingFactor(response: number, deltaSeconds: number): number {
  const delta = THREE.MathUtils.clamp(deltaSeconds, 0, MAX_CAMERA_DELTA_SECONDS);
  return 1 - Math.exp(-Math.max(0, response) * delta);
}

export function updateCameraFollowState(
  state: CameraFollowState,
  desiredFocus: THREE.Vector3,
  desiredOffset: THREE.Vector3,
  desiredZoom: number,
  deltaSeconds: number,
  snap: boolean,
): void {
  if (snap) {
    state.focus.copy(desiredFocus);
    state.offset.copy(desiredOffset);
    state.zoom = desiredZoom;
    return;
  }

  const followFactor = exponentialDampingFactor(FOLLOW_RESPONSE, deltaSeconds);
  const focusStepX = (desiredFocus.x - state.focus.x) * followFactor;
  const focusStepY = (desiredFocus.y - state.focus.y) * followFactor;
  const focusStepZ = (desiredFocus.z - state.focus.z) * followFactor;
  const focusStepLength = Math.hypot(focusStepX, focusStepY, focusStepZ);
  const focusStepScale =
    focusStepLength > MAX_FOCUS_STEP_METERS ? MAX_FOCUS_STEP_METERS / focusStepLength : 1;
  state.focus.x += focusStepX * focusStepScale;
  state.focus.y += focusStepY * focusStepScale;
  state.focus.z += focusStepZ * focusStepScale;
  const viewFactor = exponentialDampingFactor(VIEW_RESPONSE, deltaSeconds);
  state.offset.lerp(desiredOffset, viewFactor);
  state.zoom = THREE.MathUtils.lerp(state.zoom, desiredZoom, viewFactor);
}
