import {
  getPassiveDefinition,
  M0_RULES,
  PASSIVE_IDS,
  type PassiveLoadoutEntry,
  passiveLevelValue,
} from '@jwgb/content';
import {
  distanceSquaredMm,
  type EntityId,
  type PassiveId,
  TICKS_PER_SECOND,
  vec2Mm,
} from '@jwgb/core';
import { sortedMonsters, sortedPlayers } from '../state';
import type {
  DamageRequest,
  MonsterEntity,
  MutableSimulationState,
  PassiveTargetState,
  PlayerEntity,
  SimEvent,
} from '../types';
import {
  coreBossAdjustedHardControlTicks,
  coreBossAdjustedSlowPercent,
} from './core-boss-resistance';
import { resolveTargetForcedDisplacement } from './displacement';
import {
  equipmentAdjustedSlowPercent,
  equipmentBackstabBonusBasisPoints,
  equipmentBasicLifestealPercent,
  equipmentFixedDamageReduction,
  equipmentHardControlTicks,
  equipmentIncomingDamageBasisPoints,
  equipmentTargetDamageBasisPoints,
} from './equipment-query';
import { addPassiveShield } from './shield';
import { isInNormalStormZone } from './storm-zone';
import { applyHardControl } from './whirlwind';

const BASIS_POINTS = 10_000;

export type BasicHitTarget = PlayerEntity | MonsterEntity;

export interface BasicAttackModifier {
  readonly damageBasisPoints: number;
  readonly guaranteedCritical: boolean;
}

export interface IncomingDamageModifier {
  readonly amount: number;
  readonly avoided: boolean;
}

export interface BasicHitPassiveEffects {
  readonly splashTriggered: boolean;
  readonly splashPercent: number;
  readonly splashRadiusMm: number;
  readonly burnDetonationDamage: number;
  readonly poisonDamagePerSecond: number;
  readonly poisonStacks: number;
  readonly comboExtraHits: number;
  readonly coldArrowDamage: number;
  readonly thunderstormTriggered: boolean;
  readonly thunderstormDamage: number;
  readonly thunderstormRadiusMm: number;
}

function targetStateKey(sourceEntityId: EntityId, targetEntityId: EntityId): string {
  return `${Number(sourceEntityId)}:${Number(targetEntityId)}`;
}

export function getOrCreatePassiveTargetState(
  state: MutableSimulationState,
  sourceEntityId: EntityId,
  targetEntityId: EntityId,
): PassiveTargetState {
  const key = targetStateKey(sourceEntityId, targetEntityId);
  const existing = state.passiveTargetStates.get(key);
  if (existing) {
    return existing;
  }
  const created: PassiveTargetState = {
    sourceEntityId,
    targetEntityId,
    burnStacks: 0,
    poisonStacks: 0,
    poisonExpiresAtTick: 0,
    poisonNextTick: 0,
    fireBurnDamagePerSecond: 0,
    fireBurnExpiresAtTick: 0,
    fireBurnNextTick: 0,
    fireBurnSourceEntityId: null,
    equipmentBurnDamagePerSecond: 0,
    equipmentBurnExpiresAtTick: 0,
    equipmentBurnNextTick: 0,
    equipmentBurnSourceEntityId: null,
    revealExpiresAtTick: 0,
    pickpocketCooldownTicks: 0,
    stunCooldownTicks: 0,
    counterCooldownTicks: 0,
    lastBasicHitTick: -1,
    comboShoesStacks: 0,
    comboShoesExpiresAtTick: 0,
  };
  state.passiveTargetStates.set(key, created);
  return created;
}

export function findPassiveLoadout(
  player: PlayerEntity,
  passiveId: PassiveId,
): PassiveLoadoutEntry | undefined {
  return player.passives.find((entry) => entry.passiveId === passiveId);
}

export function hasPassive(player: PlayerEntity, passiveId: PassiveId): boolean {
  return findPassiveLoadout(player, passiveId) !== undefined;
}

function chance(state: MutableSimulationState, percent: number): boolean {
  return state.random.combat.nextInt(100) < percent;
}

function emitPassiveProc(
  events: SimEvent[],
  tick: number,
  passiveId: PassiveId,
  sourceEntityId: EntityId,
  targetEntityId: EntityId | null,
  detail: string,
  amount = 0,
  durationTicks = 0,
): void {
  events.push({
    type: 'passive-proc',
    tick,
    passiveId,
    sourceEntityId,
    targetEntityId,
    detail,
    amount,
    durationTicks,
  });
}

function isPlayerTarget(target: BasicHitTarget): target is PlayerEntity {
  return 'heroId' in target;
}

function isLivingTarget(target: BasicHitTarget): boolean {
  return isPlayerTarget(target) ? target.lifeState === 'alive' : target.hp > 0;
}

export function maxSlow(target: BasicHitTarget, slowPercent: number, durationTicks: number): void {
  if (isPlayerTarget(target)) {
    slowPercent = equipmentAdjustedSlowPercent(target, slowPercent);
  } else {
    slowPercent = coreBossAdjustedSlowPercent(target, slowPercent);
  }
  if (slowPercent <= 0) {
    return;
  }
  if (
    isPlayerTarget(target) &&
    findPassiveLoadout(target, PASSIVE_IDS.sprint)?.level === 5 &&
    target.b27SpeedBoostTicks > 0
  ) {
    return;
  }
  const slowBasisPoints = Math.max(0, BASIS_POINTS - slowPercent * 100);
  if (
    slowBasisPoints < target.slowBasisPoints ||
    (slowBasisPoints === target.slowBasisPoints && durationTicks > target.slowTicks)
  ) {
    target.slowBasisPoints = slowBasisPoints;
    target.slowTicks = durationTicks;
  }
}

