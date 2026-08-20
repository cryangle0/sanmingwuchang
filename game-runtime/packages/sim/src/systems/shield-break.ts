import { distanceSquaredMm } from '@jwgb/core';
import { sortedMonsters, sortedPlayers } from '../state';
import type {
  DamageRequest,
  MutableSimulationState,
  PlayerEntity,
  ShieldInstance,
  SimEvent,
} from '../types';
import { equipmentElementDamageBasisPoints } from './equipment-query';
import { getOutgoingDamageBasisPoints } from './lethal-protection';
import { applyMonsterDamage } from './monster-damage';
import { applySummonDamage } from './summon-health';

type DamageApplier = (
  state: MutableSimulationState,
  events: SimEvent[],
  request: DamageRequest,
) => number;

export function resolveShieldBreakEffects(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  brokenShields: readonly ShieldInstance[],
  applyDamage: DamageApplier,
): void {
  const ordered = [...brokenShields].sort(
    (left, right) => left.creationSequence - right.creationSequence,
  );

  for (const shield of ordered) {
    const effect = shield.breakEffect;
    if (!effect) {
      continue;
    }

    for (const target of sortedPlayers(state)) {
      if (
        target.entityId === owner.entityId ||
        target.lifeState !== 'alive' ||
        distanceSquaredMm(owner.position, target.position) > effect.radiusMm * effect.radiusMm
      ) {
        continue;
      }

      const outgoingDamage = Math.trunc(
        (effect.damage * getOutgoingDamageBasisPoints(owner)) / 10_000,
      );
      const elementBasisPoints = equipmentElementDamageBasisPoints(owner, target.element);
      const damage = Math.max(1, Math.trunc((outgoingDamage * elementBasisPoints) / 10_000));
      applyDamage(state, events, {
        sourceEntityId: effect.sourceEntityId,
        targetEntityId: target.entityId,
        amount: damage,
        cause: 'passive',
        form: 'skill',
        outgoingDamageBasisPointsOverride: 10_000,
      });
    }
    for (const target of sortedMonsters(state)) {
      if (
        target.hp <= 0 ||
        target.invulnerableTicks > 0 ||
        distanceSquaredMm(owner.position, target.position) > effect.radiusMm * effect.radiusMm
      ) {
        continue;
      }
      applyMonsterDamage(
        state,
        events,
        effect.sourceEntityId,
        target,
        effect.damage,
        effect.sourceElement,
      );
    }
    const outgoingDamage = Math.max(
      1,
      Math.trunc((effect.damage * getOutgoingDamageBasisPoints(owner)) / 10_000),
    );
    for (const target of state.summons.values()) {
      if (
        target.ownerEntityId === owner.entityId ||
        !target.targetable ||
        target.hp <= 0 ||
        distanceSquaredMm(owner.position, target.position) > effect.radiusMm * effect.radiusMm
      ) {
        continue;
      }
      applySummonDamage(state, events, effect.sourceEntityId, target, outgoingDamage);
    }
  }
}
