import { getActiveDefinition, getHeroDefinition } from '@jwgb/content';
import { distanceSquaredMm, invariant, TICKS_PER_SECOND } from '@jwgb/core';
import { sortedMonsters, sortedPlayers } from '../state';
import type {
  ActiveZoneEntity,
  MonsterEntity,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
  SummonEntity,
} from '../types';
import { applyActiveDamage } from './active-damage';
import { canSeeActiveTarget } from './active-targeting';
import { createBasicAttackSnapshot, resolveBasicHit } from './basic-hit';
import { equipmentComboShoesAttackSpeedPercent } from './equipment-query';
import { breakEquipmentStealth, triggerDormantBootsOffensiveReveal } from './equipment-runtime';
import { isIceCoffinLocked } from './ice-coffin';
import { getOutgoingDamageBasisPoints } from './lethal-protection';
import { activeAttackSpeedBonusPercent } from './passive-runtime';
import { launchBasicProjectile } from './projectile';
import { applySummonDamage } from './summon-health';

type CombatTarget = PlayerEntity | MonsterEntity | SummonEntity | ActiveZoneEntity;

function isLegalTarget(
  state: MutableSimulationState,
  attacker: PlayerEntity,
  target: PlayerEntity,
): boolean {
  if (attacker.entityId === target.entityId || target.lifeState !== 'alive') {
    return false;
  }
  if (
    distanceSquaredMm(attacker.position, target.position) >
    attacker.attackRangeMm * attacker.attackRangeMm
  ) {
    return false;
  }
  return canSeeActiveTarget(state, attacker, target);
}

function isLegalMonsterTarget(
  state: MutableSimulationState,
  attacker: PlayerEntity,
  target: MonsterEntity,
): boolean {
  if (target.invulnerableTicks > 0) {
    return false;
  }
  return (
    distanceSquaredMm(attacker.position, target.position) <=
      attacker.attackRangeMm * attacker.attackRangeMm && canSeeActiveTarget(state, attacker, target)
  );
}

function isLegalSummonTarget(
  state: MutableSimulationState,
  attacker: PlayerEntity,
  target: SummonEntity,
): boolean {
  return (
    target.targetable &&
    target.hp > 0 &&
    target.ownerEntityId !== attacker.entityId &&
    distanceSquaredMm(attacker.position, target.position) <=
      attacker.attackRangeMm * attacker.attackRangeMm &&
    canSeeActiveTarget(state, attacker, target)
  );
}

function isLegalActiveZoneTarget(
  state: MutableSimulationState,
  attacker: PlayerEntity,
  target: ActiveZoneEntity,
): boolean {
  return (
    target.targetable &&
    target.hp > 0 &&
    target.ownerEntityId !== attacker.entityId &&
    distanceSquaredMm(attacker.position, target.center) <=
      attacker.attackRangeMm * attacker.attackRangeMm &&
    canSeeActiveTarget(state, attacker, target)
  );
}

function selectTarget(
  state: MutableSimulationState,
  attacker: PlayerEntity,
): CombatTarget | undefined {
  if (attacker.intent.targetEntityId !== null) {
    const requestedPlayer = state.players.get(attacker.intent.targetEntityId);
    if (requestedPlayer && isLegalTarget(state, attacker, requestedPlayer)) {
      return requestedPlayer;
    }
    const requestedMonster = state.monsters.get(attacker.intent.targetEntityId);
    if (requestedMonster && isLegalMonsterTarget(state, attacker, requestedMonster)) {
      return requestedMonster;
    }
    const requestedSummon = state.summons.get(attacker.intent.targetEntityId);
    if (requestedSummon && isLegalSummonTarget(state, attacker, requestedSummon)) {
      return requestedSummon;
    }
    const requestedZone = state.activeZones.get(attacker.intent.targetEntityId);
    return requestedZone && isLegalActiveZoneTarget(state, attacker, requestedZone)
      ? requestedZone
      : undefined;
  }

  return [
    ...sortedPlayers(state),
    ...sortedMonsters(state),
    ...state.summons.values(),
    ...state.activeZones.values(),
  ]
    .filter((candidate) =>
      'heroId' in candidate
        ? isLegalTarget(state, attacker, candidate)
        : 'activeId' in candidate
          ? isLegalActiveZoneTarget(state, attacker, candidate)
          : 'ownerEntityId' in candidate
            ? isLegalSummonTarget(state, attacker, candidate)
            : isLegalMonsterTarget(state, attacker, candidate),
    )
    .sort((left, right) => {
      const distanceDelta =
        distanceSquaredMm(attacker.position, 'activeId' in left ? left.center : left.position) -
        distanceSquaredMm(attacker.position, 'activeId' in right ? right.center : right.position);
      return distanceDelta || Number(left.entityId) - Number(right.entityId);
    })[0];
}