function isBehind(source: PlayerEntity, target: BasicHitTarget): boolean {
  const toSourceX = source.position.x - target.position.x;
  const toSourceZ = source.position.z - target.position.z;
  const facingDot = target.facing.x * toSourceX + target.facing.z * toSourceZ;
  if (facingDot >= 0) {
    return false;
  }
  const sourceMagnitudeSquared = toSourceX * toSourceX + toSourceZ * toSourceZ;
  const facingMagnitudeSquared =
    target.facing.x * target.facing.x + target.facing.z * target.facing.z;
  return 4 * facingDot * facingDot >= sourceMagnitudeSquared * facingMagnitudeSquared;
}

function missingHpTenPercentSteps(player: PlayerEntity): number {
  return Math.max(0, Math.floor(((player.maxHp - player.hp) * 10) / player.maxHp));
}

function knockbackTarget(
  state: MutableSimulationState,
  events: SimEvent[],
  origin: PlayerEntity['position'],
  target: BasicHitTarget,
  distanceMm: number,
): void {
  const dx = target.position.x - origin.x;
  const dz = target.position.z - origin.z;
  const magnitude = Math.max(1, Math.abs(dx) + Math.abs(dz));
  target.position = resolveTargetForcedDisplacement(
    state,
    events,
    target,
    target.position,
    vec2Mm(
      target.position.x + Math.trunc((dx * distanceMm) / magnitude),
      target.position.z + Math.trunc((dz * distanceMm) / magnitude),
    ),
    isPlayerTarget(target) ? M0_RULES.playerCapsuleRadiusMm : target.collisionRadiusMm,
  );
}

function attackPowerBonusBasisPoints(player: PlayerEntity): number {
  const loadout = findPassiveLoadout(player, PASSIVE_IDS.bloodlust);
  if (!loadout) {
    return BASIS_POINTS;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.bloodlust);
  if (definition.effect !== 'low-hp-offense') {
    return BASIS_POINTS;
  }
  const perStep = passiveLevelValue(
    definition.attackBonusPerMissingTenPercentByLevel,
    loadout.level,
  );
  return BASIS_POINTS + missingHpTenPercentSteps(player) * perStep * 100;
}

export function effectiveAttackPower(player: PlayerEntity): number {
  return Math.max(
    1,
    Math.trunc((player.attackPower * attackPowerBonusBasisPoints(player)) / BASIS_POINTS),
  );
}

export function getPassiveEffectMagnitudeBasisPoints(player: PlayerEntity): number {
  if (player.activeBuffTicks <= 0) {
    return BASIS_POINTS;
  }
  return player.activeBuffTicks > 0 && player.activeAbilityId === 'H009' ? 20_000 : BASIS_POINTS;
}

export function scalePassiveMagnitude(value: number, player: PlayerEntity): number {
  return Math.trunc((value * getPassiveEffectMagnitudeBasisPoints(player)) / BASIS_POINTS);
}

export function resolveBasicAttackModifier(
  state: MutableSimulationState,
  owner: PlayerEntity,
  target: BasicHitTarget,
): BasicAttackModifier {
  let damageBasisPoints = BASIS_POINTS;
  let guaranteedCritical = false;

  const backstab = findPassiveLoadout(owner, PASSIVE_IDS.backstab);
  if (backstab && isBehind(owner, target)) {
    const bonus = [35, 42, 50, 58, 70][backstab.level - 1] ?? 0;
    damageBasisPoints += isPlayerTarget(target)
      ? equipmentBackstabBonusBasisPoints(target, bonus * 100)
      : bonus * 100;
    if (backstab.level === 5) {
      guaranteedCritical = true;
    }
  }

  const ambush = findPassiveLoadout(owner, PASSIVE_IDS.ambush);
  if (ambush) {
    const targetState = getOrCreatePassiveTargetState(state, owner.entityId, target.entityId);
    const definition = getPassiveDefinition(PASSIVE_IDS.ambush);
    if (definition.effect !== 'ambush') {
      throw new Error('B29 definition mismatch');
    }
    const thresholdTicks = passiveLevelValue(definition.outOfCombatTicksByLevel, ambush.level);
    if (
      targetState.lastBasicHitTick < 0 ||
      state.tick - targetState.lastBasicHitTick >= thresholdTicks
    ) {
      const bonusBasisPoints =
        passiveLevelValue(definition.damageBonusPercentByLevel, ambush.level) * 100;
      damageBasisPoints += isPlayerTarget(target)
        ? equipmentBackstabBonusBasisPoints(target, bonusBasisPoints)
        : bonusBasisPoints;
      if (ambush.level === 5) {
        targetState.revealExpiresAtTick = state.tick + definition.level5RevealTicks;
      }
    }
  }

  if (owner.b21FirstHitReady) {
    damageBasisPoints += 3_000;
    owner.b21FirstHitReady = false;
  }

  const stormWard = findPassiveLoadout(owner, PASSIVE_IDS.stormWard);
  if (stormWard?.level === 5 && isInNormalStormZone(state, owner.position)) {
    const definition = getPassiveDefinition(PASSIVE_IDS.stormWard);
    if (definition.effect === 'storm-ward') {
      damageBasisPoints += definition.level5BasicDamageBonusPercent * 100;
    }
  }

  if (owner.b25NextBasicBonusPercent > 0) {
    damageBasisPoints += owner.b25NextBasicBonusPercent * 100;
    owner.b25NextBasicBonusPercent = 0;
  }

  return { damageBasisPoints, guaranteedCritical };
}

