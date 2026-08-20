import { type ActiveAbilityDefinition, getActiveDefinition } from '@jwgb/content';
import { distanceSquaredMm, invariant } from '@jwgb/core';
import { sortedMonsters, sortedPlayers } from '../state';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { clearActiveStatusEffect, setActiveStatusEffect } from './active-damage';
import { interruptAirdropChannel } from './airdrop';
import { applyDamage } from './damage';
import {
  equipmentAdjustedHardControlTicks,
  equipmentElementDamageBasisPoints,
  type HardControlKind,
} from './equipment-query';
import { getOutgoingDamageBasisPoints, hasB20ControlImmunity } from './lethal-protection';
import { applyMonsterDamage } from './monster-damage';
import { effectiveAttackPower } from './passive-runtime';
import { applySummonDamage } from './summon-health';

type WhirlwindDefinition = Extract<
  ActiveAbilityDefinition,
  { readonly effect: 'mobile-channel-area-damage' }
>;

export function startWhirlwind(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  definition: WhirlwindDefinition,
): void {
  player.whirlwindTicks = definition.durationTicks;
  player.whirlwindNextPulseTick = state.tick + definition.pulseIntervalTicks;
  setActiveStatusEffect(
    state,
    events,
    player,
    player,
    'whirlwind',
    definition.durationTicks,
    definition.id,
  );
}

export function advanceWhirlwindTimers(state: MutableSimulationState, events: SimEvent[]): void {
  for (const player of sortedPlayers(state)) {
    if (player.hardControlTicks > 0) {
      if (player.whirlwindTicks > 0) {
        clearActiveStatusEffect(state, events, player.entityId, player.entityId, 'whirlwind');
      }
      player.whirlwindTicks = 0;
      player.whirlwindNextPulseTick = 0;
      continue;
    }
    if (player.whirlwindTicks > 0) {
      player.whirlwindTicks -= 1;
      if (player.whirlwindTicks === 0) {
        clearActiveStatusEffect(state, events, player.entityId, player.entityId, 'whirlwind');
      }
    }
  }
}

export function applyHardControl(
  player: PlayerEntity,
  durationTicks: number,
  state?: MutableSimulationState,
  events?: SimEvent[],
  kind: HardControlKind = 'stun',
): boolean {
  if (durationTicks <= 0 || hasB20ControlImmunity(player)) {
    return false;
  }
  const adjustedDuration = equipmentAdjustedHardControlTicks(player, durationTicks, kind);
  const wasWhirling = player.whirlwindTicks > 0;
  player.hardControlTicks = Math.max(player.hardControlTicks, adjustedDuration);
  player.whirlwindTicks = 0;
  player.whirlwindNextPulseTick = 0;
  if (adjustedDuration > 0 && state && events) {
    if (wasWhirling) {
      clearActiveStatusEffect(state, events, player.entityId, player.entityId, 'whirlwind');
    }
    interruptAirdropChannel(state, events, player.entityId, 'hard-control');
  }
  return true;
}

export function resolveWhirlwindPulses(state: MutableSimulationState, events: SimEvent[]): void {
  for (const owner of sortedPlayers(state)) {
    if (
      owner.lifeState !== 'alive' ||
      owner.whirlwindNextPulseTick === 0 ||
      state.tick < owner.whirlwindNextPulseTick
    ) {
      continue;
    }

    const definition = getWhirlwindDefinition(owner);
    const baseDamage =
      definition.fixedDamage +
      Math.trunc((effectiveAttackPower(owner) * definition.attackCoefficientBasisPoints) / 10_000);
    for (const target of sortedPlayers(state)) {
      if (
        target.entityId === owner.entityId ||
        target.lifeState !== 'alive' ||
        distanceSquaredMm(owner.position, target.position) >
          definition.radiusMm * definition.radiusMm
      ) {
        continue;
      }
      const elementBasisPoints = equipmentElementDamageBasisPoints(owner, target.element);
      applyDamage(state, events, {
        sourceEntityId: owner.entityId,
        targetEntityId: target.entityId,
        amount: Math.max(1, Math.trunc((baseDamage * elementBasisPoints) / 10_000)),
        cause: 'active',
        form: 'skill',
        activeAbilityId: definition.id,
        periodic: true,
      });
    }
    for (const target of sortedMonsters(state)) {
      if (
        target.hp <= 0 ||
        target.invulnerableTicks > 0 ||
        distanceSquaredMm(owner.position, target.position) >
          definition.radiusMm * definition.radiusMm
      ) {
        continue;
      }
      applyMonsterDamage(state, events, owner.entityId, target, baseDamage, owner.element, {
        activeAbilityId: definition.id,
      });
    }
    const summonDamage = Math.max(
      1,
      Math.trunc((baseDamage * getOutgoingDamageBasisPoints(owner)) / 10_000),
    );
    for (const target of state.summons.values()) {
      if (
        target.ownerEntityId === owner.entityId ||
        !target.targetable ||
        target.hp <= 0 ||
        distanceSquaredMm(owner.position, target.position) >
          definition.radiusMm * definition.radiusMm
      ) {
        continue;
      }
      applySummonDamage(state, events, owner.entityId, target, summonDamage, {
        activeAbilityId: definition.id,
      });
    }

    owner.whirlwindNextPulseTick += definition.pulseIntervalTicks;
    if (owner.whirlwindTicks === 0) {
      owner.whirlwindNextPulseTick = 0;
    }
  }
}

function getWhirlwindDefinition(player: PlayerEntity): WhirlwindDefinition {
  const definition = getActiveDefinition(player.activeAbilityId);
  invariant(
    definition.effect === 'mobile-channel-area-damage',
    `${player.activeAbilityId} is not a whirlwind active`,
  );
  return definition;
}