export function resolveBasicAttacks(state: MutableSimulationState, events: SimEvent[]): void {
  for (const attacker of sortedPlayers(state)) {
    if (
      attacker.lifeState !== 'alive' ||
      !attacker.intent.attack ||
      attacker.attackCooldownTicks > 0 ||
      attacker.hardControlTicks > 0 ||
      attacker.taibaiChannelTicks > 0 ||
      attacker.polymorphTicks > 0 ||
      attacker.whirlwindTicks > 0 ||
      isIceCoffinLocked(attacker)
    ) {
      continue;
    }

    const target = selectTarget(state, attacker);
    if (!target) {
      continue;
    }
    triggerDormantBootsOffensiveReveal(
      state,
      events,
      attacker,
      'hostile-basic-commit',
      target.entityId,
    );
    attacker.stealthTicks = 0;
    breakEquipmentStealth(attacker);

    const active = getActiveDefinition(attacker.activeAbilityId);
    const attackSpeedPercent =
      attacker.activeBuffTicks > 0 && active.effect === 'self-combat-buff'
        ? active.attackSpeedPercent
        : 0;
    const passiveAttackSpeedPercent =
      activeAttackSpeedBonusPercent(attacker) +
      equipmentComboShoesAttackSpeedPercent(state, attacker, target.entityId);
    const attacksPerSecondMilli = Math.trunc(
      (attacker.attacksPerSecondMilli * (100 + attackSpeedPercent + passiveAttackSpeedPercent)) /
        100,
    );
    attacker.attackCooldownTicks = Math.ceil((TICKS_PER_SECOND * 1_000) / attacksPerSecondMilli);

    const attack = createBasicAttackSnapshot(attacker, getOutgoingDamageBasisPoints(attacker));
    events.push({
      type: 'basic-attack',
      tick: state.tick,
      sourceEntityId: attacker.entityId,
      targetEntityId: target.entityId,
    });
    if (attacker.basicAttackKind === 'ranged-projectile') {
      const projectileDefinition = getHeroDefinition(attacker.heroId).basicProjectile;
      invariant(projectileDefinition, `hero ${attacker.heroId} is missing basic projectile data`);
      launchBasicProjectile(
        state,
        attacker,
        target,
        projectileDefinition,
        attack,
        attacker.attackRangeMm,
      );
      continue;
    }

    if ('activeId' in target) {
      applyActiveDamage(state, events, attacker, target, attack.baseDamage, {
        ...(attack.armedActiveId === undefined
          ? {}
          : { activeAbilityId: attack.armedActiveId }),
      });
    } else if ('ownerEntityId' in target) {
      applySummonDamage(
        state,
        events,
        attacker.entityId,
        target,
        Math.max(1, Math.trunc((attack.baseDamage * attack.outgoingDamageBasisPoints) / 10_000)),
        {
          ...(attack.armedActiveId === undefined
            ? {}
            : { activeAbilityId: attack.armedActiveId }),
        },
      );
    } else {
      resolveBasicHit(state, events, attacker, target, attack);
    }
  }
}
