import {
  type FiveElement,
  getPassiveDefinition,
  PASSIVE_IDS,
  passiveLevelValue,
} from '@jwgb/content';
import {
  type ActiveId,
  distanceSquaredMm,
  type EntityId,
  type PassiveId,
} from '@jwgb/core';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { clearActiveStatusEffect } from './active-damage';
import { applyDamage } from './damage';
import {
  equipmentCriticalDamagePercent,
  equipmentElementDamageBasisPoints,
} from './equipment-query';
import { applyEquipmentBurn, recordComboShoesBasicHit } from './equipment-runtime';
import { getOutgoingDamageBasisPoints } from './lethal-protection';
import { applyMonsterDamage } from './monster-damage';
import { resolvePickpocket } from './passive-economy';
import {
  applyBasicHitStatuses,
  type BasicHitTarget,
  basicLifestealPercent,
  effectiveAttackPower,
  findPassiveLoadout,
  isBasicAttackMissed,
  resolveBasicAttackModifier,
  resolveBasicHitPassiveEffects,
  resolveIncomingBasicPassiveEffects,
  scalePassiveMagnitude,
} from './passive-runtime';
import { currentMoveSpeedMmPerSecond } from './player-speed';
import { launchColdArrowProjectile } from './projectile';
import { trySpawnPassiveSummons } from './summon';
import { applySummonDamage } from './summon-health';

export interface BasicAttackSnapshot {
  readonly sourceEntityId: EntityId;
  readonly sourceElement: FiveElement;
  readonly baseDamage: number;
  readonly outgoingDamageBasisPoints: number;
  readonly comboDepth?: number;
  readonly forcedCritical?: boolean;
  readonly forcedPassiveId?: PassiveId;
  readonly missingHpDamagePercent?: number;
  readonly armedActiveId?: ActiveId;
}

const COMBO_FORCED_PASSIVE_IDS = new Set<PassiveId>([
  PASSIVE_IDS.frost,
  PASSIVE_IDS.paralysis,
  PASSIVE_IDS.knockback,
  PASSIVE_IDS.blind,
  PASSIVE_IDS.stun,
  PASSIVE_IDS.splash,
  PASSIVE_IDS.burn,
  PASSIVE_IDS.poison,
  PASSIVE_IDS.wolfSpirit,
  PASSIVE_IDS.fireSpirit,
  PASSIVE_IDS.coldArrow,
  PASSIVE_IDS.thunderstorm,
]);

interface CriticalResolution {
  readonly isCritical: boolean;
  readonly damagePercent: number;
  readonly shieldBypassPercent: number;
}

export function createBasicAttackSnapshot(
  owner: PlayerEntity,
  outgoingDamageBasisPoints: number,
): BasicAttackSnapshot {
  return {
    sourceEntityId: owner.entityId,
    sourceElement: owner.element,
    baseDamage: effectiveAttackPower(owner),
    outgoingDamageBasisPoints,
    forcedCritical: owner.armedCriticalTicks > 0,
    missingHpDamagePercent: owner.armedCriticalTicks > 0 ? owner.armedMissingHpDamagePercent : 0,
    ...(owner.armedActiveId === null ? {} : { armedActiveId: owner.armedActiveId }),
  };
}

function resolveCritical(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: BasicHitTarget,
  forced: boolean,
): CriticalResolution {
  const loadout = findPassiveLoadout(owner, PASSIVE_IDS.critical);
  if (!loadout) {
    if (forced) {
      const damagePercent = equipmentCriticalDamagePercent(owner, 200);
      events.push({
        type: 'critical-hit',
        tick: state.tick,
        sourceEntityId: owner.entityId,
        targetEntityId: target.entityId,
        passiveId: PASSIVE_IDS.backstab,
        criticalDamagePercent: damagePercent,
        shieldBypassPercent: 0,
      });
      return { isCritical: true, damagePercent, shieldBypassPercent: 0 };
    }
    return { isCritical: false, damagePercent: 100, shieldBypassPercent: 0 };
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.critical);
  if (definition.effect !== 'basic-critical') {
    return { isCritical: false, damagePercent: 100, shieldBypassPercent: 0 };
  }
  const chancePercent = passiveLevelValue(definition.chancePercentByLevel, loadout.level);
  if (
    !forced &&
    (owner.blindPreventsCritical || state.random.combat.nextInt(100) >= chancePercent)
  ) {
    return { isCritical: false, damagePercent: 100, shieldBypassPercent: 0 };
  }

  const damagePercent = equipmentCriticalDamagePercent(
    owner,
    scalePassiveMagnitude(
      passiveLevelValue(definition.criticalDamagePercentByLevel, loadout.level),
      owner,
    ),
  );
  const shieldBypassPercent =
    loadout.level === 5
      ? Math.min(100, scalePassiveMagnitude(definition.level5ShieldBypassPercent, owner))
      : 0;
  events.push({
    type: 'critical-hit',
    tick: state.tick,
    sourceEntityId: owner.entityId,
    targetEntityId: target.entityId,
    passiveId: definition.id,
    criticalDamagePercent: damagePercent,
    shieldBypassPercent,
  });
  return { isCritical: true, damagePercent, shieldBypassPercent };
}

