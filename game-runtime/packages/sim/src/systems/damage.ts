import {
  getActiveDefinition,
  getPassiveDefinition,
  PASSIVE_IDS,
  passiveLevelValue,
} from '@jwgb/content';
import { assertSafeInteger, invariant } from '@jwgb/core';
import { getRequiredPlayer } from '../state';
import type { DamageRequest, MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { activeTargetDamageBonusBasisPoints } from './active-damage';
import { interruptAirdropChannel } from './airdrop';
import {
  equipmentCriticalDamagePercent,
  equipmentHasThornArmor,
  equipmentStormDamageBasisPoints,
} from './equipment-query';
import { getOutgoingDamageBasisPoints, resolveLethalProtection } from './lethal-protection';
import { beginTrueDeath } from './life';
import { applyMonsterDamage } from './monster-damage';
import { resolvePassiveKill } from './passive-kill';
import {
  effectiveAttackPower,
  findPassiveLoadout,
  getOrCreatePassiveTargetState,
  markCombatActivity,
  resolveIncomingDamageModifier,
  scalePassiveMagnitude,
  targetDamageBonusBasisPoints,
  tryCreateReactiveShield,
} from './passive-runtime';
import { absorbDamageWithShields, getTotalShield } from './shield';
import { resolveShieldBreakEffects } from './shield-break';
import { cancelHeroSwapOnDamage } from './shop';
import { applySummonDamage } from './summon-health';

interface ReactiveCriticalResult {
  readonly amount: number;
  readonly isCritical: boolean;
  readonly shieldBypassBasisPoints: number;
}

function playerOwnerForDamageSource(
  state: MutableSimulationState,
  sourceEntityId: DamageRequest['sourceEntityId'],
): PlayerEntity | null {
  if (sourceEntityId === null) {
    return null;
  }
  const player = state.players.get(sourceEntityId);
  if (player) {
    return player;
  }
  const summon = state.summons.get(sourceEntityId);
  return summon ? (state.players.get(summon.ownerEntityId) ?? null) : null;
}

function resolveReactiveCritical(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  targetEntityId: DamageRequest['targetEntityId'],
  amount: number,
  passiveId: typeof PASSIVE_IDS.reflect | typeof PASSIVE_IDS.counter,
  forced: boolean,
): ReactiveCriticalResult {
  const critical = findPassiveLoadout(owner, PASSIVE_IDS.critical);
  const definition = getPassiveDefinition(PASSIVE_IDS.critical);
  if (definition.effect !== 'basic-critical') {
    return { amount, isCritical: false, shieldBypassBasisPoints: 0 };
  }
  if (
    !forced &&
    (!critical ||
      owner.blindPreventsCritical ||
      state.random.combat.nextInt(100) >=
        passiveLevelValue(definition.chancePercentByLevel, critical.level))
  ) {
    return { amount, isCritical: false, shieldBypassBasisPoints: 0 };
  }

  const damagePercent = equipmentCriticalDamagePercent(
    owner,
    critical
      ? scalePassiveMagnitude(
          passiveLevelValue(definition.criticalDamagePercentByLevel, critical.level),
          owner,
        )
      : 200,
  );
  const shieldBypassPercent =
    critical?.level === 5
      ? Math.min(100, scalePassiveMagnitude(definition.level5ShieldBypassPercent, owner))
      : 0;
  events.push({
    type: 'critical-hit',
    tick: state.tick,
    sourceEntityId: owner.entityId,
    targetEntityId,
    passiveId,
    criticalDamagePercent: damagePercent,
    shieldBypassPercent,
  });
  return {
    amount: Math.max(1, Math.trunc((amount * damagePercent) / 100)),
    isCritical: true,
    shieldBypassBasisPoints: shieldBypassPercent * 100,
  };
}

function applyReactiveDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  targetEntityId: DamageRequest['targetEntityId'],
  resolution: ReactiveCriticalResult,
): number {
  if (resolution.amount <= 0) {
    return 0;
  }
  const targetPlayer = state.players.get(targetEntityId);
  if (targetPlayer) {
    return applyDamage(state, events, {
      sourceEntityId: owner.entityId,
      targetEntityId,
      amount: resolution.amount,
      cause: 'passive',
      form: 'reflect',
      outgoingDamageBasisPointsOverride: 10_000,
      isCritical: resolution.isCritical,
      shieldBypassBasisPoints: resolution.shieldBypassBasisPoints,
      ignoreExecute: true,
      ignoreSourceBonuses: true,
    });
  }
  const targetMonster = state.monsters.get(targetEntityId);
  if (targetMonster) {
    return applyMonsterDamage(
      state,
      events,
      owner.entityId,
      targetMonster,
      resolution.amount,
      null,
      {
        outgoingDamageBasisPointsOverride: 10_000,
        ignoreExecute: true,
        ignoreSourceBonuses: true,
        ignoreElement: true,
      },
    );
  }
  const targetSummon = state.summons.get(targetEntityId);
  if (targetSummon) {
    return applySummonDamage(state, events, owner.entityId, targetSummon, resolution.amount);
  }
  return 0;
}