export function targetDamageBonusBasisPoints(
  source: PlayerEntity,
  target: BasicHitTarget,
  ignoreExecute = false,
): number {
  let basisPoints = BASIS_POINTS;
  const execute = findPassiveLoadout(source, PASSIVE_IDS.execute);
  if (execute && !ignoreExecute) {
    const definition = getPassiveDefinition(PASSIVE_IDS.execute);
    if (definition.effect === 'low-hp-execute') {
      const threshold = passiveLevelValue(definition.thresholdPercentByLevel, execute.level);
      if (target.hp * 100 <= target.maxHp * threshold) {
        basisPoints += passiveLevelValue(definition.damageBonusPercentByLevel, execute.level) * 100;
      }
    }
  }

  const hunt = findPassiveLoadout(source, PASSIVE_IDS.hunt);
  if (hunt && hunt.level === 5 && target.hp * 100 < target.maxHp * 30) {
    const definition = getPassiveDefinition(PASSIVE_IDS.hunt);
    if (
      definition.effect === 'low-hp-hunt' &&
      distanceSquaredMm(source.position, target.position) <=
        passiveLevelValue(definition.rangeMmByLevel, hunt.level) ** 2
    ) {
      basisPoints += definition.level5DamageBonusPercent * 100;
    }
  }
  basisPoints += equipmentTargetDamageBasisPoints(source, target) - BASIS_POINTS;
  return basisPoints;
}

export function isBasicAttackMissed(
  state: MutableSimulationState,
  attacker: BasicHitTarget,
): boolean {
  if (attacker.blindTicks <= 0 || attacker.blindMissPercent <= 0) {
    return false;
  }
  const missed = chance(state, attacker.blindMissPercent);
  if (missed) {
  }
  return missed;
}

export function resolveIncomingDamageModifier(
  state: MutableSimulationState,
  target: PlayerEntity,
  request: DamageRequest,
): IncomingDamageModifier {
  if (request.amount <= 0) {
    return { amount: 0, avoided: false };
  }

  let amount = Math.trunc(
    (request.amount * equipmentIncomingDamageBasisPoints(target, request.form)) / BASIS_POINTS,
  );

  if (request.form === 'basic') {
    const dodge = findPassiveLoadout(target, PASSIVE_IDS.dodge);
    if (dodge && chance(state, [10, 13, 16, 20, 25][dodge.level - 1] ?? 0)) {
      const definition = getPassiveDefinition(PASSIVE_IDS.dodge);
      if (definition.effect === 'basic-dodge') {
        target.b15SpeedBoostTicks = passiveLevelValue(definition.durationTicksByLevel, dodge.level);
        target.b15SpeedBonusPercent = passiveLevelValue(
          definition.speedBonusPercentByLevel,
          dodge.level,
        );
      }
      return { amount: 0, avoided: true };
    }

    const ironSkin = findPassiveLoadout(target, PASSIVE_IDS.ironSkin);
    if (ironSkin) {
      const definition = getPassiveDefinition(PASSIVE_IDS.ironSkin);
      if (definition.effect === 'basic-reduction') {
        if (ironSkin.level === 5 && chance(state, definition.level5BlockChancePercent)) {
          return { amount: 0, avoided: true };
        }
        amount = Math.max(
          1,
          amount - passiveLevelValue(definition.reductionByLevel, ironSkin.level),
        );
      }
    }
  }

  amount = Math.max(1, amount - equipmentFixedDamageReduction(target, request.form));
  if (target.hardControlTicks > 0) {
    const adversity = findPassiveLoadout(target, PASSIVE_IDS.adversity);
    if (adversity) {
      const reduction = [15, 20, 25, 30, 35][adversity.level - 1] ?? 0;
      amount = Math.trunc((amount * (100 - reduction)) / 100);
    }
  }

  return {
    amount: Math.max(0, amount),
    avoided: false,
  };
}

export function tryCreateReactiveShield(
  state: MutableSimulationState,
  events: SimEvent[],
  target: PlayerEntity,
  sourceEntityId: EntityId,
): void {
  const loadout = findPassiveLoadout(target, PASSIVE_IDS.reactiveShield);
  if (!loadout) {
    return;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.reactiveShield);
  if (definition.effect !== 'incoming-basic-shield') {
    return;
  }
  const chancePercent = passiveLevelValue(definition.chancePercentByLevel, loadout.level);
  if (!chance(state, chancePercent)) {
    return;
  }

  const amount = scalePassiveMagnitude(
    passiveLevelValue(definition.shieldAmountByLevel, loadout.level),
    target,
  );
  const breakEffect =
    loadout.level === 5
      ? {
          sourceEntityId: target.entityId,
          sourceElement: target.element,
          damage: scalePassiveMagnitude(definition.level5BreakAoeDamage, target),
          radiusMm: definition.level5BreakAoeRadiusMm,
        }
      : null;
  addPassiveShield(state, target, definition.id, amount, definition.durationTicks, breakEffect);
  events.push({
    type: 'passive-shield-created',
    tick: state.tick,
    entityId: target.entityId,
    sourceEntityId,
    passiveId: definition.id,
    amount,
    durationTicks: definition.durationTicks,
  });
}

export function applyTargetHardControl(
  state: MutableSimulationState,
  events: SimEvent[],
  target: BasicHitTarget,
  durationTicks: number,
  source?: PlayerEntity,
): boolean {
  const adjustedDuration = source
    ? equipmentHardControlTicks(source, durationTicks)
    : durationTicks;
  if (isPlayerTarget(target)) {
    return applyHardControl(target, adjustedDuration, state, events);
  }
  target.hardControlTicks = Math.max(
    target.hardControlTicks,
    coreBossAdjustedHardControlTicks(target, adjustedDuration),
  );
  return true;
}

