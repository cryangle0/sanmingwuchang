import { distanceSquaredMm, vec2Mm } from '@jwgb/core';
import type { ActiveZoneEntity, MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import {
  activeTargetEffectKey,
  activeTargetMaxHp,
  applyActiveDamage,
  applyActiveHardControl,
  applyActiveSilenceWithStatus,
  applyActiveSlowWithStatus,
  emitActiveStatusApplied,
  expireActiveTargetEffect,
  healActiveTarget,
  setActiveStatusEffect,
  setActiveTargetEffect,
} from './active-damage';
import { isInsideLine } from './active-geometry';
import {
  type ActiveTarget,
  activeTargetPosition,
  isActivePlayer,
  isActiveSummon,
  isActiveZone,
  sortedActiveTargets,
} from './active-targeting';
import { expireActiveZone, spawnActiveZone } from './active-world';
import { resolveTargetForcedDisplacement } from './displacement';
import { effectiveAttackPower } from './passive-runtime';

function livingActorTargets(
  state: MutableSimulationState,
  owner: PlayerEntity,
  includeOwner: boolean,
): ActiveTarget[] {
  return sortedActiveTargets(state).filter((target) => {
    if (isActiveZone(target)) {
      return false;
    }
    if (isActivePlayer(target)) {
      return target.lifeState === 'alive' &&
        (includeOwner || target.entityId !== owner.entityId) &&
        target.entityId !== owner.entityId
        ? true
        : includeOwner && target.entityId === owner.entityId;
    }
    if (isActiveSummon(target)) {
      return target.hp > 0 && target.targetable && target.ownerEntityId !== owner.entityId;
    }
    return target.hp > 0 && target.invulnerableTicks <= 0;
  });
}

function isInsideZone(target: ActiveTarget, zone: ActiveZoneEntity): boolean {
  const position = activeTargetPosition(target);
  if (zone.kind === 'fire-wall' || zone.kind === 'ice-wall') {
    return isInsideLine(position, zone.center, zone.direction, zone.lengthMm, zone.radiusMm + 600);
  }
  if (zone.kind === 'ring-wall') {
    const radius = zone.radiusMm;
    const distance = Math.trunc(Math.sqrt(distanceSquaredMm(position, zone.center)));
    return Math.abs(distance - radius) <= Math.max(600, Math.trunc(zone.lengthMm / 2));
  }
  return distanceSquaredMm(position, zone.center) <= zone.radiusMm * zone.radiusMm;
}

function createDotEffect(
  state: MutableSimulationState,
  events: SimEvent[],
  source: PlayerEntity,
  target: ActiveTarget,
  zone: ActiveZoneEntity,
): void {
  if (isActiveZone(target)) {
    return;
  }
  const key = activeTargetEffectKey(source.entityId, target.entityId, 'damage-over-time');
  const previous = state.activeTargetEffects.get(key);
  if (!previous) {
    emitActiveStatusApplied(
      state,
      events,
      source,
      target,
      'damage-over-time',
      zone.burnDurationTicks,
      zone.activeId,
    );
  }
  setActiveTargetEffect(state, {
    sourceEntityId: source.entityId,
    targetEntityId: target.entityId,
    activeId: zone.activeId,
    kind: 'damage-over-time',
    stacks: 1,
    maximumStacks: 1,
    fixedDamage: Math.max(1, zone.burnDamagePerSecond),
    attackCoefficientBasisPoints: 0,
    percentDamage: 0,
    targetDamageBonusPercent: 0,
    revealToSource: false,
    expiresAtTick: Math.max(previous?.expiresAtTick ?? 0, state.tick + zone.burnDurationTicks),
    nextPulseTick: Math.min(previous?.nextPulseTick ?? state.tick + 20, state.tick + 20),
    pulseIntervalTicks: 20,
  });
}

function applyZoneDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  zone: ActiveZoneEntity,
  target: ActiveTarget,
): number {
  const damage =
    zone.fixedDamage +
    Math.trunc((effectiveAttackPower(owner) * zone.attackCoefficientBasisPoints) / 10_000);
  const applied = applyActiveDamage(state, events, owner, target, damage, {
    form: 'skill',
    periodic: true,
    activeAbilityId: zone.activeId,
  });
  if (applied > 0 && zone.slowPercent > 0) {
    applyActiveSlowWithStatus(
      state,
      events,
      owner,
      target,
      zone.slowPercent,
      zone.slowDurationTicks,
      zone.activeId,
    );
  }
  if (applied > 0 && zone.hardControlTicks > 0) {
    applyActiveHardControl(
      state,
      events,
      target,
      zone.hardControlTicks,
      owner,
      'stun',
      zone.activeId,
    );
  }
  if (applied > 0 && zone.burnDamagePerSecond > 0) {
    createDotEffect(state, events, owner, target, zone);
  }
  return applied;
}