function resolveBasicReflect(
  state: MutableSimulationState,
  events: SimEvent[],
  target: PlayerEntity,
  request: DamageRequest,
  actualDamage: number,
): void {
  if (
    request.form !== 'basic' ||
    request.sourceEntityId === null ||
    request.sourceEntityId === target.entityId
  ) {
    return;
  }
  const loadout = findPassiveLoadout(target, PASSIVE_IDS.reflect);
  const equipmentReflectPercent = equipmentHasThornArmor(target) ? 20 : 0;
  if (!loadout && equipmentReflectPercent === 0) {
    return;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.reflect);
  if (definition.effect !== 'basic-reflect') {
    return;
  }
  const percent =
    equipmentReflectPercent +
    (loadout
      ? scalePassiveMagnitude(
          passiveLevelValue(definition.reflectPercentByLevel, loadout.level),
          target,
        )
      : 0);
  const amount = Math.trunc((actualDamage * percent) / 100);
  if (amount <= 0) {
    return;
  }
  const resolution =
    loadout?.level === 5
      ? resolveReactiveCritical(
          state,
          events,
          target,
          request.sourceEntityId,
          amount,
          PASSIVE_IDS.reflect,
          false,
        )
      : { amount, isCritical: false, shieldBypassBasisPoints: 0 };
  const applied = applyReactiveDamage(state, events, target, request.sourceEntityId, resolution);
  if (applied > 0 && loadout) {
    events.push({
      type: 'passive-proc',
      tick: state.tick,
      passiveId: PASSIVE_IDS.reflect,
      sourceEntityId: target.entityId,
      targetEntityId: request.sourceEntityId,
      detail: 'reflect',
      amount: applied,
      durationTicks: 0,
    });
  }
}

function isDirectCounterEligible(request: DamageRequest): boolean {
  return (
    request.periodic !== true &&
    (request.form === 'basic' ||
      request.form === 'skill' ||
      request.form === 'percent' ||
      request.form === 'true')
  );
}

function resolveCounter(
  state: MutableSimulationState,
  events: SimEvent[],
  target: PlayerEntity,
  request: DamageRequest,
  actualDamage: number,
): void {
  if (
    actualDamage <= 0 ||
    request.sourceEntityId === null ||
    request.sourceEntityId === target.entityId ||
    !isDirectCounterEligible(request)
  ) {
    return;
  }
  const loadout = findPassiveLoadout(target, PASSIVE_IDS.counter);
  if (!loadout) {
    return;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.counter);
  if (definition.effect !== 'basic-counter') {
    return;
  }
  const targetState = getOrCreatePassiveTargetState(state, target.entityId, request.sourceEntityId);
  if (
    targetState.counterCooldownTicks > 0 ||
    state.random.combat.nextInt(100) >=
      passiveLevelValue(definition.chancePercentByLevel, loadout.level)
  ) {
    return;
  }
  targetState.counterCooldownTicks = definition.internalCooldownTicks;
  const coefficientPercent = scalePassiveMagnitude(
    passiveLevelValue(definition.damagePercentByLevel, loadout.level),
    target,
  );
  const amount = Math.max(1, Math.trunc((effectiveAttackPower(target) * coefficientPercent) / 100));
  const resolution =
    loadout.level === 5
      ? resolveReactiveCritical(
          state,
          events,
          target,
          request.sourceEntityId,
          amount,
          PASSIVE_IDS.counter,
          true,
        )
      : { amount, isCritical: false, shieldBypassBasisPoints: 0 };
  const applied = applyReactiveDamage(state, events, target, request.sourceEntityId, resolution);
  if (applied > 0) {
    events.push({
      type: 'passive-proc',
      tick: state.tick,
      passiveId: PASSIVE_IDS.counter,
      sourceEntityId: target.entityId,
      targetEntityId: request.sourceEntityId,
      detail: 'counter',
      amount: applied,
      durationTicks: definition.internalCooldownTicks,
    });
  }
}