export function applyBasicHitStatuses(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: BasicHitTarget,
  isCritical: boolean,
  forcedPassiveId?: PassiveId,
): void {
  const frost = findPassiveLoadout(owner, PASSIVE_IDS.frost);
  if (
    frost &&
    (forcedPassiveId === PASSIVE_IDS.frost ||
      chance(state, [10, 13, 16, 20, 25][frost.level - 1] ?? 0))
  ) {
    const definition = getPassiveDefinition(PASSIVE_IDS.frost);
    if (definition.effect === 'basic-slow') {
      const duration = passiveLevelValue(definition.durationTicksByLevel, frost.level);
      const slow = passiveLevelValue(definition.slowPercentByLevel, frost.level);
      maxSlow(target, slow, duration);
      emitPassiveProc(
        events,
        state.tick,
        PASSIVE_IDS.frost,
        owner.entityId,
        target.entityId,
        'slow',
        slow,
        duration,
      );
      if (frost.level === 5) {
        for (const nearby of [...sortedPlayers(state), ...sortedMonsters(state)]) {
          if (
            nearby.entityId !== target.entityId &&
            nearby.entityId !== owner.entityId &&
            isLivingTarget(nearby) &&
            distanceSquaredMm(target.position, nearby.position) <=
              definition.level5AoeRadiusMm * definition.level5AoeRadiusMm
          ) {
            maxSlow(nearby, definition.level5AoeSlowPercent, duration);
          }
        }
      }
    }
  }

  const paralysis = findPassiveLoadout(owner, PASSIVE_IDS.paralysis);
  if (
    paralysis &&
    (forcedPassiveId === PASSIVE_IDS.paralysis ||
      chance(state, [8, 10, 12, 15, 18][paralysis.level - 1] ?? 0))
  ) {
    const definition = getPassiveDefinition(PASSIVE_IDS.paralysis);
    if (definition.effect === 'basic-silence') {
      target.silenceTicks = Math.max(
        target.silenceTicks,
        passiveLevelValue(definition.durationTicksByLevel, paralysis.level),
      );
      if (paralysis.level === 5) {
        if (isPlayerTarget(target)) {
          target.silenceCooldownPenaltyTicks += definition.level5CooldownPenaltyTicks;
        } else {
          target.silenceCooldownPenaltyTicks += definition.level5CooldownPenaltyTicks;
        }
      }
      emitPassiveProc(
        events,
        state.tick,
        PASSIVE_IDS.paralysis,
        owner.entityId,
        target.entityId,
        'silence',
        0,
        target.silenceTicks,
      );
    }
  }

  const blind = findPassiveLoadout(owner, PASSIVE_IDS.blind);
  if (
    blind &&
    (forcedPassiveId === PASSIVE_IDS.blind ||
      chance(state, [10, 12, 14, 17, 20][blind.level - 1] ?? 0))
  ) {
    const definition = getPassiveDefinition(PASSIVE_IDS.blind);
    if (definition.effect === 'basic-blind') {
      target.blindTicks = Math.max(
        target.blindTicks,
        passiveLevelValue(definition.durationTicksByLevel, blind.level),
      );
      target.blindMissPercent = Math.max(
        target.blindMissPercent,
        passiveLevelValue(definition.missPercentByLevel, blind.level),
      );
      if (blind.level === 5) {
        target.blindPreventsCritical = true;
      }
      emitPassiveProc(
        events,
        state.tick,
        PASSIVE_IDS.blind,
        owner.entityId,
        target.entityId,
        'blind',
        target.blindMissPercent,
        target.blindTicks,
      );
    }
  }

  const stun = findPassiveLoadout(owner, PASSIVE_IDS.stun);
  if (stun) {
    const targetState = getOrCreatePassiveTargetState(state, owner.entityId, target.entityId);
    const definition = getPassiveDefinition(PASSIVE_IDS.stun);
    if (
      definition.effect === 'basic-stun' &&
      targetState.stunCooldownTicks <= 0 &&
      (forcedPassiveId === PASSIVE_IDS.stun ||
        chance(state, passiveLevelValue(definition.chancePercentByLevel, stun.level)))
    ) {
      targetState.stunCooldownTicks = definition.internalCooldownTicks;
      applyTargetHardControl(
        state,
        events,
        target,
        passiveLevelValue(definition.durationTicksByLevel, stun.level),
        owner,
      );
      emitPassiveProc(
        events,
        state.tick,
        PASSIVE_IDS.stun,
        owner.entityId,
        target.entityId,
        'stun',
        0,
        target.hardControlTicks,
      );
      if (stun.level === 5) {
        for (const nearby of [...sortedPlayers(state), ...sortedMonsters(state)]) {
          if (
            nearby.entityId !== target.entityId &&
            nearby.entityId !== owner.entityId &&
            isLivingTarget(nearby) &&
            distanceSquaredMm(target.position, nearby.position) <=
              definition.level5AoeRadiusMm * definition.level5AoeRadiusMm
          ) {
            applyTargetHardControl(state, events, nearby, definition.level5AoeDurationTicks, owner);
          }
        }
      }
    }
  }

  if (isCritical || forcedPassiveId === PASSIVE_IDS.knockback) {
    const knockback = findPassiveLoadout(owner, PASSIVE_IDS.knockback);
    if (
      knockback &&
      (forcedPassiveId === PASSIVE_IDS.knockback ||
        chance(state, [20, 23, 26, 30, 35][knockback.level - 1] ?? 0))
    ) {
      const definition = getPassiveDefinition(PASSIVE_IDS.knockback);
      if (definition.effect === 'critical-knockback') {
        const distance = passiveLevelValue(definition.distanceMmByLevel, knockback.level);
        knockbackTarget(state, events, owner.position, target, distance);
        emitPassiveProc(
          events,
          state.tick,
          PASSIVE_IDS.knockback,
          owner.entityId,
          target.entityId,
          'knockback',
          distance,
        );
        if (knockback.level === 5) {
          const radiusSquared = definition.level5AoeRadiusMm * definition.level5AoeRadiusMm;
          for (const nearby of [...sortedPlayers(state), ...sortedMonsters(state)]) {
            if (
              nearby.entityId === owner.entityId ||
              nearby.entityId === target.entityId ||
              !isLivingTarget(nearby) ||
              distanceSquaredMm(target.position, nearby.position) > radiusSquared
            ) {
              continue;
            }
            knockbackTarget(state, events, target.position, nearby, definition.level5AoeDistanceMm);
          }
        }
      }
    }
  }
}

