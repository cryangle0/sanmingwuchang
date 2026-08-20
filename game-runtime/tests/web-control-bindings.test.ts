import {
  cameraPanDirectionForCode,
  cameraRotationDirectionForCode,
  cameraViewForCode,
  cameraZoomDirectionForCode,
  isCameraResetCode,
  isMovementCode,
  WEB_CONTROL_BINDINGS,
} from '../apps/web/src/input/control-bindings';

describe('Web control bindings', () => {
  it('matches the authoritative Windows control scheme', () => {
    expect(WEB_CONTROL_BINDINGS.movementCodes).toEqual(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
    expect(WEB_CONTROL_BINDINGS.attackMouseButton).toBe(0);
    expect(WEB_CONTROL_BINDINGS.activeMouseButton).toBe(2);
    expect(WEB_CONTROL_BINDINGS.interactCode).toBe('KeyE');
    expect(WEB_CONTROL_BINDINGS.closeCode).toBe('Escape');
    expect(WEB_CONTROL_BINDINGS.cameraPanMouseButton).toBe(1);
  });

  it('keeps arrow keys as movement-only compatibility bindings', () => {
    expect(isMovementCode('ArrowUp')).toBe(true);
    expect(isMovementCode('KeyD')).toBe(true);
    expect(isMovementCode('KeyE')).toBe(false);
  });

  it('exposes desktop-style camera shortcuts without overlapping movement', () => {
    expect(cameraViewForCode('Digit1')).toBe('close');
    expect(cameraViewForCode('Digit2')).toBe('standard');
    expect(cameraViewForCode('Digit3')).toBe('tactical');
    expect(cameraViewForCode('Digit4')).toBeNull();
    expect(isCameraResetCode('KeyF')).toBe(true);
    expect(isCameraResetCode('Home')).toBe(true);
    expect(cameraZoomDirectionForCode('Equal')).toBe(1);
    expect(cameraZoomDirectionForCode('Minus')).toBe(-1);
    expect(cameraRotationDirectionForCode('KeyZ')).toBe(-1);
    expect(cameraRotationDirectionForCode('KeyC')).toBe(1);
    expect(cameraPanDirectionForCode('KeyI')).toEqual([0, 1]);
    expect(cameraPanDirectionForCode('KeyL')).toEqual([1, 0]);
  });
});