function resolveSkillAbsorption(
  state: MutableSimulationState,
  events: SimEvent[],
  target: PlayerEntity,
  request: DamageRequest,
  actualDamage: number,
): void {
  if (
    request.form !== 'skill' ||
    request.sourceEntityId === null ||
    request.sourceEntityId === target.entityId ||
    target.hp <= 0
  ) {
    return;
  }
  const loadout = findPassiveLoadout(target, PASSIVE_IDS.absorption);
  if (!loadout) {
    return;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.absorption);
  if (definition.effect !== 'skill-absorption') {
    return;
  }
  const percent = scalePassiveMagnitude(
    passiveLevelValue(definition.absorptionPercentByLevel, loadout.level),
    target,
  );
  const converted = Math.trunc((actualDamage * percent) / 100);
  if (converted <= 0) {
    return;
  }
  const hpBefore = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + converted);
  events.push({
    type: 'passive-proc',
    tick: state.tick,
    passiveId: PASSIVE_IDS.absorption,
    sourceEntityId: target.entityId,
    targetEntityId: request.sourceEntityId,
    detail: 'skill-conversion-heal',
    amount: target.hp - hpBefore,
    durationTicks: 0,
  });
  if (loadout.level !== 5) {
    return;
  }
  const reflected = Math.trunc((converted * definition.level5ReflectPercent) / 100);
  const applied = applyReactiveDamage(state, events, target, request.sourceEntityId, {
    amount: reflected,
    isCritical: false,
    shieldBypassBasisPoints: 0,
  });
  if (applied > 0) {
    events.push({
      type: 'passive-proc',
      tick: state.tick,
      passiveId: PASSIVE_IDS.absorption,
      sourceEntityId: target.entityId,
      targetEntityId: request.sourceEntityId,
      detail: 'skill-conversion-reflect',
      amount: applied,
      durationTicks: 0,
    });
  }
}