export function resolveBasicHitPassiveEffects(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: BasicHitTarget,
  forcedPassiveId?: PassiveId,
  allowCombo = true,
): BasicHitPassiveEffects {
  let splashTriggered = false;
  let splashPercent = 0;
  let splashRadiusMm = 0;
  let burnDetonationDamage = 0;
  let poisonDamagePerSecond = 0;
  let poisonStacks = 0;
  let comboExtraHits = 0;
  let coldArrowDamage = 0;
  let thunderstormTriggered = false;
  let thunderstormDamage = 0;
  let thunderstormRadiusMm = 0;

  const splash = findPassiveLoadout(owner, PASSIVE_IDS.splash);
  if (
    splash &&
    (forcedPassiveId === PASSIVE_IDS.splash ||
      chance(state, [10, 13, 16, 20, 25][splash.level - 1] ?? 0))
  ) {
    splashTriggered = true;
    splashPercent = [40, 45, 50, 55, 60][splash.level - 1] ?? 0;
    splashRadiusMm = splash.level === 5 ? 4_500 : 3_000;
    emitPassiveProc(
      events,
      state.tick,
      PASSIVE_IDS.splash,
      owner.entityId,
      target.entityId,
      'splash',
      splashPercent,
      splashRadiusMm,
    );
  }

  const burn = findPassiveLoadout(owner, PASSIVE_IDS.burn);
  if (burn) {
    const targetState = getOrCreatePassiveTargetState(state, owner.entityId, target.entityId);
    const definition = getPassiveDefinition(PASSIVE_IDS.burn);
    if (definition.effect !== 'basic-burn-stack') {
      throw new Error('B08 definition mismatch');
    }
    const threshold = passiveLevelValue(definition.thresholdByLevel, burn.level);
    targetState.burnStacks += forcedPassiveId === PASSIVE_IDS.burn ? 2 : 1;
    if (targetState.burnStacks >= threshold) {
      targetState.burnStacks = 0;
      const lostHp = Math.max(0, target.maxHp - target.hp);
      burnDetonationDamage = Math.trunc(
        (lostHp * passiveLevelValue(definition.lostHpDamagePercentByLevel, burn.level)) / 100,
      );
      emitPassiveProc(
        events,
        state.tick,
        PASSIVE_IDS.burn,
        owner.entityId,
        target.entityId,
        'burn-detonation',
        burnDetonationDamage,
      );
      if (burn.level === 5) {
        const spreadRadiusSquared = definition.spreadRadiusMm * definition.spreadRadiusMm;
        for (const nearby of [...sortedPlayers(state), ...sortedMonsters(state)]) {
          if (
            nearby.entityId === owner.entityId ||
            nearby.entityId === target.entityId ||
            !isLivingTarget(nearby) ||
            distanceSquaredMm(target.position, nearby.position) > spreadRadiusSquared
          ) {
            continue;
          }
          const nearbyState = getOrCreatePassiveTargetState(state, owner.entityId, nearby.entityId);
          nearbyState.burnStacks = Math.min(
            threshold - 1,
            nearbyState.burnStacks + definition.level5SpreadStacks,
          );
          emitPassiveProc(
            events,
            state.tick,
            PASSIVE_IDS.burn,
            owner.entityId,
            nearby.entityId,
            'burn-spread',
            nearbyState.burnStacks,
          );
        }
      }
    }
  }

  const poison = findPassiveLoadout(owner, PASSIVE_IDS.poison);
  if (poison) {
    const targetState = getOrCreatePassiveTargetState(state, owner.entityId, target.entityId);
    const definition = getPassiveDefinition(PASSIVE_IDS.poison);
    if (definition.effect !== 'basic-poison-stack') {
      throw new Error('B09 definition mismatch');
    }
    poisonStacks = Math.min(
      targetState.poisonStacks + (forcedPassiveId === PASSIVE_IDS.poison ? 2 : 1),
      passiveLevelValue(definition.maxStacksByLevel, poison.level),
    );
    targetState.poisonStacks = poisonStacks;
    targetState.poisonExpiresAtTick =
      state.tick + passiveLevelValue(definition.durationTicksByLevel, poison.level);
    targetState.poisonNextTick = state.tick + TICKS_PER_SECOND;
    poisonDamagePerSecond = passiveLevelValue(definition.damagePerSecondByLevel, poison.level);
    if (poison.level === 5 && poisonStacks >= 5) {
      poisonDamagePerSecond = Math.trunc(
        (poisonDamagePerSecond * definition.level5FullStackMultiplierBasisPoints) / BASIS_POINTS,
      );
    }
    emitPassiveProc(
      events,
      state.tick,
      PASSIVE_IDS.poison,
      owner.entityId,
      target.entityId,
      'poison-stack',
      poisonStacks,
      targetState.poisonExpiresAtTick - state.tick,
    );
  }

  const combo = findPassiveLoadout(owner, PASSIVE_IDS.combo);
  if (allowCombo && combo && chance(state, [8, 10, 12, 15, 20][combo.level - 1] ?? 0)) {
    comboExtraHits = 1 + state.random.combat.nextInt([1, 1, 2, 2, 3][combo.level - 1] ?? 1);
    emitPassiveProc(
      events,
      state.tick,
      PASSIVE_IDS.combo,
      owner.entityId,
      target.entityId,
      'combo',
      comboExtraHits,
    );
  }

  const coldArrow = findPassiveLoadout(owner, PASSIVE_IDS.coldArrow);
  if (
    coldArrow &&
    (forcedPassiveId === PASSIVE_IDS.coldArrow ||
      chance(state, [10, 12, 14, 16, 20][coldArrow.level - 1] ?? 0))
  ) {
    coldArrowDamage = [60, 80, 100, 120, 150][coldArrow.level - 1] ?? 0;
    emitPassiveProc(
      events,
      state.tick,
      PASSIVE_IDS.coldArrow,
      owner.entityId,
      target.entityId,
      'cold-arrow',
      coldArrowDamage,
    );
  }

  const thunderstorm = findPassiveLoadout(owner, PASSIVE_IDS.thunderstorm);
  if (thunderstorm) {
    const definition = getPassiveDefinition(PASSIVE_IDS.thunderstorm);
    if (definition.effect === 'thunderstorm') {
      let chancePercent = passiveLevelValue(definition.chancePercentByLevel, thunderstorm.level);
      if (thunderstorm.level === 5 && isInNormalStormZone(state, owner.position)) {
        chancePercent = Math.trunc(
          (chancePercent * definition.level5StormChanceMultiplierBasisPoints) / BASIS_POINTS,
        );
      }
      if (forcedPassiveId === PASSIVE_IDS.thunderstorm || chance(state, chancePercent)) {
        thunderstormTriggered = true;
        thunderstormDamage = passiveLevelValue(definition.damageByLevel, thunderstorm.level);
        thunderstormRadiusMm = passiveLevelValue(definition.radiusMmByLevel, thunderstorm.level);
        emitPassiveProc(
          events,
          state.tick,
          PASSIVE_IDS.thunderstorm,
          owner.entityId,
          target.entityId,
          'thunderstorm',
          thunderstormDamage,
          thunderstormRadiusMm,
        );
      }
    }
  }

  return {
    splashTriggered,
    splashPercent,
    splashRadiusMm,
    burnDetonationDamage,
    poisonDamagePerSecond,
    poisonStacks,
    comboExtraHits,
    coldArrowDamage,
    thunderstormTriggered,
    thunderstormDamage,
    thunderstormRadiusMm,
  };
}

