import { createPlayerIntent, type EntityId, type PlayerIntent } from '@jwgb/core';
import { isMovementCode, WEB_CONTROL_BINDINGS } from './control-bindings';

export interface InputDiagnostics {
  readonly enabled: boolean;
  readonly pressedKeys: readonly string[];
  readonly attackPressed: boolean;
  readonly attackQueued: boolean;
  readonly activeQueued: boolean;
  readonly alternateActiveQueued: boolean;
  readonly interactQueued: boolean;
  readonly aim: readonly [number, number];
  readonly joystick: readonly [number, number, boolean];
}

export class InputController {
  private readonly keys = new Set<string>();
  private enabled = true;
  private joystickX = 0;
  private joystickZ = 0;
  private joystickActive = false;
  private attackPressed = false;
  private attackQueued = false;
  private activeQueued = false;
  private alternateActiveQueued = false;
  private interactQueued = false;
  private contextualInteract: (() => boolean) | null = null;
  private lastAimX = 0;
  private lastAimZ = -1_000;
  private pointerAimX = 0;
  private pointerAimZ = -1_000;
  private pointerAimActive = false;

  constructor() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.reset);
  }

  setJoystick(x: number, z: number, active: boolean): void {
    if (!this.enabled && active) {
      return;
    }
    this.joystickX = Math.trunc(Math.max(-1, Math.min(1, x)) * 1_000);
    this.joystickZ = Math.trunc(Math.max(-1, Math.min(1, z)) * 1_000);
    this.joystickActive = active;
  }

  setAttackPressed(pressed: boolean): void {
    if (!pressed) {
      this.attackPressed = false;
      return;
    }
    if (!this.enabled) {
      return;
    }
    this.attackPressed = pressed;
    this.attackQueued = true;
  }

  queueActive(): void {
    if (!this.enabled) {
      return;
    }
    this.activeQueued = true;
  }

  queueAlternateActive(): void {
    if (!this.enabled) {
      return;
    }
    this.alternateActiveQueued = true;
  }

  setContextualInteract(handler: (() => boolean) | null): void {
    this.contextualInteract = handler;
  }

  queueInteract(): void {
    if (!this.enabled) {
      return;
    }
    if (this.contextualInteract?.()) {
      return;
    }
    this.interactQueued = true;
  }

  setAimDirection(x: number, z: number): void {
    if (!this.enabled) {
      return;
    }
    const length = Math.hypot(x, z);
    if (length <= 0.001) {
      return;
    }
    this.pointerAimX = Math.trunc((x / length) * 1_000);
    this.pointerAimZ = Math.trunc((z / length) * 1_000);
    this.pointerAimActive = true;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  getDiagnostics(): InputDiagnostics {
    return {
      enabled: this.enabled,
      pressedKeys: [...this.keys].sort(),
      attackPressed: this.attackPressed,
      attackQueued: this.attackQueued,
      activeQueued: this.activeQueued,
      alternateActiveQueued: this.alternateActiveQueued,
      interactQueued: this.interactQueued,
      aim: [this.lastAimX, this.lastAimZ],
      joystick: [this.joystickX, this.joystickZ, this.joystickActive],
    };
  }

  sample(
    sequence: number,
    targetEntityId: EntityId | null = null,
    secondaryTargetEntityId: EntityId | null = null,
  ): PlayerIntent {
    if (!this.enabled) {
      return createPlayerIntent({ sequence, moveX: 0, moveZ: 0 });
    }
    const keyboardX =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const keyboardZ =
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
    const moveX = this.joystickActive ? this.joystickX : keyboardX * 1_000;
    const moveZ = this.joystickActive ? this.joystickZ : keyboardZ * 1_000;
    if (this.pointerAimActive) {
      this.lastAimX = this.pointerAimX;
      this.lastAimZ = this.pointerAimZ;
    } else if (moveX !== 0 || moveZ !== 0) {
      this.lastAimX = moveX;
      this.lastAimZ = moveZ;
    }
    const castActive = this.activeQueued;
    const alternateActive = this.alternateActiveQueued;
    const attack = this.attackPressed || this.attackQueued || this.keys.has('Space');
    const interact = this.interactQueued;
    this.activeQueued = false;
    this.alternateActiveQueued = false;
    this.interactQueued = false;
    this.attackQueued = false;

    return createPlayerIntent({
      sequence,
      moveX,
      moveZ,
      aimX: this.lastAimX,
      aimZ: this.lastAimZ,
      attack,
      targetEntityId,
      secondaryTargetEntityId,
      castActive,
      alternateActive,
      interact,
    });
  }

  dispose(): void {
    this.contextualInteract = null;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.reset);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) {
      return;
    }
    this.keys.add(event.code);
    if (event.code === WEB_CONTROL_BINDINGS.interactCode && !event.repeat) {
      this.queueInteract();
    }
    if (event.code === WEB_CONTROL_BINDINGS.alternateActiveCompatibilityCode && !event.repeat) {
      this.queueAlternateActive();
    }
    if (event.code === WEB_CONTROL_BINDINGS.attackCompatibilityCode || isMovementCode(event.code)) {
      event.preventDefault();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly reset = (): void => {
    this.keys.clear();
    this.attackPressed = false;
    this.attackQueued = false;
    this.activeQueued = false;
    this.alternateActiveQueued = false;
    this.interactQueued = false;
    this.lastAimX = 0;
    this.lastAimZ = -1_000;
    this.pointerAimX = 0;
    this.pointerAimZ = -1_000;
    this.pointerAimActive = false;
    this.setJoystick(0, 0, false);
  };
}
