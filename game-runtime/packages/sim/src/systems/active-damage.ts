import type { ScriptedActiveDefinition } from '@jwgb/content';
import type { ActiveId, EntityId } from '@jwgb/core';
import type {
  ActiveStatusKind,
  ActiveTargetEffectKind,
  ActiveTargetEffectState,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
} from '../types';
import {
  type ActiveTarget,
  isActivePlayer,
  isActiveSummon,
  isActiveZone,
} from './active-targeting';
import { interruptAirdropChannel } from './airdrop';
import {
  coreBossAdjustedHardControlTicks,
  coreBossAdjustedSlowPercent,
} from './core-boss-resistance';
import { applyDamage } from './damage';
import {
  equipmentAdjustedHardControlTicks,
  equipmentAdjustedSlowPercent,
  equipmentElementDamageBasisPoints,
  equipmentHardControlTicks,
  type HardControlKind,
} from './equipment-query';
import { getOutgoingDamageBasisPoints, hasB20ControlImmunity } from './lethal-protection';
import { applyMonsterDamage } from './monster-damage';
import { effectiveAttackPower } from './passive-runtime';
import { applySummonDamage } from './summon-health';
import { applyHardControl } from './whirlwind';

export function scriptedDamageAmount(
  owner: PlayerEntity,
  definition: Pick<ScriptedActiveDefinition, 'fixedDamage' | 'attackCoefficientBasisPoints'>,
): number {
  return Math.max(
    0,
    (definition.fixedDamage ?? 0) +
      Math.trunc(
        (effectiveAttackPower(owner) * (definition.attackCoefficientBasisPoints ?? 0)) / 10_000,
      ),
  );
}

export function activeTargetHp(target: ActiveTarget): number {
  return target.hp;
}

export function activeTargetMaxHp(target: ActiveTarget): number {
  return target.maxHp;
}

export function emitActiveStatusApplied(
  state: MutableSimulationState,
  events: SimEvent[],
  source: PlayerEntity,
  target: ActiveTarget,
  status: ActiveStatusKind,
  durationTicks: number,
  activeAbilityId: ActiveId = source.activeAbilityId,
): void {
  if (durationTicks <= 0 || isActiveZone(target) || isActiveSummon(target)) {
    return;
  }
  events.push({
    type: 'active-status-applied',
    tick: state.tick,
    sourceEntityId: source.entityId,
    targetEntityId: target.entityId,
    activeAbilityId,
    status,
    durationTicks,
  });
}

export function setActiveStatusEffect(
  state: MutableSimulationState,
  events: SimEvent[],
  source: PlayerEntity,
  target: ActiveTarget,
  status: ActiveStatusKind,
  durationTicks: number,
  activeAbilityId: ActiveId = source.activeAbilityId,
): ActiveTargetEffectState | undefined {
  if (durationTicks <= 0 || isActiveZone(target) || isActiveSummon(target)) {
    return undefined;
  }
  const key = activeTargetEffectKey(source.entityId, target.entityId, status);
  const previous = state.activeTargetEffects.get(key);
  const effect = setActiveTargetEffect(state, {
    sourceEntityId: source.entityId,
    targetEntityId: target.entityId,
    activeId: activeAbilityId,
    kind: status,
    stacks: 1,
    maximumStacks: 1,
    fixedDamage: 0,
    attackCoefficientBasisPoints: 0,
    percentDamage: 0,
    targetDamageBonusPercent: 0,
    revealToSource: false,
    expiresAtTick: Math.max(previous?.expiresAtTick ?? 0, state.tick + durationTicks),
    nextPulseTick: Number.MAX_SAFE_INTEGER,
    pulseIntervalTicks: 0,
  });
  emitActiveStatusApplied(
    state,
    events,
    source,
    target,
    status,
    durationTicks,
    activeAbilityId,
  );
  return effect;
}

export function expireActiveTargetEffect(
  state: MutableSimulationState,
  events: SimEvent[],
  effect: ActiveTargetEffectState,
): boolean {
  if (!state.activeTargetEffects.delete(effect.key)) {
    return false;
  }
  events.push({
    type: 'active-status-ended',
    tick: state.tick,
    sourceEntityId: effect.sourceEntityId,
    targetEntityId: effect.targetEntityId,
    activeAbilityId: effect.activeId,
    status: effect.kind,
  });
  return true;
}