export function resolveIncomingBasicPassiveEffects(
  state: MutableSimulationState,
  events: SimEvent[],
  target: PlayerEntity,
  sourceEntityId: EntityId | null,
  wasCritical: boolean,
): void {
  if (sourceEntityId === null) {
    return;
  }

  if (wasCritical) {
    const rage = findPassiveLoadout(target, PASSIVE_IDS.rage);
    if (rage) {
      target.b25NextBasicBonusPercent = [20, 28, 36, 44, 55][rage.level - 1] ?? 0;
      target.b25AttackSpeedBoostTicks = 40;
      target.b25AttackSpeedBonusPercent = rage.level === 5 ? 40 : 0;
      emitPassiveProc(
        events,
        state.tick,
        PASSIVE_IDS.rage,
        target.entityId,
        sourceEntityId,
        'rage',
        target.b25NextBasicBonusPercent,
        target.b25AttackSpeedBoostTicks,
      );
    }
  }

  const sprint = findPassiveLoadout(target, PASSIVE_IDS.sprint);
  if (sprint) {
    const chancePercent = [10, 13, 16, 20, 25][sprint.level - 1] ?? 0;
    if (chance(state, chancePercent)) {
      target.b27SpeedBoostTicks = [40, 40, 50, 50, 60][sprint.level - 1] ?? 40;
      target.b27SpeedBonusPercent = [20, 25, 30, 35, 40][sprint.level - 1] ?? 20;
      if (sprint.level === 5) {
        target.slowTicks = 0;
        target.slowBasisPoints = BASIS_POINTS;
      }
      emitPassiveProc(
        events,
        state.tick,
        PASSIVE_IDS.sprint,
        target.entityId,
        sourceEntityId,
        'sprint',
        target.b27SpeedBonusPercent,
        target.b27SpeedBoostTicks,
      );
    }
  }
}

export function basicLifestealPercent(player: PlayerEntity): number {
  const bloodlust = findPassiveLoadout(player, PASSIVE_IDS.bloodlust);
  const passivePercent =
    bloodlust && bloodlust.level === 5 && player.hp * 100 < player.maxHp * 30 ? 10 : 0;
  if (player.activeLifestealTicks <= 0) {
    return passivePercent + equipmentBasicLifestealPercent(player);
  }
  return passivePercent + player.activeLifestealPercent + equipmentBasicLifestealPercent(player);
}

export function applyFireSpiritBurn(
  state: MutableSimulationState,
  ownerEntityId: EntityId,
  targetEntityId: EntityId,
  damagePerSecond: number,
  durationTicks: number,
): void {
  const targetState = getOrCreatePassiveTargetState(state, ownerEntityId, targetEntityId);
  targetState.fireBurnDamagePerSecond = Math.max(
    targetState.fireBurnDamagePerSecond,
    damagePerSecond,
  );
  targetState.fireBurnExpiresAtTick = Math.max(
    targetState.fireBurnExpiresAtTick,
    state.tick + durationTicks,
  );
  targetState.fireBurnNextTick = state.tick + TICKS_PER_SECOND;
  targetState.fireBurnSourceEntityId = ownerEntityId;
}