export function applyDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  request: DamageRequest,
): number {
  assertSafeInteger(request.amount, 'damage amount');
  invariant(request.amount >= 0, 'damage amount must be non-negative');

  const target = getRequiredPlayer(state, request.targetEntityId);
  const targetHpBefore = target.hp;
  if (
    request.amount === 0 ||
    target.lifeState !== 'alive' ||
    target.invulnerableTicks > 0 ||
    target.iceCoffinTicks > 0
  ) {
    return 0;
  }

  const source =
    request.sourceEntityId === null ? undefined : state.players.get(request.sourceEntityId);
  const outgoingDamageBasisPoints =
    request.ignoreSourceBonuses === true
      ? 10_000
      : (request.outgoingDamageBasisPointsOverride ??
        (source ? getOutgoingDamageBasisPoints(source) : 10_000));
  assertSafeInteger(outgoingDamageBasisPoints, 'outgoing damage basis points');
  invariant(outgoingDamageBasisPoints >= 0, 'outgoing damage basis points must be non-negative');
  const targetDamageBasisPoints =
    source && request.ignoreSourceBonuses !== true
      ? Math.trunc(
          (targetDamageBonusBasisPoints(source, target, request.ignoreExecute === true) *
            activeTargetDamageBonusBasisPoints(state, source.entityId, target.entityId)) /
            10_000,
        )
      : 10_000;
  const outgoingDamage = Math.trunc(
    (request.amount * outgoingDamageBasisPoints * targetDamageBasisPoints) / 100_000_000,
  );
  const active = getActiveDefinition(target.activeAbilityId);
  const incomingDamageBasisPoints =
    target.activeBuffTicks > 0 && active.effect === 'self-combat-buff'
      ? active.incomingDamageBasisPoints
      : 10_000;
  const scriptedReduction =
    target.activeDamageReductionTicks > 0 && request.form !== 'true'
      ? target.activeDamageReductionBasisPoints
      : 10_000;
  const stormReduction =
    request.form === 'storm' ? equipmentStormDamageBasisPoints(target) : 10_000;
  const scriptedDamage = Math.trunc(
    (outgoingDamage * incomingDamageBasisPoints * scriptedReduction) / 100_000_000,
  );
  const amplifiedDamage = Math.trunc((scriptedDamage * stormReduction) / 10_000);
  const incomingModifier = resolveIncomingDamageModifier(state, target, {
    ...request,
    amount: amplifiedDamage,
  });
  if (incomingModifier.avoided) {
    return 0;
  }
  const modifiedDamage = incomingModifier.amount;
  if (
    request.form === 'basic' &&
    request.sourceEntityId !== null &&
    request.sourceEntityId !== target.entityId
  ) {
    tryCreateReactiveShield(state, events, target, request.sourceEntityId);
  }
  const shieldBypassBasisPoints = request.shieldBypassBasisPoints ?? 0;
  assertSafeInteger(shieldBypassBasisPoints, 'shield bypass basis points');
  invariant(
    shieldBypassBasisPoints >= 0 && shieldBypassBasisPoints <= 10_000,
    'shield bypass basis points must be between zero and 10000',
  );
  const requestedShieldBypassHpDamage = Math.trunc(
    (modifiedDamage * shieldBypassBasisPoints) / 10_000,
  );
  const shieldableDamage = modifiedDamage - requestedShieldBypassHpDamage;
  const shieldResult = absorbDamageWithShields(target, request.form, shieldableDamage);
  const shieldBypassHpDamage = Math.min(target.hp, requestedShieldBypassHpDamage);
  target.hp -= shieldBypassHpDamage;
  const regularHpDamage = Math.min(target.hp, shieldResult.remainingDamage);
  target.hp -= regularHpDamage;
  const hpDamage = shieldBypassHpDamage + regularHpDamage;
  const actualDamage = shieldResult.absorbed + hpDamage;

  if (actualDamage === 0) {
    return 0;
  }
  if (request.form !== 'storm') {
    interruptAirdropChannel(state, events, target.entityId, 'damaged');
  }

  const sourcePlayer = playerOwnerForDamageSource(state, request.sourceEntityId);
  if (
    request.sourceEntityId !== target.entityId &&
    sourcePlayer !== null &&
    sourcePlayer.entityId !== target.entityId
  ) {
    cancelHeroSwapOnDamage(state, events, target);
  }

  if (sourcePlayer !== null && sourcePlayer.entityId !== target.entityId) {
    sourcePlayer.pvpCombatTicks = 5 * 20;
    target.pvpCombatTicks = 5 * 20;
  }
  markCombatActivity(state, request.sourceEntityId, target.entityId);
  target.stealthTicks = 0;

  events.push({
    type: 'damage',
    tick: state.tick,
    sourceEntityId: request.sourceEntityId,
    targetEntityId: target.entityId,
    ...(request.activeAbilityId === undefined
      ? {}
      : { activeAbilityId: request.activeAbilityId }),
    cause: request.cause,
    form: request.form,
    isCritical: request.isCritical ?? false,
    amount: actualDamage,
    shieldDamage: shieldResult.absorbed,
    hpDamage,
    shieldBypassHpDamage,
    remainingHp: target.hp,
    remainingShield: getTotalShield(target),
  });

  resolveShieldBreakEffects(state, events, target, shieldResult.brokenShields, applyDamage);

  resolveBasicReflect(state, events, target, request, actualDamage);
  resolveCounter(state, events, target, request, actualDamage);
  resolveSkillAbsorption(state, events, target, request, actualDamage);

  if (target.hp === 0) {
    if (!resolveLethalProtection(state, events, target)) {
      beginTrueDeath(state, events, target);
      if (request.sourceEntityId !== null) {
        resolvePassiveKill(state, events, {
          sourceEntityId: request.sourceEntityId,
          victimEntityId: target.entityId,
          victimKind: 'hero',
          victimHpBefore: targetHpBefore,
          victimMaxHp: target.maxHp,
          victimPlayer: target,
          awardBaseHeroReward: true,
        });
      } else {
        for (let index = state.bountyMarks.length - 1; index >= 0; index -= 1) {
          const mark = state.bountyMarks[index];
          if (mark?.targetEntityId === target.entityId) {
            state.bountyMarks.splice(index, 1);
          }
        }
      }
    }
  }

  return actualDamage;
}
