import {
  type ActiveAbilityDefinition,
  getActiveDefinition,
  type ScriptedActiveKind,
} from '@jwgb/content';
import { distanceSquaredMm } from '@jwgb/core';
import { sortedMonsters, sortedPlayers } from '../state';
import type {
  MonsterEntity,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
  SummonEntity,
} from '../types';
import { canSeeActiveTarget } from './active-targeting';
import {
  applyActiveHardControl,
  applyActiveDamage as applyTrackedActiveDamage,
  setActiveStatusEffect,
} from './active-damage';
import { resolveBlink } from './blink';
import { coreBossAdjustedHardControlTicks } from './core-boss-resistance';
import { applyDamage } from './damage';
import { grantGeneratedGold } from './equipment-economy';
import { equipmentActiveCooldownTicks, equipmentHardControlTicks } from './equipment-query';
import {
  breakEquipmentStealth,
  recordEnemyActiveReveal,
  triggerDormantBootsOffensiveReveal,
} from './equipment-runtime';
import { isIceCoffinLocked, startIceCoffin } from './ice-coffin';
import { getOutgoingDamageBasisPoints } from './lethal-protection';
import { applyMonsterDamage } from './monster-damage';
import { effectiveAttackPower } from './passive-runtime';
import { resolveScriptedActive } from './scripted-active-system';
import { addUniversalShield } from './shield';
import { applySummonDamage } from './summon-health';
import { applyHardControl, startWhirlwind } from './whirlwind';
import { createWindWall } from './wind-wall';

type ActiveTarget = PlayerEntity | MonsterEntity | SummonEntity;

const HOSTILE_SCRIPTED_ACTIVE_SCRIPTS: ReadonlySet<ScriptedActiveKind> = new Set([
  'fire-wall',
  'damage-slow-zone',
  'venom-burst',
  'petrify-target',
  'self-or-target-petrify',
  'spreading-poison-zone',
  'delayed-area-strike',
  'delayed-target-strike',
  'dash-first-target',
  'decoy-summon',
  'teleport-backstab',
  'blink-decoy-bomb',
  'cone-damage-slow',
  'line-dash',
  'radial-knockback',
  'delayed-silence-zone',
  'combat-summon',
  'area-pull',
  'gold-true-damage',
  'target-dot-reveal',
  'line-projectile',
  'lifesteal-aura',
  'target-damage-stun',
  'damage-mark',
  'ring-wall',
  'displacement-lock-zone',
  'root-projectile',
  'ice-wall',
  'hook',
  'polymorph',
  'chain-lightning',
  'reward-mark',
  'swap',
  'active-pickpocket',
  'bean-soldiers',
  'trap',
]);

function startsDisplacement(active: ActiveAbilityDefinition): boolean {
  if (active.effect === 'capsule-sweep-blink') {
    return true;
  }
  return (
    active.effect === 'scripted' &&
    (active.script === 'dash-first-target' ||
      active.script === 'teleport-backstab' ||
      active.script === 'blink-decoy-bomb' ||
      active.script === 'line-dash' ||
      active.script === 'swap')
  );
}

function isPlayerTarget(target: ActiveTarget): target is PlayerEntity {
  return 'heroId' in target;
}

function isSummonTarget(target: ActiveTarget): target is SummonEntity {
  return 'ownerEntityId' in target;
}

function isHostileActiveCommit(
  state: MutableSimulationState,
  owner: PlayerEntity,
  active: ActiveAbilityDefinition,
): boolean {
  switch (active.effect) {
    case 'wind-wall':
    case 'mobile-channel-area-damage':
    case 'target-damage-control':
    case 'area-damage':
    case 'target-random-damage':
      return true;
    case 'scripted':
      if (!HOSTILE_SCRIPTED_ACTIVE_SCRIPTS.has(active.script)) {
        return false;
      }
      if (active.script !== 'self-or-target-petrify') {
        return true;
      }
      return (
        owner.intent.targetEntityId !== owner.entityId &&
        selectActiveTarget(state, owner, active.rangeMm ?? Number.MAX_SAFE_INTEGER) !== undefined
      );
    default:
      return false;
  }
}