export function detonateTrap(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  zone: ActiveZoneEntity,
  triggered: boolean,
  triggeredTarget?: ActiveTarget,
): void {
  const targets = triggered
    ? triggeredTarget
      ? [triggeredTarget]
      : []
    : livingActorTargets(state, owner, false);
  for (const target of targets) {
    if (
      distanceSquaredMm(activeTargetPosition(target), zone.center) >
      (triggered ? zone.triggerRadiusMm : zone.radiusMm) ** 2
    ) {
      continue;
    }
    const damage = triggered
      ? zone.fixedDamage +
        Math.trunc((effectiveAttackPower(owner) * zone.attackCoefficientBasisPoints) / 10_000)
      : zone.detonationFixedDamage +
        Math.trunc(
          (effectiveAttackPower(owner) * zone.detonationAttackCoefficientBasisPoints) / 10_000,
        );
    const applied = applyActiveDamage(state, events, owner, target, damage, {
      form: 'skill',
      activeAbilityId: zone.activeId,
    });
    if (triggered && applied > 0) {
      applyActiveHardControl(
        state,
        events,
        target,
        zone.triggerHardControlTicks,
        owner,
        'stun',
        zone.activeId,
      );
      if (zone.triggerRevealTicks > 0 && !isActiveZone(target)) {
        emitActiveStatusApplied(
          state,
          events,
          owner,
          target,
          'reveal',
          zone.triggerRevealTicks,
          zone.activeId,
        );
        setActiveTargetEffect(state, {
          sourceEntityId: owner.entityId,
          targetEntityId: target.entityId,
          activeId: zone.activeId,
          kind: 'reveal',
          stacks: 1,
          maximumStacks: 1,
          fixedDamage: 0,
          attackCoefficientBasisPoints: 0,
          percentDamage: 0,
          targetDamageBonusPercent: 0,
          revealToSource: true,
          expiresAtTick: state.tick + zone.triggerRevealTicks,
          nextPulseTick: Number.MAX_SAFE_INTEGER,
          pulseIntervalTicks: 0,
        });
      }
    }
  }
  expireActiveZone(state, events, zone);
}

function targetForZone(
  state: MutableSimulationState,
  targetEntityId: number | null,
): ActiveTarget | undefined {
  if (targetEntityId === null) {
    return undefined;
  }
  return sortedActiveTargets(state).find((target) => Number(target.entityId) === targetEntityId);
}

function pullTargetIntoZone(
  state: MutableSimulationState,
  events: SimEvent[],
  target: ActiveTarget,
  center: { x: number; z: number },
  distanceMm: number,
): void {
  if (isActiveZone(target)) {
    return;
  }
  const position = activeTargetPosition(target);
  const deltaX = center.x - position.x;
  const deltaZ = center.z - position.z;
  const distance = Math.max(1, Math.trunc(Math.sqrt(deltaX * deltaX + deltaZ * deltaZ)));
  const requested = vec2Mm(
    position.x + Math.trunc((deltaX * Math.min(distanceMm, distance)) / distance),
    position.z + Math.trunc((deltaZ * Math.min(distanceMm, distance)) / distance),
  );
  target.position = resolveTargetForcedDisplacement(
    state,
    events,
    target,
    position,
    requested,
    isActivePlayer(target) ? 450 : isActiveSummon(target) ? 600 : target.collisionRadiusMm,
  );
}