export function clearActiveStatusEffect(
  state: MutableSimulationState,
  events: SimEvent[],
  sourceEntityId: EntityId,
  targetEntityId: EntityId,
  status: ActiveStatusKind,
  activeAbilityId?: ActiveId,
): boolean {
  const effect = state.activeTargetEffects.get(
    activeTargetEffectKey(sourceEntityId, targetEntityId, status),
  );
  if (!effect || (activeAbilityId !== undefined && effect.activeId !== activeAbilityId)) {
    return false;
  }
  return expireActiveTargetEffect(state, events, effect);
}

export function applyActiveDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: ActiveTarget,
  amount: number,
  options: {
    readonly form?: 'skill' | 'dot' | 'percent' | 'true';
    readonly periodic?: boolean;
    readonly ignoreElement?: boolean;
    readonly activeAbilityId?: ActiveId;
  } = {},
): number {
  if (amount <= 0) {
    return 0;
  }
  if (isActivePlayer(target)) {
    const form = options.form ?? 'skill';
    const elementalAmount =
      form === 'skill' || form === 'dot'
        ? Math.trunc((amount * equipmentElementDamageBasisPoints(owner, target.element)) / 10_000)
        : amount;
    return applyDamage(state, events, {
      sourceEntityId: owner.entityId,
      targetEntityId: target.entityId,
      amount: Math.max(0, elementalAmount),
      cause: 'active',
      form,
      activeAbilityId: options.activeAbilityId ?? owner.activeAbilityId,
      ...(options.periodic === undefined ? {} : { periodic: options.periodic }),
    });
  }
  if (isActiveSummon(target)) {
    return applySummonDamage(
      state,
      events,
      owner.entityId,
      target,
      Math.max(1, Math.trunc((amount * getOutgoingDamageBasisPoints(owner)) / 10_000)),
      { activeAbilityId: options.activeAbilityId ?? owner.activeAbilityId },
    );
  }
  if (isActiveZone(target)) {
    const scaled = Math.max(1, Math.trunc((amount * getOutgoingDamageBasisPoints(owner)) / 10_000));
    const applied = Math.min(target.hp, scaled);
    target.hp -= applied;
    events.push({
      type: 'active-world-damaged',
      tick: state.tick,
      sourceEntityId: owner.entityId,
      targetEntityId: target.entityId,
      activeAbilityId: options.activeAbilityId ?? target.activeId,
      amount: applied,
      remainingHp: target.hp,
    });
    return applied;
  }
  return applyMonsterDamage(state, events, owner.entityId, target, amount, owner.element, {
    ignoreElement: options.ignoreElement === true,
    activeAbilityId: options.activeAbilityId ?? owner.activeAbilityId,
  });
}

export function healActiveTarget(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: ActiveTarget,
  activeAbilityId: PlayerEntity['activeAbilityId'],
  amount: number,
): number {
  if (amount <= 0 || isActiveZone(target)) {
    return 0;
  }
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const applied = target.hp - before;
  if (applied > 0) {
    events.push({
      type: 'active-heal',
      tick: state.tick,
      sourceEntityId: owner.entityId,
      targetEntityId: target.entityId,
      activeAbilityId,
      amount: applied,
      remainingHp: target.hp,
    });
  }
  return applied;
}

export function applyActiveSlow(
  target: ActiveTarget,
  slowPercent: number,
  durationTicks: number,
): boolean {
  if (slowPercent <= 0 || durationTicks <= 0 || isActiveSummon(target) || isActiveZone(target)) {
    return false;
  }
  if (isActivePlayer(target)) {
    slowPercent = equipmentAdjustedSlowPercent(target, slowPercent);
    if (slowPercent <= 0) {
      return false;
    }
  } else {
    slowPercent = coreBossAdjustedSlowPercent(target, slowPercent);
  }
  target.slowTicks = Math.max(target.slowTicks, durationTicks);
  target.slowBasisPoints = Math.min(target.slowBasisPoints, (100 - slowPercent) * 100);
  return true;
}