function isPlayerTarget(target: BasicHitTarget): target is PlayerEntity {
  return 'heroId' in target;
}

function isTargetAlive(target: BasicHitTarget): boolean {
  return isPlayerTarget(target) ? target.lifeState === 'alive' : target.hp > 0;
}

function isTargetInvulnerable(target: BasicHitTarget): boolean {
  return isPlayerTarget(target)
    ? target.invulnerableTicks > 0 || target.iceCoffinTicks > 0
    : target.invulnerableTicks > 0;
}

function applyRawPassiveDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: BasicHitTarget,
  amount: number,
  form: 'dot' | 'skill' = 'dot',
  ignoreExecute = false,
): number {
  if (isPlayerTarget(target)) {
    return applyDamage(state, events, {
      sourceEntityId: owner.entityId,
      targetEntityId: target.entityId,
      amount: Math.max(1, amount),
      cause: 'passive',
      form,
      ignoreExecute,
    });
  }
  return applyMonsterDamage(
    state,
    events,
    owner.entityId,
    target,
    Math.max(1, amount),
    owner.element,
    { ignoreExecute },
  );
}

function applyElementalPassiveDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: BasicHitTarget,
  amount: number,
  isCritical = false,
  shieldBypassPercent = 0,
): number {
  if (isPlayerTarget(target)) {
    return applyDamage(state, events, {
      sourceEntityId: owner.entityId,
      targetEntityId: target.entityId,
      amount: Math.max(
        1,
        Math.trunc((amount * equipmentElementDamageBasisPoints(owner, target.element)) / 10_000),
      ),
      cause: 'passive',
      form: 'skill',
      isCritical,
      shieldBypassBasisPoints: shieldBypassPercent * 100,
    });
  }
  return applyMonsterDamage(state, events, owner.entityId, target, amount, owner.element);
}

function selectComboForcedPassive(
  state: MutableSimulationState,
  owner: PlayerEntity,
): PassiveId | undefined {
  const combo = findPassiveLoadout(owner, PASSIVE_IDS.combo);
  if (combo?.level !== 5) {
    return undefined;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.combo);
  if (
    definition.effect !== 'basic-combo' ||
    state.random.combat.nextInt(100) >= definition.level5ForcedPassiveChancePercent
  ) {
    return undefined;
  }
  const candidates = owner.passives
    .map((entry) => entry.passiveId)
    .filter(
      (passiveId) => passiveId !== PASSIVE_IDS.combo && COMBO_FORCED_PASSIVE_IDS.has(passiveId),
    );
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates[state.random.combat.nextInt(candidates.length)];
}