function advanceOneZone(
  state: MutableSimulationState,
  events: SimEvent[],
  zone: ActiveZoneEntity,
): void {
  const owner = state.players.get(zone.ownerEntityId);
  if (!owner || zone.expiresAtTick < state.tick) {
    expireActiveZone(state, events, zone);
    return;
  }
  if (zone.kind === 'ice-wall' && zone.hp <= 0) {
    expireActiveZone(state, events, zone);
    return;
  }
  if (state.tick < zone.activatesAtTick) {
    return;
  }
  if (zone.kind === 'trap') {
    const entered = livingActorTargets(state, owner, false).find(
      (target) =>
        distanceSquaredMm(activeTargetPosition(target), zone.center) <=
        zone.triggerRadiusMm * zone.triggerRadiusMm,
    );
    if (entered) {
      detonateTrap(state, events, owner, zone, true, entered);
    }
    return;
  }
  if (zone.kind === 'delayed-target-strike') {
    const target = targetForZone(state, zone.targetEntityId);
    if (target && !isActiveZone(target)) {
      applyZoneDamage(state, events, owner, zone, target);
    }
    expireActiveZone(state, events, zone);
    return;
  }
  if (zone.kind === 'area-pull') {
    const targets = livingActorTargets(state, owner, false).filter((target) =>
      isInsideZone(target, zone),
    );
    for (const target of targets) {
      applyZoneDamage(state, events, owner, zone, target);
      pullTargetIntoZone(state, events, target, zone.center, zone.displacementMm);
    }
    expireActiveZone(state, events, zone);
    return;
  }
  if (
    zone.pulseIntervalTicks <= 0 ||
    state.tick < zone.nextPulseTick ||
    zone.kind === 'ring-wall' ||
    zone.kind === 'ice-wall' ||
    zone.kind === 'smoke'
  ) {
    return;
  }

  const targets = livingActorTargets(state, owner, zone.kind === 'healing');
  if (zone.kind === 'healing') {
    for (const target of targets) {
      if (isInsideZone(target, zone)) {
        healActiveTarget(state, events, owner, target, zone.activeId, zone.healAmount);
      }
    }
  } else {
    for (const target of targets) {
      if (!isInsideZone(target, zone)) {
        continue;
      }
      const applied = applyZoneDamage(state, events, owner, zone, target);
      if (zone.kind === 'lifesteal-aura' && applied > 0) {
        owner.hp = Math.min(
          owner.maxHp,
          owner.hp + Math.trunc((applied * zone.lifestealPercent) / 100),
        );
      }
      if (zone.kind === 'spreading-poison' && zone.generation === 0) {
        const hasChild = [...state.activeZones.values()].some(
          (candidate) =>
            candidate.kind === 'spreading-poison' &&
            candidate.ownerEntityId === owner.entityId &&
            candidate.followTargetEntityId === target.entityId &&
            candidate.generation === 1,
        );
        if (!hasChild) {
          spawnActiveZone(state, events, owner, {
            activeId: zone.activeId,
            kind: 'spreading-poison',
            center: activeTargetPosition(target),
            radiusMm: zone.radiusMm,
            durationTicks: 3 * 20,
            pulseIntervalTicks: zone.pulseIntervalTicks,
            fixedDamage: zone.fixedDamage,
            attackCoefficientBasisPoints: 0,
            followTargetEntityId: target.entityId,
            generation: 1,
          });
        } else {
          for (const child of state.activeZones.values()) {
            if (
              child.kind === 'spreading-poison' &&
              child.ownerEntityId === owner.entityId &&
              child.followTargetEntityId === target.entityId &&
              child.generation === 1
            ) {
              child.expiresAtTick = Math.max(child.expiresAtTick, state.tick + 3 * 20);
            }
          }
        }
      }
    }
  }

  if (zone.kind === 'silence') {
    for (const target of targets) {
      if (isInsideZone(target, zone)) {
        applyActiveSilenceWithStatus(
          state,
          events,
          owner,
          target,
          zone.hardControlTicks,
          zone.activeId,
        );
      }
    }
  }
  if (zone.kind === 'displacement-lock') {
    for (const target of targets) {
      if (isInsideZone(target, zone)) {
        if (isActivePlayer(target) || (!isActiveSummon(target) && !isActiveZone(target))) {
          if (!isActivePlayer(target) && target.kind === 'core-boss') {
            continue;
          }
          target.displacementLockTicks = Math.max(
            target.displacementLockTicks,
            zone.slowDurationTicks,
          );
          setActiveStatusEffect(
            state,
            events,
            owner,
            target,
            'displacement-lock',
            zone.slowDurationTicks,
            zone.activeId,
          );
        }
      }
    }
  }
  zone.nextPulseTick += Math.max(1, zone.pulseIntervalTicks);
  if (zone.expiresAtTick <= state.tick) {
    expireActiveZone(state, events, zone);
  }
}

export function advanceActiveZones(state: MutableSimulationState, events: SimEvent[]): void {
  const zones = [...state.activeZones.values()].sort(
    (left, right) => Number(left.entityId) - Number(right.entityId),
  );
  for (const zone of zones) {
    if (state.activeZones.has(zone.entityId)) {
      advanceOneZone(state, events, zone);
    }
  }
}

function targetForEffect(
  state: MutableSimulationState,
  targetEntityId: number,
): ActiveTarget | undefined {
  return sortedActiveTargets(state).find((target) => Number(target.entityId) === targetEntityId);
}

export function advanceActiveTargetEffects(
  state: MutableSimulationState,
  events: SimEvent[],
): void {
  const effects = [...state.activeTargetEffects.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  for (const effect of effects) {
    if (!state.activeTargetEffects.has(effect.key)) {
      continue;
    }
    if (effect.expiresAtTick < state.tick) {
      expireActiveTargetEffect(state, events, effect);
      continue;
    }
    if (
      effect.nextPulseTick > state.tick ||
      effect.kind === 'damage-mark' ||
      effect.kind === 'reveal'
    ) {
      if (effect.expiresAtTick <= state.tick) {
        expireActiveTargetEffect(state, events, effect);
      }
      continue;
    }
    const source = state.players.get(effect.sourceEntityId);
    const target = targetForEffect(state, Number(effect.targetEntityId));
    if (!source || !target || isActiveZone(target)) {
      expireActiveTargetEffect(state, events, effect);
      continue;
    }
    const amount =
      effect.fixedDamage * Math.max(1, effect.stacks) +
      Math.trunc((activeTargetMaxHp(target) * effect.percentDamage) / 100);
    applyActiveDamage(state, events, source, target, amount, {
      form: effect.percentDamage > 0 ? 'percent' : 'dot',
      periodic: true,
      activeAbilityId: effect.activeId,
    });
    effect.nextPulseTick += Math.max(1, effect.pulseIntervalTicks);
    if (effect.expiresAtTick <= state.tick) {
      expireActiveTargetEffect(state, events, effect);
    }
  }
}