export function applyActiveSlowWithStatus(
  state: MutableSimulationState,
  events: SimEvent[],
  source: PlayerEntity,
  target: ActiveTarget,
  slowPercent: number,
  durationTicks: number,
  activeAbilityId: ActiveId = source.activeAbilityId,
): boolean {
  const applied = applyActiveSlow(target, slowPercent, durationTicks);
  if (applied) {
    setActiveStatusEffect(state, events, source, target, 'slow', durationTicks, activeAbilityId);
  }
  return applied;
}

export function applyActiveHardControl(
  state: MutableSimulationState,
  events: SimEvent[],
  target: ActiveTarget,
  durationTicks: number,
  source?: PlayerEntity,
  kind: HardControlKind = 'stun',
  activeAbilityId?: ActiveId,
): boolean {
  if (durationTicks <= 0 || isActiveSummon(target) || isActiveZone(target)) {
    return false;
  }
  const adjustedDuration = source
    ? equipmentHardControlTicks(source, durationTicks)
    : durationTicks;
  if (isActivePlayer(target)) {
    const applied = applyHardControl(target, adjustedDuration, state, events, kind);
    if (applied && source) {
      setActiveStatusEffect(
        state,
        events,
        source,
        target,
        kind,
        adjustedDuration,
        activeAbilityId ?? source.activeAbilityId,
      );
    }
    return applied;
  } else {
    const multiplier =
      target.kind === 'core-boss'
        ? 0
        : target.kind === 'dragon-king'
          ? 0.5
          : target.kind === 'elite-tank' || target.kind === 'elite-ranged'
            ? 0.7
            : 1;
    const effectiveDuration = coreBossAdjustedHardControlTicks(
      target,
      Math.trunc(adjustedDuration * multiplier),
    );
    target.hardControlTicks = Math.max(target.hardControlTicks, effectiveDuration);
    if (effectiveDuration > 0 && source) {
      setActiveStatusEffect(
        state,
        events,
        source,
        target,
        kind,
        effectiveDuration,
        activeAbilityId ?? source.activeAbilityId,
      );
    }
    return effectiveDuration > 0;
  }
}

export function applyActiveSilence(
  target: ActiveTarget,
  durationTicks: number,
): boolean {
  if (durationTicks <= 0 || isActiveSummon(target) || isActiveZone(target)) {
    return false;
  }
  target.silenceTicks = Math.max(target.silenceTicks, durationTicks);
  return true;
}

export function applyActiveSilenceWithStatus(
  state: MutableSimulationState,
  events: SimEvent[],
  source: PlayerEntity,
  target: ActiveTarget,
  durationTicks: number,
  activeAbilityId: ActiveId = source.activeAbilityId,
): boolean {
  const applied = applyActiveSilence(target, durationTicks);
  if (applied) {
    setActiveStatusEffect(
      state,
      events,
      source,
      target,
      'silence',
      durationTicks,
      activeAbilityId,
    );
  }
  return applied;
}

export function applyActiveRoot(
  state: MutableSimulationState,
  events: SimEvent[],
  target: ActiveTarget,
  durationTicks: number,
  source?: PlayerEntity,
  activeAbilityId?: ActiveId,
): boolean {
  if (durationTicks <= 0 || isActiveSummon(target) || isActiveZone(target)) {
    return false;
  }
  if (!isActivePlayer(target) && target.kind === 'core-boss') {
    return false;
  }
  const sourceDuration = source ? equipmentHardControlTicks(source, durationTicks) : durationTicks;
  if (isActivePlayer(target)) {
    if (hasB20ControlImmunity(target)) {
      return false;
    }
    const effectiveDuration = equipmentAdjustedHardControlTicks(target, sourceDuration, 'root');
    target.displacementLockTicks = Math.max(target.displacementLockTicks, effectiveDuration);
    target.slowTicks = Math.max(target.slowTicks, effectiveDuration);
    target.slowBasisPoints = 0;
    if (effectiveDuration > 0 && source) {
      setActiveStatusEffect(
        state,
        events,
        source,
        target,
        'root',
        effectiveDuration,
        activeAbilityId ?? source.activeAbilityId,
      );
    }
    interruptAirdropChannel(state, events, target.entityId, 'hard-control');
    return effectiveDuration > 0;
  }
  const multiplier =
    !isActivePlayer(target) && !isActiveSummon(target) && target.kind === 'core-boss'
      ? 0
      : !isActivePlayer(target) && !isActiveSummon(target) && target.kind === 'dragon-king'
        ? 0.5
        : 1;
  const effectiveDuration = Math.trunc(sourceDuration * multiplier);
  target.displacementLockTicks = Math.max(target.displacementLockTicks, effectiveDuration);
  target.slowTicks = Math.max(target.slowTicks, effectiveDuration);
  target.slowBasisPoints = 0;
  if (effectiveDuration > 0 && source) {
    setActiveStatusEffect(
      state,
      events,
      source,
      target,
      'root',
      effectiveDuration,
      activeAbilityId ?? source.activeAbilityId,
    );
  }
  return effectiveDuration > 0;
}