function isLegalActiveTarget(
  state: MutableSimulationState,
  owner: PlayerEntity,
  target: ActiveTarget,
  rangeMm: number,
): boolean {
  const isPlayer = isPlayerTarget(target);
  const isSummon = isSummonTarget(target);
  const isAlive = isPlayer
    ? target.lifeState === 'alive'
    : isSummon
      ? target.targetable && target.hp > 0
      : target.invulnerableTicks === 0;
  return (
    isAlive &&
    (!isPlayer || owner.entityId !== target.entityId) &&
    (!isSummon || owner.entityId !== target.ownerEntityId) &&
    distanceSquaredMm(owner.position, target.position) <= rangeMm * rangeMm &&
    canSeeActiveTarget(state, owner, target)
  );
}

function selectActiveTarget(
  state: MutableSimulationState,
  owner: PlayerEntity,
  rangeMm: number,
): ActiveTarget | undefined {
  const candidates = [
    ...sortedPlayers(state),
    ...sortedMonsters(state),
    ...state.summons.values(),
  ].filter((candidate) => isLegalActiveTarget(state, owner, candidate, rangeMm));
  const requestedTargetId = owner.intent.targetEntityId;
  if (requestedTargetId !== null) {
    const requestedTarget = candidates.find(
      (candidate) => candidate.entityId === requestedTargetId,
    );
    if (requestedTarget) {
      return requestedTarget;
    }
  }
  return candidates.sort(
    (left, right) =>
      distanceSquaredMm(owner.position, left.position) -
        distanceSquaredMm(owner.position, right.position) ||
      Number(left.entityId) - Number(right.entityId),
  )[0];
}

function resolveTargetDamageControl(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  definition: Extract<ActiveAbilityDefinition, { readonly effect: 'target-damage-control' }>,
): boolean {
  const target = selectActiveTarget(state, owner, definition.rangeMm);
  if (!target) {
    return false;
  }

  const damage =
    definition.fixedDamage +
    Math.trunc((effectiveAttackPower(owner) * definition.attackCoefficientBasisPoints) / 10_000);
  applyTrackedActiveDamage(state, events, owner, target, damage, {
    activeAbilityId: definition.id,
  });
  applyActiveHardControl(
    state,
    events,
    target,
    definition.hardControlTicks,
    owner,
    'stun',
    definition.id,
  );
  return true;
}

function resolveAreaDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  definition: Extract<ActiveAbilityDefinition, { readonly effect: 'area-damage' }>,
): boolean {
  const centerTarget = selectActiveTarget(state, owner, definition.rangeMm);
  if (!centerTarget) {
    return false;
  }

  const damage =
    definition.fixedDamage +
    Math.trunc((effectiveAttackPower(owner) * definition.attackCoefficientBasisPoints) / 10_000);
  const radiusSquared = definition.radiusMm * definition.radiusMm;
  for (const target of [
    ...sortedPlayers(state),
    ...sortedMonsters(state),
    ...state.summons.values(),
  ]) {
    if (
      !isLegalActiveTarget(state, owner, target, Number.MAX_SAFE_INTEGER) ||
      distanceSquaredMm(centerTarget.position, target.position) > radiusSquared
    ) {
      continue;
    }
    applyTrackedActiveDamage(state, events, owner, target, damage, {
      activeAbilityId: definition.id,
    });
  }
  return true;
}

function resolveTargetRandomDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  definition: Extract<ActiveAbilityDefinition, { readonly effect: 'target-random-damage' }>,
): boolean {
  const target = selectActiveTarget(state, owner, definition.rangeMm);
  if (!target) {
    return false;
  }

  const damage =
    definition.minimumDamage +
    state.random.combat.nextInt(definition.maximumDamage - definition.minimumDamage + 1);
  applyTrackedActiveDamage(state, events, owner, target, damage, {
    activeAbilityId: definition.id,
  });
  return true;
}

