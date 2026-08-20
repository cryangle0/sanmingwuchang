import type { ActiveId, PassiveId } from '@jwgb/core';
import { sortedPlayers } from '../state';
import type {
  DamageForm,
  MutableSimulationState,
  PlayerEntity,
  ShieldBreakEffect,
  ShieldInstance,
  ShieldSource,
} from '../types';

const ALL_DAMAGE_FORMS: readonly DamageForm[] = [
  'basic',
  'skill',
  'dot',
  'percent',
  'reflect',
  'true',
  'storm',
];

export interface ShieldAbsorptionResult {
  readonly absorbed: number;
  readonly remainingDamage: number;
  readonly brokenShields: readonly ShieldInstance[];
}

function addShield(
  state: MutableSimulationState,
  player: PlayerEntity,
  source: ShieldSource,
  amount: number,
  durationTicks: number,
  breakEffect: ShieldBreakEffect | null,
): ShieldInstance {
  const shield: ShieldInstance = {
    source,
    expiresAtTick: state.tick + durationTicks,
    creationSequence: state.nextShieldSequence,
    absorbs: ALL_DAMAGE_FORMS,
    breakEffect,
    remainingAmount: amount,
  };
  state.nextShieldSequence += 1;
  player.shields.push(shield);
  return shield;
}

export function addUniversalShield(
  state: MutableSimulationState,
  player: PlayerEntity,
  sourceActiveId: ActiveId,
  amount: number,
  durationTicks: number,
): ShieldInstance {
  return addShield(
    state,
    player,
    { kind: 'active', activeId: sourceActiveId },
    amount,
    durationTicks,
    null,
  );
}

export function addPassiveShield(
  state: MutableSimulationState,
  player: PlayerEntity,
  sourcePassiveId: PassiveId,
  amount: number,
  durationTicks: number,
  breakEffect: ShieldBreakEffect | null,
): ShieldInstance {
  for (let index = player.shields.length - 1; index >= 0; index -= 1) {
    const shield = player.shields[index];
    if (shield?.source.kind === 'passive' && shield.source.passiveId === sourcePassiveId) {
      player.shields.splice(index, 1);
    }
  }
  return addShield(
    state,
    player,
    { kind: 'passive', passiveId: sourcePassiveId },
    amount,
    durationTicks,
    breakEffect,
  );
}

export function advanceShields(state: MutableSimulationState): void {
  for (const player of sortedPlayers(state)) {
    for (let index = player.shields.length - 1; index >= 0; index -= 1) {
      const shield = player.shields[index];
      if (!shield || shield.expiresAtTick > state.tick) {
        continue;
      }
      player.shields.splice(index, 1);
    }
  }
}

export function getTotalShield(player: PlayerEntity): number {
  return player.shields.reduce((total, shield) => total + shield.remainingAmount, 0);
}

export function absorbDamageWithShields(
  player: PlayerEntity,
  form: DamageForm,
  amount: number,
): ShieldAbsorptionResult {
  let remainingDamage = amount;
  let absorbed = 0;
  const brokenShields: ShieldInstance[] = [];
  const orderedShields = [...player.shields].sort(
    (left, right) =>
      left.expiresAtTick - right.expiresAtTick || left.creationSequence - right.creationSequence,
  );

  for (const shield of orderedShields) {
    if (remainingDamage === 0 || !shield.absorbs.includes(form)) {
      continue;
    }
    const shieldDamage = Math.min(shield.remainingAmount, remainingDamage);
    shield.remainingAmount -= shieldDamage;
    remainingDamage -= shieldDamage;
    absorbed += shieldDamage;
    if (shield.remainingAmount === 0) {
      brokenShields.push(shield);
    }
  }

  for (let index = player.shields.length - 1; index >= 0; index -= 1) {
    if (player.shields[index]?.remainingAmount === 0) {
      player.shields.splice(index, 1);
    }
  }

  return { absorbed, remainingDamage, brokenShields };
}