export function applyPolymorph(
  state: MutableSimulationState,
  events: SimEvent[],
  target: ActiveTarget,
  durationTicks: number,
  speedBonusPercent: number,
  source?: PlayerEntity,
  activeAbilityId?: ActiveId,
): boolean {
  if (durationTicks <= 0 || isActiveSummon(target) || isActiveZone(target)) {
    return false;
  }
  if (!isActivePlayer(target) && target.kind === 'core-boss') {
    return false;
  }
  const sourceDuration = source ? equipmentHardControlTicks(source, durationTicks) : durationTicks;
  if (isActivePlayer(target)) {
    if (hasB20ControlImmunity(target)) {
      return false;
    }
    const effectiveDuration = equipmentAdjustedHardControlTicks(
      target,
      sourceDuration,
      'transform',
    );
    target.polymorphTicks = Math.max(target.polymorphTicks, effectiveDuration);
    target.polymorphSpeedBonusPercent = Math.max(
      target.polymorphSpeedBonusPercent,
      speedBonusPercent,
    );
    if (effectiveDuration > 0 && source) {
      setActiveStatusEffect(
        state,
        events,
        source,
        target,
        'polymorph',
        effectiveDuration,
        activeAbilityId ?? source.activeAbilityId,
      );
    }
    interruptAirdropChannel(state, events, target.entityId, 'hard-control');
    return effectiveDuration > 0;
  }
  const multiplier =
    !isActivePlayer(target) && !isActiveSummon(target) && target.kind === 'core-boss'
      ? 0
      : !isActivePlayer(target) && !isActiveSummon(target) && target.kind === 'dragon-king'
        ? 0.5
        : 1;
  target.polymorphTicks = Math.max(target.polymorphTicks, Math.trunc(sourceDuration * multiplier));
  target.polymorphSpeedBonusPercent = Math.max(
    target.polymorphSpeedBonusPercent,
    speedBonusPercent,
  );
  if (Math.trunc(sourceDuration * multiplier) > 0 && source) {
    setActiveStatusEffect(
      state,
      events,
      source,
      target,
      'polymorph',
      Math.trunc(sourceDuration * multiplier),
      activeAbilityId ?? source.activeAbilityId,
    );
  }
  return Math.trunc(sourceDuration * multiplier) > 0;
}

export function activeTargetEffectKey(
  sourceEntityId: EntityId,
  targetEntityId: EntityId,
  kind: ActiveTargetEffectKind,
): string {
  return `${Number(sourceEntityId)}:${Number(targetEntityId)}:${kind}`;
}

export function setActiveTargetEffect(
  state: MutableSimulationState,
  effect: Omit<ActiveTargetEffectState, 'key'>,
): ActiveTargetEffectState {
  const key = activeTargetEffectKey(effect.sourceEntityId, effect.targetEntityId, effect.kind);
  const value: ActiveTargetEffectState = { key, ...effect };
  state.activeTargetEffects.set(key, value);
  return value;
}

export function activeTargetDamageBonusBasisPoints(
  state: MutableSimulationState,
  sourceEntityId: EntityId,
  targetEntityId: EntityId,
): number {
  let percent = 0;
  for (const effect of state.activeTargetEffects.values()) {
    if (
      effect.kind === 'damage-mark' &&
      effect.sourceEntityId === sourceEntityId &&
      effect.targetEntityId === targetEntityId &&
      effect.expiresAtTick > state.tick
    ) {
      percent += effect.targetDamageBonusPercent;
    }
  }
  return 10_000 + percent * 100;
}