function pushMissingTargetEvent(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  active: ActiveAbilityDefinition,
): void {
  events.push({
    type: 'active-target-missing',
    tick: state.tick,
    entityId: player.entityId,
    heroId: player.heroId,
    activeAbilityId: active.id,
    activeName: active.name,
  });
}

export function resolveActiveCasts(state: MutableSimulationState, events: SimEvent[]): void {
  for (const player of sortedPlayers(state)) {
    if (
      player.lifeState !== 'alive' ||
      !player.intent.castActive ||
      player.activeCooldownTicks > 0 ||
      player.silenceTicks > 0 ||
      player.hardControlTicks > 0 ||
      player.taibaiChannelTicks > 0 ||
      isIceCoffinLocked(player)
    ) {
      continue;
    }

    const active = getActiveDefinition(player.activeAbilityId);
    if (
      player.polymorphTicks > 0 ||
      (player.displacementLockTicks > 0 && startsDisplacement(active))
    ) {
      events.push({
        type: 'active-cast-blocked',
        tick: state.tick,
        entityId: player.entityId,
        heroId: player.heroId,
        activeAbilityId: active.id,
        activeName: active.name,
        reason: player.polymorphTicks > 0 ? 'polymorphed' : 'displacement-locked',
      });
      continue;
    }
    switch (active.effect) {
      case 'wind-wall':
        createWindWall(state, events, player, active);
        break;
      case 'self-combat-buff':
        player.activeBuffTicks = active.durationTicks;
        setActiveStatusEffect(
          state,
          events,
          player,
          player,
          'combat-buff',
          active.durationTicks,
          active.id,
        );
        break;
      case 'mobile-channel-area-damage':
        startWhirlwind(state, events, player, active);
        break;
      case 'self-shield':
        addUniversalShield(state, player, active.id, active.shieldAmount, active.durationTicks);
        break;
      case 'capsule-sweep-blink':
        resolveBlink(state, events, player, active);
        break;
      case 'self-lock-invulnerability':
        startIceCoffin(player, active);
        break;
      case 'target-damage-control':
        if (!resolveTargetDamageControl(state, events, player, active)) {
          pushMissingTargetEvent(state, events, player, active);
          continue;
        }
        break;
      case 'area-damage':
        if (!resolveAreaDamage(state, events, player, active)) {
          pushMissingTargetEvent(state, events, player, active);
          continue;
        }
        break;
      case 'target-random-damage':
        if (!resolveTargetRandomDamage(state, events, player, active)) {
          pushMissingTargetEvent(state, events, player, active);
          continue;
        }
        break;
      case 'gold-grant':
        grantGeneratedGold(player, active.goldAmount);
        break;
      case 'scripted':
        if (!resolveScriptedActive(state, events, player, active)) {
          pushMissingTargetEvent(state, events, player, active);
          continue;
        }
        break;
      case 'definition-only':
        player.activeCooldownTicks = equipmentActiveCooldownTicks(player, active.cooldownTicks);
        events.push({
          type: 'active-unavailable',
          tick: state.tick,
          entityId: player.entityId,
          heroId: player.heroId,
          activeAbilityId: active.id,
          activeName: active.name,
        });
        continue;
    }

    if (isHostileActiveCommit(state, player, active)) {
      triggerDormantBootsOffensiveReveal(
        state,
        events,
        player,
        'hostile-active-commit',
        player.intent.targetEntityId,
      );
    }
    if (player.activeAbilityId !== 'D7') {
      player.stealthTicks = 0;
    }
    breakEquipmentStealth(player);
    player.activeCooldownTicks = equipmentActiveCooldownTicks(player, active.cooldownTicks);
    events.push({
      type: 'active-cast',
      tick: state.tick,
      entityId: player.entityId,
      heroId: player.heroId,
      activeAbilityId: active.id,
      activeName: active.name,
    });
    recordEnemyActiveReveal(state, events, player);
  }
}
