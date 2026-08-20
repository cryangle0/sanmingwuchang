/**
 * Web input bindings derived from docs/玩法完整说明.md section 5.
 * Compatibility bindings are intentionally kept separate from the canonical controls.
 */
import type { WebCameraViewMode } from '../runtime/web-settings';

export const WEB_CONTROL_BINDINGS = {
  movementCodes: ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const,
  movementLabels: ['W', 'A', 'S', 'D'] as const,
  movementCompatibilityCodes: ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'] as const,
  attackMouseButton: 0,
  activeMouseButton: 2,
  cameraPanMouseButton: 1,
  cameraAlternateOrbitMouseButton: 0,
  interactCode: 'KeyE',
  closeCode: 'Escape',
  cameraCode: 'KeyV',
  mapCode: 'KeyM',
  cameraResetCodes: ['KeyF', 'Home'] as const,
  cameraZoomInCodes: ['Equal', 'NumpadAdd', 'PageUp'] as const,
  cameraZoomOutCodes: ['Minus', 'NumpadSubtract', 'PageDown'] as const,
  cameraRotateLeftCodes: ['KeyZ', 'BracketLeft'] as const,
  cameraRotateRightCodes: ['KeyC', 'BracketRight'] as const,
  cameraPanUpCodes: ['KeyI', 'Numpad8'] as const,
  cameraPanDownCodes: ['KeyK', 'Numpad2'] as const,
  cameraPanLeftCodes: ['KeyJ', 'Numpad4'] as const,
  cameraPanRightCodes: ['KeyL', 'Numpad6'] as const,
  attackCompatibilityCode: 'Space',
  alternateActiveCompatibilityCode: 'KeyR',
} as const;

const MOVEMENT_CODES = new Set<string>([
  ...WEB_CONTROL_BINDINGS.movementCodes,
  ...WEB_CONTROL_BINDINGS.movementCompatibilityCodes,
]);
const CAMERA_RESET_CODES = new Set<string>(WEB_CONTROL_BINDINGS.cameraResetCodes);
const CAMERA_ZOOM_IN_CODES = new Set<string>(WEB_CONTROL_BINDINGS.cameraZoomInCodes);
const CAMERA_ZOOM_OUT_CODES = new Set<string>(WEB_CONTROL_BINDINGS.cameraZoomOutCodes);
const CAMERA_ROTATE_LEFT_CODES = new Set<string>(WEB_CONTROL_BINDINGS.cameraRotateLeftCodes);
const CAMERA_ROTATE_RIGHT_CODES = new Set<string>(WEB_CONTROL_BINDINGS.cameraRotateRightCodes);
const CAMERA_PAN_UP_CODES = new Set<string>(WEB_CONTROL_BINDINGS.cameraPanUpCodes);
const CAMERA_PAN_DOWN_CODES = new Set<string>(WEB_CONTROL_BINDINGS.cameraPanDownCodes);
const CAMERA_PAN_LEFT_CODES = new Set<string>(WEB_CONTROL_BINDINGS.cameraPanLeftCodes);
const CAMERA_PAN_RIGHT_CODES = new Set<string>(WEB_CONTROL_BINDINGS.cameraPanRightCodes);
const CAMERA_VIEW_BY_CODE: Readonly<Record<string, WebCameraViewMode>> = {
  Digit1: 'close',
  Digit2: 'standard',
  Digit3: 'tactical',
};

export function isMovementCode(code: string): boolean {
  return MOVEMENT_CODES.has(code);
}

export function cameraViewForCode(code: string): WebCameraViewMode | null {
  return CAMERA_VIEW_BY_CODE[code] ?? null;
}

export function isCameraResetCode(code: string): boolean {
  return CAMERA_RESET_CODES.has(code);
}

export function cameraZoomDirectionForCode(code: string): number {
  if (CAMERA_ZOOM_IN_CODES.has(code)) {
    return 1;
  }
  if (CAMERA_ZOOM_OUT_CODES.has(code)) {
    return -1;
  }
  return 0;
}

export function cameraRotationDirectionForCode(code: string): number {
  if (CAMERA_ROTATE_LEFT_CODES.has(code)) {
    return -1;
  }
  if (CAMERA_ROTATE_RIGHT_CODES.has(code)) {
    return 1;
  }
  return 0;
}

export function cameraPanDirectionForCode(
  code: string,
): readonly [screenX: number, screenY: number] | null {
  if (CAMERA_PAN_UP_CODES.has(code)) {
    return [0, 1];
  }
  if (CAMERA_PAN_DOWN_CODES.has(code)) {
    return [0, -1];
  }
  if (CAMERA_PAN_LEFT_CODES.has(code)) {
    return [-1, 0];
  }
  if (CAMERA_PAN_RIGHT_CODES.has(code)) {
    return [1, 0];
  }
  return null;
}
