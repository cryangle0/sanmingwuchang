import { assertIntegerInRange, assertSafeInteger } from './assert';
import type { EntityId } from './ids';
import { normalizeAxisPair, type Vec2Mm } from './math';

export const INPUT_AXIS_SCALE = 1_000;

export interface PlayerIntent {
  readonly sequence: number;
  readonly movement: Vec2Mm;
  readonly aim: Vec2Mm;
  readonly attack: boolean;
  readonly targetEntityId: EntityId | null;
  readonly secondaryTargetEntityId?: EntityId | null;
  readonly castActive: boolean;
  readonly alternateActive?: boolean;
  readonly interact: boolean;
}

export function neutralIntent(sequence = 0): PlayerIntent {
  assertSafeInteger(sequence, 'sequence');
  return {
    sequence,
    movement: { x: 0, z: 0 },
    aim: { x: 0, z: 0 },
    attack: false,
    targetEntityId: null,
    secondaryTargetEntityId: null,
    castActive: false,
    alternateActive: false,
    interact: false,
  };
}

export function createPlayerIntent(input: {
  readonly sequence: number;
  readonly moveX: number;
  readonly moveZ: number;
  readonly aimX?: number;
  readonly aimZ?: number;
  readonly attack?: boolean;
  readonly targetEntityId?: EntityId | null;
  readonly secondaryTargetEntityId?: EntityId | null;
  readonly castActive?: boolean;
  readonly alternateActive?: boolean;
  readonly interact?: boolean;
}): PlayerIntent {
  assertSafeInteger(input.sequence, 'sequence');
  assertIntegerInRange(input.moveX, -INPUT_AXIS_SCALE, INPUT_AXIS_SCALE, 'moveX');
  assertIntegerInRange(input.moveZ, -INPUT_AXIS_SCALE, INPUT_AXIS_SCALE, 'moveZ');
  assertIntegerInRange(input.aimX ?? 0, -INPUT_AXIS_SCALE, INPUT_AXIS_SCALE, 'aimX');
  assertIntegerInRange(input.aimZ ?? 0, -INPUT_AXIS_SCALE, INPUT_AXIS_SCALE, 'aimZ');

  return {
    sequence: input.sequence,
    movement: normalizeAxisPair(input.moveX, input.moveZ, INPUT_AXIS_SCALE),
    aim: normalizeAxisPair(input.aimX ?? 0, input.aimZ ?? 0, INPUT_AXIS_SCALE),
    attack: input.attack ?? false,
    targetEntityId: input.targetEntityId ?? null,
    secondaryTargetEntityId: input.secondaryTargetEntityId ?? null,
    castActive: input.castActive ?? false,
    alternateActive: input.alternateActive ?? false,
    interact: input.interact ?? false,
  };
}