export function advancePassiveRuntime(state: MutableSimulationState, events: SimEvent[]): void {
  for (const player of state.players.values()) {
    const silenceWasActive = player.silenceTicks > 0;
    player.slowTicks = Math.max(0, player.slowTicks - 1);
    player.silenceTicks = Math.max(0, player.silenceTicks - 1);
    player.blindTicks = Math.max(0, player.blindTicks - 1);
    player.b15SpeedBoostTicks = Math.max(0, player.b15SpeedBoostTicks - 1);
    player.b25AttackSpeedBoostTicks = Math.max(0, player.b25AttackSpeedBoostTicks - 1);
    player.b27SpeedBoostTicks = Math.max(0, player.b27SpeedBoostTicks - 1);
    player.b38NextHealTick = Math.max(0, player.b38NextHealTick - 1);
    player.b42SpeedBoostTicks = Math.max(0, player.b42SpeedBoostTicks - 1);
    if (player.slowTicks === 0) {
      player.slowBasisPoints = BASIS_POINTS;
    }
    if (player.blindTicks === 0) {
      player.blindMissPercent = 0;
      player.blindPreventsCritical = false;
    }
    if (silenceWasActive && player.silenceTicks === 0 && player.silenceCooldownPenaltyTicks > 0) {
      player.activeCooldownTicks += player.silenceCooldownPenaltyTicks;
      player.silenceCooldownPenaltyTicks = 0;
    }
    if (player.b15SpeedBoostTicks === 0) {
      player.b15SpeedBonusPercent = 0;
    }
    if (player.b27SpeedBoostTicks === 0) {
      player.b27SpeedBonusPercent = 0;
    }
    if (player.b42SpeedBoostTicks === 0) {
      player.b42SpeedBonusPercent = 0;
    }

    if (player.hardControlTicks > 0) {
      const adversity = findPassiveLoadout(player, PASSIVE_IDS.adversity);
      if (adversity && player.b38NextHealTick === 0) {
        const before = player.hp;
        player.hp = Math.min(
          player.maxHp,
          player.hp + Math.max(1, Math.trunc((player.maxHp * 2) / 100)),
        );
        player.b38NextHealTick = TICKS_PER_SECOND;
        if (player.hp > before) {
          emitPassiveProc(
            events,
            state.tick,
            PASSIVE_IDS.adversity,
            player.entityId,
            null,
            'control-heal',
            player.hp - before,
            TICKS_PER_SECOND,
          );
        }
      }
    }

    const recovery = findPassiveLoadout(player, PASSIVE_IDS.recovery);
    if (recovery && player.lifeState === 'alive') {
      const definition = getPassiveDefinition(PASSIVE_IDS.recovery);
      if (definition.effect !== 'out-of-combat-recovery') {
        continue;
      }
      const threshold = passiveLevelValue(definition.outOfCombatTicksByLevel, recovery.level);
      if (recovery.level === 5 && state.tick - player.lastCombatTick >= threshold) {
        player.b21FirstHitReady = true;
      }
      if (state.tick - player.lastCombatTick >= threshold && state.tick % TICKS_PER_SECOND === 0) {
        const healPerSecond = passiveLevelValue(definition.healPerSecondByLevel, recovery.level);
        const before = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + healPerSecond);
        if (player.hp > before) {
          emitPassiveProc(
            events,
            state.tick,
            PASSIVE_IDS.recovery,
            player.entityId,
            null,
            'recovery-heal',
            player.hp - before,
          );
        }
      }
    }
  }

  for (const monster of sortedMonsters(state)) {
    const silenceWasActive = monster.silenceTicks > 0;
    monster.silenceTicks = Math.max(0, monster.silenceTicks - 1);
    monster.blindTicks = Math.max(0, monster.blindTicks - 1);
    if (monster.blindTicks === 0) {
      monster.blindMissPercent = 0;
      monster.blindPreventsCritical = false;
    }
    if (silenceWasActive && monster.silenceTicks === 0) {
      monster.silenceCooldownPenaltyTicks = 0;
    }
  }

  for (const targetState of state.passiveTargetStates.values()) {
    targetState.stunCooldownTicks = Math.max(0, targetState.stunCooldownTicks - 1);
    targetState.counterCooldownTicks = Math.max(0, targetState.counterCooldownTicks - 1);
    targetState.pickpocketCooldownTicks = Math.max(0, targetState.pickpocketCooldownTicks - 1);
    if (targetState.poisonExpiresAtTick <= state.tick) {
      targetState.poisonStacks = 0;
      targetState.poisonNextTick = 0;
    }
    if (targetState.fireBurnExpiresAtTick <= state.tick) {
      targetState.fireBurnDamagePerSecond = 0;
      targetState.fireBurnNextTick = 0;
      targetState.fireBurnSourceEntityId = null;
    }
  }
}

type PlayerDamageApplier = (
  state: MutableSimulationState,
  events: SimEvent[],
  request: DamageRequest,
) => number;

type MonsterDamageApplier = (
  state: MutableSimulationState,
  events: SimEvent[],
  sourceEntityId: EntityId,
  monster: MonsterEntity,
  amount: number,
  sourceElement: PlayerEntity['element'],
  options?: {
    readonly outgoingDamageBasisPointsOverride?: number;
    readonly ignoreExecute?: boolean;
    readonly ignoreSourceBonuses?: boolean;
  },
) => number;