export function resolveBasicHit(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: BasicHitTarget,
  attack: BasicAttackSnapshot,
): number {
  if (!isTargetAlive(target) || isTargetInvulnerable(target)) {
    return 0;
  }

  if (isBasicAttackMissed(state, owner)) {
    return 0;
  }

  const targetHpBefore = target.hp;
  const modifier = resolveBasicAttackModifier(state, owner, target);
  const critical = resolveCritical(
    state,
    events,
    owner,
    target,
    modifier.guaranteedCritical || attack.forcedCritical === true,
  );
  const criticalDamage = Math.trunc((attack.baseDamage * critical.damagePercent) / 100);
  const outgoingDamage = Math.trunc(
    (criticalDamage * attack.outgoingDamageBasisPoints * modifier.damageBasisPoints) / 100_000_000,
  );

  const appliedDamage = isPlayerTarget(target)
    ? applyDamage(state, events, {
        sourceEntityId: owner.entityId,
        targetEntityId: target.entityId,
        amount: Math.max(
          1,
          Math.trunc(
            (outgoingDamage * equipmentElementDamageBasisPoints(owner, target.element)) / 10_000,
          ),
        ),
        cause: 'basic',
        form: 'basic',
        ...(attack.armedActiveId === undefined
          ? {}
          : { activeAbilityId: attack.armedActiveId }),
        outgoingDamageBasisPointsOverride: 10_000,
        isCritical: critical.isCritical,
        shieldBypassBasisPoints: critical.shieldBypassPercent * 100,
      })
    : applyMonsterDamage(
        state,
        events,
        owner.entityId,
        target,
        Math.max(1, outgoingDamage),
        attack.sourceElement,
        {
          outgoingDamageBasisPointsOverride: 10_000,
          ...(attack.armedActiveId === undefined
            ? {}
            : { activeAbilityId: attack.armedActiveId }),
        },
      );

  if (appliedDamage > 0 && attack.missingHpDamagePercent && attack.missingHpDamagePercent > 0) {
    const missingHp = Math.max(0, target.maxHp - targetHpBefore);
    const bonus = Math.max(1, Math.trunc((missingHp * attack.missingHpDamagePercent) / 100));
    if (isPlayerTarget(target)) {
      applyDamage(state, events, {
        sourceEntityId: owner.entityId,
        targetEntityId: target.entityId,
        amount: bonus,
        cause: 'active',
        form: 'percent',
        ...(attack.armedActiveId === undefined
          ? {}
          : { activeAbilityId: attack.armedActiveId }),
        ignoreExecute: true,
      });
    } else if (target.hp > 0) {
      applyMonsterDamage(state, events, owner.entityId, target, bonus, owner.element, {
        ignoreExecute: true,
        ...(attack.armedActiveId === undefined
          ? {}
          : { activeAbilityId: attack.armedActiveId }),
      });
    }
  }

  if (appliedDamage > 0 && owner.armedCriticalTicks > 0) {
    const armedActiveId = owner.armedActiveId;
    owner.armedCriticalTicks = 0;
    owner.armedMissingHpDamagePercent = 0;
    owner.armedActiveId = null;
    if (armedActiveId !== null) {
      clearActiveStatusEffect(
        state,
        events,
        owner.entityId,
        owner.entityId,
        'armed-critical',
        armedActiveId,
      );
    }
    if (armedActiveId === 'H010' && !isTargetAlive(target)) {
      owner.activeCooldownTicks = 0;
    }
  }

  const momentum = findPassiveLoadout(owner, PASSIVE_IDS.momentum);
  if (appliedDamage > 0 && isTargetAlive(target) && momentum?.level === 5 && owner.b36Stacks >= 8) {
    const gameMoveSpeed = Math.trunc(currentMoveSpeedMmPerSecond(state, owner) / 10);
    const momentumDamage = scalePassiveMagnitude(Math.trunc((gameMoveSpeed * 20) / 100), owner);
    if (momentumDamage > 0) {
      applyElementalPassiveDamage(
        state,
        events,
        owner,
        target,
        Math.max(1, Math.trunc((momentumDamage * critical.damagePercent) / 100)),
        critical.isCritical,
        critical.shieldBypassPercent,
      );
    }
  }

  if (appliedDamage > 0 && isTargetAlive(target)) {
    applyEquipmentBurn(state, owner, target.entityId);
    applyBasicHitStatuses(
      state,
      events,
      owner,
      target,
      critical.isCritical,
      attack.forcedPassiveId,
    );
  }
  if (appliedDamage > 0) {
    recordComboShoesBasicHit(state, events, owner, target.entityId, appliedDamage);
    if (isPlayerTarget(target) && (attack.comboDepth ?? 0) === 0) {
      resolvePickpocket(state, events, owner, target);
    }
    if (isPlayerTarget(target)) {
      resolveIncomingBasicPassiveEffects(
        state,
        events,
        target,
        owner.entityId,
        critical.isCritical,
      );
    }
    const effects = resolveBasicHitPassiveEffects(
      state,
      events,
      owner,
      target,
      attack.forcedPassiveId,
      (attack.comboDepth ?? 0) === 0,
    );
    trySpawnPassiveSummons(state, events, owner, attack.forcedPassiveId);

    if (effects.burnDetonationDamage > 0 && isTargetAlive(target)) {
      applyRawPassiveDamage(
        state,
        events,
        owner,
        target,
        effects.burnDetonationDamage,
        'dot',
        true,
      );
    }

    if (effects.splashTriggered) {
      const splashDamage = Math.max(
        1,
        Math.trunc(
          (((attack.baseDamage * modifier.damageBasisPoints) / 10_000) * effects.splashPercent) /
            100,
        ),
      );
      const radiusSquared = effects.splashRadiusMm * effects.splashRadiusMm;
      for (const nearby of [...state.players.values(), ...state.monsters.values()]) {
        if (
          nearby.entityId === owner.entityId ||
          (nearby.entityId === target.entityId &&
            !(findPassiveLoadout(owner, PASSIVE_IDS.splash)?.level === 5)) ||
          !isTargetAlive(nearby) ||
          distanceSquaredMm(target.position, nearby.position) > radiusSquared
        ) {
          continue;
        }
        applyRawPassiveDamage(state, events, owner, nearby, splashDamage);
      }
      const summonDamage = Math.max(
        1,
        Math.trunc((splashDamage * getOutgoingDamageBasisPoints(owner)) / 10_000),
      );
      for (const summon of state.summons.values()) {
        if (
          summon.ownerEntityId === owner.entityId ||
          !summon.targetable ||
          summon.hp <= 0 ||
          distanceSquaredMm(target.position, summon.position) > radiusSquared
        ) {
          continue;
        }
        applySummonDamage(state, events, owner.entityId, summon, summonDamage);
      }
    }

    if (effects.thunderstormTriggered) {
      const radiusSquared = effects.thunderstormRadiusMm * effects.thunderstormRadiusMm;
      for (const nearby of [...state.players.values(), ...state.monsters.values()]) {
        if (
          nearby.entityId === owner.entityId ||
          !isTargetAlive(nearby) ||
          distanceSquaredMm(target.position, nearby.position) > radiusSquared
        ) {
          continue;
        }
        applyElementalPassiveDamage(state, events, owner, nearby, effects.thunderstormDamage);
      }
      const summonDamage = Math.max(
        1,
        Math.trunc((effects.thunderstormDamage * getOutgoingDamageBasisPoints(owner)) / 10_000),
      );
      for (const summon of state.summons.values()) {
        if (
          summon.ownerEntityId === owner.entityId ||
          !summon.targetable ||
          summon.hp <= 0 ||
          distanceSquaredMm(target.position, summon.position) > radiusSquared
        ) {
          continue;
        }
        applySummonDamage(state, events, owner.entityId, summon, summonDamage);
      }
    }

    const lifestealPercent = basicLifestealPercent(owner);
    if (lifestealPercent > 0) {
      owner.hp = Math.min(
        owner.maxHp,
        owner.hp + Math.trunc((appliedDamage * lifestealPercent) / 100),
      );
    }

    if (effects.coldArrowDamage > 0) {
      launchColdArrowProjectile(state, owner, target, effects.coldArrowDamage, 50_000);
    }

    for (let extraHit = 0; extraHit < effects.comboExtraHits; extraHit += 1) {
      if (!isTargetAlive(target)) {
        break;
      }
      const forcedPassiveId =
        extraHit === effects.comboExtraHits - 1
          ? selectComboForcedPassive(state, owner)
          : undefined;
      resolveBasicHit(state, events, owner, target, {
        ...attack,
        comboDepth: (attack.comboDepth ?? 0) + 1,
        ...(forcedPassiveId === undefined ? {} : { forcedPassiveId }),
      });
    }
  }
  return appliedDamage;
}

export function resolveColdArrowHit(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: BasicHitTarget,
  baseDamage: number,
): number {
  if (!isTargetAlive(target) || isTargetInvulnerable(target)) {
    return 0;
  }
  const coldArrow = findPassiveLoadout(owner, PASSIVE_IDS.coldArrow);
  const canCritical = coldArrow?.level === 5;
  const critical = canCritical
    ? resolveCritical(state, events, owner, target, false)
    : { isCritical: false, damagePercent: 100, shieldBypassPercent: 0 };
  const damage = Math.max(1, Math.trunc((baseDamage * critical.damagePercent) / 100));
  if (isPlayerTarget(target)) {
    return applyDamage(state, events, {
      sourceEntityId: owner.entityId,
      targetEntityId: target.entityId,
      amount: Math.max(
        1,
        Math.trunc((damage * equipmentElementDamageBasisPoints(owner, target.element)) / 10_000),
      ),
      cause: 'passive',
      form: 'skill',
      isCritical: critical.isCritical,
      shieldBypassBasisPoints: critical.shieldBypassPercent * 100,
    });
  }
  return applyMonsterDamage(state, events, owner.entityId, target, damage, owner.element);
}