export function advancePassiveDamageOverTime(
  state: MutableSimulationState,
  events: SimEvent[],
  applyPlayerDamage: PlayerDamageApplier,
  applyMonsterDamage: MonsterDamageApplier,
): void {
  const targetStates = [...state.passiveTargetStates.values()].sort(
    (left, right) =>
      Number(left.sourceEntityId) - Number(right.sourceEntityId) ||
      Number(left.targetEntityId) - Number(right.targetEntityId),
  );

  for (const targetState of targetStates) {
    if (
      targetState.poisonStacks <= 0 ||
      targetState.poisonNextTick <= 0 ||
      state.tick < targetState.poisonNextTick ||
      state.tick >= targetState.poisonExpiresAtTick
    ) {
      continue;
    }
    const source = state.players.get(targetState.sourceEntityId);
    const target =
      state.players.get(targetState.targetEntityId) ??
      state.monsters.get(targetState.targetEntityId);
    if (!source || !target || !isLivingTarget(target)) {
      targetState.poisonStacks = 0;
      targetState.poisonNextTick = 0;
      continue;
    }
    const poison = findPassiveLoadout(source, PASSIVE_IDS.poison);
    if (!poison) {
      targetState.poisonStacks = 0;
      targetState.poisonNextTick = 0;
      continue;
    }
    const definition = getPassiveDefinition(PASSIVE_IDS.poison);
    if (definition.effect !== 'basic-poison-stack') {
      continue;
    }
    let damagePerStack = passiveLevelValue(definition.damagePerSecondByLevel, poison.level);
    if (
      poison.level === 5 &&
      targetState.poisonStacks >= passiveLevelValue(definition.maxStacksByLevel, poison.level)
    ) {
      damagePerStack = Math.trunc(
        (damagePerStack * definition.level5FullStackMultiplierBasisPoints) / BASIS_POINTS,
      );
    }
    const amount = Math.max(1, targetState.poisonStacks * damagePerStack);
    if (isPlayerTarget(target)) {
      applyPlayerDamage(state, events, {
        sourceEntityId: source.entityId,
        targetEntityId: target.entityId,
        amount,
        cause: 'passive',
        form: 'dot',
      });
    } else {
      applyMonsterDamage(state, events, source.entityId, target, amount, source.element);
    }
    emitPassiveProc(
      events,
      state.tick,
      PASSIVE_IDS.poison,
      source.entityId,
      target.entityId,
      'poison-tick',
      amount,
      targetState.poisonExpiresAtTick - state.tick,
    );
    targetState.poisonNextTick += TICKS_PER_SECOND;
  }

  for (const targetState of targetStates) {
    if (
      targetState.fireBurnDamagePerSecond <= 0 ||
      targetState.fireBurnSourceEntityId === null ||
      targetState.fireBurnNextTick <= 0 ||
      state.tick < targetState.fireBurnNextTick ||
      state.tick >= targetState.fireBurnExpiresAtTick
    ) {
      continue;
    }
    const source = state.players.get(targetState.fireBurnSourceEntityId);
    const target =
      state.players.get(targetState.targetEntityId) ??
      state.monsters.get(targetState.targetEntityId);
    if (!source || !target || !isLivingTarget(target)) {
      targetState.fireBurnDamagePerSecond = 0;
      targetState.fireBurnNextTick = 0;
      targetState.fireBurnSourceEntityId = null;
      continue;
    }
    const amount = targetState.fireBurnDamagePerSecond;
    if (isPlayerTarget(target)) {
      applyPlayerDamage(state, events, {
        sourceEntityId: source.entityId,
        targetEntityId: target.entityId,
        amount,
        cause: 'passive',
        form: 'dot',
        ignoreExecute: true,
        ignoreSourceBonuses: true,
      });
    } else {
      applyMonsterDamage(state, events, source.entityId, target, amount, source.element, {
        ignoreExecute: true,
        ignoreSourceBonuses: true,
      });
    }
    emitPassiveProc(
      events,
      state.tick,
      PASSIVE_IDS.fireSpirit,
      source.entityId,
      target.entityId,
      'fire-spirit-burn',
      amount,
      targetState.fireBurnExpiresAtTick - state.tick,
    );
    targetState.fireBurnNextTick += TICKS_PER_SECOND;
  }
}

export function markCombatActivity(
  state: MutableSimulationState,
  sourceEntityId: EntityId | null,
  targetEntityId: EntityId,
): void {
  const target = state.players.get(targetEntityId);
  if (target) {
    target.lastCombatTick = state.tick;
    target.b21FirstHitReady = false;
    target.nightCloakStillTicks = 0;
    target.nightCloakStealthed = false;
    target.flightActive = false;
  }
  if (sourceEntityId !== null) {
    const source =
      state.players.get(sourceEntityId) ??
      (() => {
        const summon = state.summons.get(sourceEntityId);
        return summon ? state.players.get(summon.ownerEntityId) : undefined;
      })();
    if (source) {
      source.lastCombatTick = state.tick;
      source.nightCloakStillTicks = 0;
      source.nightCloakStealthed = false;
      source.flightActive = false;
    }
    const directSource = state.players.get(sourceEntityId);
    if (directSource) {
      const targetState = getOrCreatePassiveTargetState(
        state,
        directSource.entityId,
        targetEntityId,
      );
      targetState.lastBasicHitTick = state.tick;
    }
  }
}

export function activeAttackSpeedBonusPercent(player: PlayerEntity): number {
  return player.b25AttackSpeedBoostTicks > 0 ? player.b25AttackSpeedBonusPercent : 0;
}

export function huntSpeedBonusPercent(state: MutableSimulationState, player: PlayerEntity): number {
  const hunt = findPassiveLoadout(player, PASSIVE_IDS.hunt);
  if (!hunt) {
    return 0;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.hunt);
  if (definition.effect !== 'low-hp-hunt') {
    return 0;
  }
  const rangeMm = passiveLevelValue(definition.rangeMmByLevel, hunt.level);
  const rangeSquared = rangeMm * rangeMm;
  const hasTarget = [...state.players.values(), ...state.monsters.values()].some(
    (target) =>
      target.entityId !== player.entityId &&
      isLivingTarget(target) &&
      target.hp * 100 < target.maxHp * 30 &&
      distanceSquaredMm(player.position, target.position) <= rangeSquared,
  );
  return hasTarget ? passiveLevelValue(definition.speedBonusPercentByLevel, hunt.level) : 0;
}

export function stormWardSpeedBonusPercent(
  state: MutableSimulationState,
  player: PlayerEntity,
): number {
  const ward = findPassiveLoadout(player, PASSIVE_IDS.stormWard);
  if (!ward || !isInNormalStormZone(state, player.position)) {
    return 0;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.stormWard);
  return definition.effect === 'storm-ward'
    ? passiveLevelValue(definition.stormSpeedBonusPercentByLevel, ward.level)
    : 0;
}
