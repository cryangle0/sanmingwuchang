import type { ScriptedActiveDefinition } from '@jwgb/content';
import { distanceSquaredMm, vec2Mm } from '@jwgb/core';
import type {
  ActiveLootReveal,
  ActiveTargetEffectState,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
} from '../types';
import {
  activeTargetEffectKey,
  applyActiveDamage,
  applyActiveHardControl,
  applyActiveSlowWithStatus,
  emitActiveStatusApplied,
  expireActiveTargetEffect,
  healActiveTarget,
  scriptedDamageAmount,
  setActiveStatusEffect,
  setActiveTargetEffect,
} from './active-damage';
import { activeDirection, isInsideCone, perpendicular, pointInDirection } from './active-geometry';
import {
  type ActiveTarget,
  activeTargetPosition,
  canSeeActiveTarget,
  isActivePlayer,
  isActiveSummon,
  isActiveZone,
  isHostileActiveTarget,
  selectHostileActiveTarget,
  selectVisiblePlayer,
  sortedActiveTargets,
} from './active-targeting';
import { expireActiveZone, spawnActiveProjectile, spawnActiveZone } from './active-world';
import { detonateTrap } from './active-world-zones';
import { coreBossAdjustedHardControlTicks } from './core-boss-resistance';
import {
  isLegalDisplacementDestination,
  resolvePlayerForcedDisplacement,
  resolveTargetForcedDisplacement,
} from './displacement';
import { transferGold } from './equipment-economy';
import { equipmentAdjustedHardControlTicks, equipmentHardControlTicks } from './equipment-query';
import { hasB20ControlImmunity } from './lethal-protection';
import { applyMonsterDamage } from './monster-damage';
import { spawnScriptedSummons } from './summon';
import { applyHardControl } from './whirlwind';

const NEXT_ATTACK_ARM_TICKS = 2_147_483_647;

function targetForArea(
  state: MutableSimulationState,
  owner: PlayerEntity,
  definition: ScriptedActiveDefinition,
): ActiveTarget | undefined {
  return selectHostileActiveTarget(state, owner, definition.rangeMm ?? Number.MAX_SAFE_INTEGER);
}

function areaCenter(
  state: MutableSimulationState,
  owner: PlayerEntity,
  definition: ScriptedActiveDefinition,
): ReturnType<typeof activeTargetPosition> {
  const target = targetForArea(state, owner, definition);
  if (target) {
    return activeTargetPosition(target);
  }
  return pointInDirection(owner.position, activeDirection(owner), definition.rangeMm ?? 0);
}

function directionToward(
  owner: PlayerEntity,
  target: ActiveTarget,
): ReturnType<typeof activeDirection> {
  const position = activeTargetPosition(target);
  const dx = position.x - owner.position.x;
  const dz = position.z - owner.position.z;
  const length = Math.max(1, Math.trunc(Math.sqrt(dx * dx + dz * dz)));
  return vec2Mm(Math.trunc((dx * 1_000) / length), Math.trunc((dz * 1_000) / length));
}

function targetActors(
  state: MutableSimulationState,
  owner: PlayerEntity,
  center: { x: number; z: number },
  radiusMm: number,
  includeOwner = false,
): ActiveTarget[] {
  return sortedActiveTargets(state).filter((target) => {
    if (isActiveZone(target)) {
      return false;
    }
    if (!includeOwner && target.entityId === owner.entityId) {
      return false;
    }
    if (isActiveSummon(target) && target.ownerEntityId === owner.entityId) {
      return false;
    }
    if (isActivePlayer(target) && target.lifeState !== 'alive') {
      return false;
    }
    if (
      !isActivePlayer(target) &&
      isActiveSummon(target) &&
      (!target.targetable || target.hp <= 0)
    ) {
      return false;
    }
    if (
      !isActivePlayer(target) &&
      !isActiveSummon(target) &&
      (target.hp <= 0 || target.invulnerableTicks > 0)
    ) {
      return false;
    }
    return distanceSquaredMm(activeTargetPosition(target), center) <= radiusMm * radiusMm;
  });
}

function damageAndControl(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: ActiveTarget,
  definition: ScriptedActiveDefinition,
): number {
  const applied = applyActiveDamage(
    state,
    events,
    owner,
    target,
    scriptedDamageAmount(owner, definition),
    { activeAbilityId: definition.id },
  );
  if (applied > 0) {
    applyActiveHardControl(
      state,
      events,
      target,
      definition.hardControlTicks ?? 0,
      owner,
      'stun',
      definition.id,
    );
  }
  return applied;
}

function setPetrify(
  state: MutableSimulationState,
  events: SimEvent[],
  target: ActiveTarget,
  durationTicks: number,
  source: PlayerEntity,
  activeAbilityId: PlayerEntity['activeAbilityId'],
): boolean {
  if (isActiveZone(target) || isActiveSummon(target)) {
    return false;
  }
  if (!isActivePlayer(target) && target.kind === 'core-boss') {
    return false;
  }
  const adjustedDuration = equipmentHardControlTicks(source, durationTicks);
  if (isActivePlayer(target)) {
    if (hasB20ControlImmunity(target)) {
      return false;
    }
    const effectiveDuration = equipmentAdjustedHardControlTicks(
      target,
      adjustedDuration,
      'petrify',
    );
    if (!applyHardControl(target, adjustedDuration, state, events, 'petrify')) {
      return false;
    }
    target.invulnerableTicks = Math.max(target.invulnerableTicks, effectiveDuration);
    setActiveStatusEffect(
      state,
      events,
      source,
      target,
      'petrify',
      effectiveDuration,
      activeAbilityId,
    );
    return true;
  } else {
    const effectiveDuration = coreBossAdjustedHardControlTicks(target, adjustedDuration);
    target.invulnerableTicks = Math.max(target.invulnerableTicks, effectiveDuration);
    target.hardControlTicks = Math.max(target.hardControlTicks, effectiveDuration);
    if (effectiveDuration > 0) {
      setActiveStatusEffect(
        state,
        events,
        source,
        target,
        'petrify',
        effectiveDuration,
        activeAbilityId,
      );
    }
    return effectiveDuration > 0;
  }
}

function pushTarget(
  state: MutableSimulationState,
  events: SimEvent[],
  target: ActiveTarget,
  origin: { x: number; z: number },
  distanceMm: number,
): void {
  if (isActiveZone(target)) {
    return;
  }
  const current = activeTargetPosition(target);
  const deltaX = current.x - origin.x;
  const deltaZ = current.z - origin.z;
  const rawLength = Math.trunc(Math.sqrt(deltaX * deltaX + deltaZ * deltaZ));
  const length = Math.max(1, rawLength);
  const direction =
    rawLength === 0
      ? vec2Mm(0, 1_000)
      : vec2Mm(Math.trunc((deltaX * 1_000) / length), Math.trunc((deltaZ * 1_000) / length));
  const requested = vec2Mm(
    current.x + Math.trunc((direction.x * distanceMm) / 1_000),
    current.z + Math.trunc((direction.z * distanceMm) / 1_000),
  );
  const resolved = resolveTargetForcedDisplacement(
    state,
    events,
    isActivePlayer(target) ? target : target,
    current,
    requested,
    isActivePlayer(target) ? 450 : isActiveSummon(target) ? 600 : target.collisionRadiusMm,
  );
  target.position = resolved;
}

function targetById(
  state: MutableSimulationState,
  targetEntityId: number | null,
): ActiveTarget | undefined {
  if (targetEntityId === null) {
    return undefined;
  }
  return sortedActiveTargets(state).find(
    (candidate) => Number(candidate.entityId) === targetEntityId,
  );
}

function isSwapEligibleTarget(target: ActiveTarget): boolean {
  return (
    !isActiveZone(target) &&
    !(isActiveSummon(target) && !target.targetable) &&
    !(!isActivePlayer(target) && !isActiveSummon(target) && target.kind === 'core-boss')
  );
}

function lineHitTargets(
  state: MutableSimulationState,
  owner: PlayerEntity,
  start: { x: number; z: number },
  end: { x: number; z: number },
  radiusMm: number,
): ActiveTarget[] {
  const length = Math.max(1, Math.trunc(Math.sqrt(distanceSquaredMm(start, end))));
  return targetActors(state, owner, end, Number.MAX_SAFE_INTEGER)
    .filter((target) => {
      const position = activeTargetPosition(target);
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      const projection = Math.max(
        0,
        Math.min(lengthSquared, (position.x - start.x) * dx + (position.z - start.z) * dz),
      );
      const closest = vec2Mm(
        start.x + Math.trunc((dx * projection) / Math.max(1, lengthSquared)),
        start.z + Math.trunc((dz * projection) / Math.max(1, lengthSquared)),
      );
      return (
        distanceSquaredMm(position, closest) <=
        (radiusMm + (isActivePlayer(target) ? 450 : 600)) ** 2
      );
    })
    .sort((left, right) => {
      const leftDistance = distanceSquaredMm(start, activeTargetPosition(left));
      const rightDistance = distanceSquaredMm(start, activeTargetPosition(right));
      return leftDistance - rightDistance || Number(left.entityId) - Number(right.entityId);
    })
    .slice(0, Math.max(1, Math.ceil(length / Math.max(1, radiusMm))));
}

function createTargetEffect(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  target: ActiveTarget,
  definition: ScriptedActiveDefinition,
  kind: ActiveTargetEffectState['kind'],
  values: Partial<ActiveTargetEffectState> = {},
): ActiveTargetEffectState | undefined {
  if (isActiveZone(target)) {
    return undefined;
  }
  const key = activeTargetEffectKey(owner.entityId, target.entityId, kind);
  const previous = state.activeTargetEffects.get(key);
  const effect = setActiveTargetEffect(state, {
    sourceEntityId: owner.entityId,
    targetEntityId: target.entityId,
    activeId: definition.id,
    kind,
    stacks: values.stacks ?? 1,
    maximumStacks: values.maximumStacks ?? definition.maximumStacks ?? 1,
    fixedDamage: values.fixedDamage ?? definition.fixedDamage ?? 0,
    attackCoefficientBasisPoints: values.attackCoefficientBasisPoints ?? 0,
    percentDamage: values.percentDamage ?? 0,
    targetDamageBonusPercent: values.targetDamageBonusPercent ?? 0,
    revealToSource: values.revealToSource ?? false,
    expiresAtTick: values.expiresAtTick ?? state.tick + (definition.durationTicks ?? 1),
    nextPulseTick:
      values.nextPulseTick ?? state.tick + Math.max(1, definition.pulseIntervalTicks ?? 20),
    pulseIntervalTicks: values.pulseIntervalTicks ?? definition.pulseIntervalTicks ?? 20,
  });
  if (!previous || previous.activeId !== definition.id || previous.expiresAtTick <= state.tick) {
    emitActiveStatusApplied(
      state,
      events,
      owner,
      target,
      kind,
      Math.max(1, effect.expiresAtTick - state.tick),
      definition.id,
    );
  }
  return effect;
}

function castRewind(
  state: MutableSimulationState,
  owner: PlayerEntity,
  definition: ScriptedActiveDefinition,
): boolean {
  const targetTick = state.tick - (definition.durationTicks ?? 100);
  const frames = state.playerHistoryFrames
    .filter((frame) => frame.entityId === owner.entityId && frame.tick <= targetTick)
    .sort((left, right) => right.tick - left.tick);
  const frame = frames[0];
  if (!frame) {
    return false;
  }
  owner.hp = Math.max(owner.hp, Math.min(owner.maxHp, frame.hp));
  if (!isLegalDisplacementDestination(state, frame.position, 450)) {
    return false;
  }
  owner.position = frame.position;
  return true;
}

export function detonateOwnedTraps(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
): boolean {
  const traps = [...state.activeZones.values()].filter(
    (zone) => zone.ownerEntityId === owner.entityId && zone.kind === 'trap',
  );
  if (traps.length === 0) {
    return false;
  }
  for (const trap of traps) {
    detonateTrap(state, events, owner, trap, false);
  }
  return true;
}

export function resolveScriptedActive(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  definition: ScriptedActiveDefinition,
): boolean {
  const direction = activeDirection(owner);
  const range = definition.rangeMm ?? definition.distanceMm ?? 0;
  const center = areaCenter(state, owner, definition);
  const target = targetForArea(state, owner, definition);
  switch (definition.script) {
    case 'fire-wall':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'fire-wall',
        center: pointInDirection(owner.position, direction, Math.trunc(range / 2)),
        direction: perpendicular(direction),
        radiusMm: definition.radiusMm ?? 0,
        lengthMm: definition.lengthMm ?? 0,
        durationTicks: definition.durationTicks ?? 1,
        pulseIntervalTicks: definition.pulseIntervalTicks ?? 1,
        fixedDamage: scriptedDamageAmount(owner, definition),
        burnDamagePerSecond: definition.burnDamagePerSecond ?? 0,
        burnDurationTicks: definition.burnDurationTicks ?? 1,
      });
      return true;
    case 'damage-slow-zone':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'damage-slow',
        center,
        radiusMm: definition.radiusMm ?? 0,
        durationTicks: definition.durationTicks ?? 1,
        pulseIntervalTicks: definition.pulseIntervalTicks ?? 1,
        fixedDamage: scriptedDamageAmount(owner, definition),
        slowPercent: definition.slowPercent,
        slowDurationTicks: definition.slowDurationTicks,
      });
      return true;
    case 'venom-burst': {
      if (!target) {
        return false;
      }
      const key = activeTargetEffectKey(owner.entityId, target.entityId, 'venom');
      const previous = state.activeTargetEffects.get(key);
      const passivePoisonStates = [...state.passiveTargetStates.values()].filter(
        (targetState) =>
          targetState.targetEntityId === target.entityId && targetState.poisonStacks > 0,
      );
      const passiveStacks = passivePoisonStates.reduce(
        (total, targetState) => total + targetState.poisonStacks,
        0,
      );
      const totalStacks = Math.min(
        definition.maximumStacks ?? 10,
        (previous?.stacks ?? 0) + passiveStacks,
      );
      if (totalStacks > 0) {
        if (previous) {
          expireActiveTargetEffect(state, events, previous);
        }
        for (const targetState of passivePoisonStates) {
          targetState.poisonStacks = 0;
          targetState.poisonExpiresAtTick = 0;
          targetState.poisonNextTick = 0;
        }
        applyActiveDamage(
          state,
          events,
          owner,
          target,
          Math.max(
            1,
            Math.trunc(
              (activeTargetMaxHpFor(target) * (definition.percentDamage ?? 0) * totalStacks) / 100,
            ),
          ),
          { form: 'percent', activeAbilityId: definition.id },
        );
      } else {
        createTargetEffect(state, events, owner, target, definition, 'venom', {
          fixedDamage: definition.fixedDamage ?? 0,
          maximumStacks: definition.maximumStacks ?? 1,
          stacks: 3,
          nextPulseTick: state.tick + (definition.pulseIntervalTicks ?? 20),
        } as Partial<ActiveTargetEffectState>);
      }
      return true;
    }
    case 'petrify-target':
      if (!target) return false;
      setPetrify(
        state,
        events,
        target,
        definition.durationTicks ?? 1,
        owner,
        definition.id,
      );
      return true;
    case 'spreading-poison-zone':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'spreading-poison',
        center,
        radiusMm: definition.radiusMm ?? 0,
        durationTicks: definition.durationTicks ?? 1,
        pulseIntervalTicks: definition.pulseIntervalTicks ?? 1,
        fixedDamage: scriptedDamageAmount(owner, definition),
      });
      return true;
    case 'delayed-area-strike':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'delayed-strike',
        center,
        radiusMm: definition.radiusMm ?? 0,
        delayTicks: definition.delayTicks ?? 0,
        durationTicks: 1,
        pulseIntervalTicks: 1,
        fixedDamage: scriptedDamageAmount(owner, definition),
        slowPercent: definition.slowPercent ?? 0,
        slowDurationTicks: definition.slowDurationTicks ?? 0,
      });
      return true;
    case 'delayed-target-strike':
      if (!target) {
        return false;
      }
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'delayed-target-strike',
        center: activeTargetPosition(target),
        targetEntityId: target.entityId,
        delayTicks: definition.delayTicks ?? 1,
        durationTicks: 1,
        pulseIntervalTicks: 1,
        fixedDamage: scriptedDamageAmount(owner, definition),
        hardControlTicks: definition.hardControlTicks ?? 0,
      });
      return true;
    case 'arm-next-basic':
      owner.armedCriticalTicks = definition.durationTicks ?? NEXT_ATTACK_ARM_TICKS;
      owner.armedMissingHpDamagePercent = definition.missingHpDamagePercent ?? 0;
      owner.armedActiveId = definition.id;
      setActiveStatusEffect(
        state,
        events,
        owner,
        owner,
        'armed-critical',
        definition.durationTicks ?? NEXT_ATTACK_ARM_TICKS,
        definition.id,
      );
      return true;
    case 'dash-first-target': {
      const destination = pointInDirection(owner.position, direction, definition.distanceMm ?? 0);
      const hits = lineHitTargets(
        state,
        owner,
        owner.position,
        destination,
        definition.radiusMm ?? 600,
      );
      const first = hits[0];
      const finalDestination = first
        ? resolvePlayerForcedDisplacement(state, events, owner, activeTargetPosition(first), 450)
        : resolvePlayerForcedDisplacement(state, events, owner, destination, 450);
      owner.position = finalDestination;
      if (first) {
        damageAndControl(state, events, owner, first, definition);
      }
      return true;
    }
    case 'decoy-summon':
      return spawnScriptedSummons(state, events, owner, 'decoy', definition);
    case 'teleport-backstab':
      if (!target) return false;
      {
        const targetFacing =
          isActivePlayer(target) || (!isActiveSummon(target) && !isActiveZone(target))
            ? target.facing
            : direction;
        owner.position = resolvePlayerForcedDisplacement(
          state,
          events,
          owner,
          pointInDirection(
            activeTargetPosition(target),
            vec2Mm(-targetFacing.x, -targetFacing.z),
            definition.displacementMm ?? 1_500,
          ),
          450,
        );
      }
      owner.armedCriticalTicks = definition.durationTicks ?? NEXT_ATTACK_ARM_TICKS;
      owner.armedActiveId = definition.id;
      setActiveStatusEffect(
        state,
        events,
        owner,
        owner,
        'armed-critical',
        definition.durationTicks ?? NEXT_ATTACK_ARM_TICKS,
        definition.id,
      );
      return true;
    case 'blink-decoy-bomb': {
      const oldPosition = owner.position;
      owner.position = resolvePlayerForcedDisplacement(
        state,
        events,
        owner,
        pointInDirection(owner.position, direction, definition.distanceMm ?? 0),
        450,
      );
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'decoy-bomb',
        center: oldPosition,
        delayTicks: definition.delayTicks,
        durationTicks: 1,
        pulseIntervalTicks: 1,
        radiusMm: definition.radiusMm ?? 0,
        fixedDamage: scriptedDamageAmount(owner, definition),
      });
      return true;
    }
    case 'cone-damage-slow':
      for (const candidate of targetActors(state, owner, owner.position, definition.rangeMm ?? 0)) {
        if (
          isInsideCone(
            activeTargetPosition(candidate),
            owner.position,
            direction,
            definition.rangeMm ?? 0,
          )
        ) {
          applyActiveDamage(
            state,
            events,
            owner,
            candidate,
            scriptedDamageAmount(owner, definition),
            { activeAbilityId: definition.id },
          );
          applyActiveSlowWithStatus(
            state,
            events,
            owner,
            candidate,
            definition.slowPercent ?? 0,
            definition.slowDurationTicks ?? 0,
            definition.id,
          );
        }
      }
      return true;
    case 'line-dash': {
      const destination = pointInDirection(owner.position, direction, definition.distanceMm ?? 0);
      const hits = lineHitTargets(
        state,
        owner,
        owner.position,
        destination,
        definition.radiusMm ?? 600,
      );
      for (const candidate of hits) {
        applyActiveDamage(state, events, owner, candidate, scriptedDamageAmount(owner, definition), {
          activeAbilityId: definition.id,
        });
        pushTarget(state, events, candidate, owner.position, definition.displacementMm ?? 0);
      }
      owner.position = resolvePlayerForcedDisplacement(state, events, owner, destination, 450);
      return true;
    }
    case 'radial-knockback':
      for (const candidate of targetActors(
        state,
        owner,
        owner.position,
        definition.radiusMm ?? 0,
      )) {
        applyActiveDamage(state, events, owner, candidate, scriptedDamageAmount(owner, definition), {
          activeAbilityId: definition.id,
        });
        const candidatePosition = activeTargetPosition(candidate);
        const candidateDistance = Math.trunc(
          Math.sqrt(distanceSquaredMm(candidatePosition, owner.position)),
        );
        pushTarget(
          state,
          events,
          candidate,
          owner.position,
          Math.max(0, (definition.radiusMm ?? candidateDistance) - candidateDistance),
        );
        applyActiveHardControl(
          state,
          events,
          candidate,
          definition.hardControlTicks ?? 0,
          owner,
          'stun',
          definition.id,
        );
      }
      return true;
    case 'delayed-silence-zone':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'silence',
        center,
        radiusMm: definition.radiusMm,
        delayTicks: definition.delayTicks ?? 0,
        durationTicks: definition.durationTicks ?? 1,
        pulseIntervalTicks: definition.pulseIntervalTicks ?? 1,
        hardControlTicks: definition.hardControlTicks ?? 0,
      });
      return true;
    case 'combat-summon':
      return spawnScriptedSummons(state, events, owner, 'stone-arhat', definition);
    case 'area-pull':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'area-pull',
        center: owner.position,
        radiusMm: definition.radiusMm ?? 0,
        delayTicks: definition.delayTicks ?? 0,
        durationTicks: 1,
        pulseIntervalTicks: 1,
        fixedDamage: scriptedDamageAmount(owner, definition),
        displacementMm: definition.displacementMm ?? 0,
      });
      return true;
    case 'gold-true-damage':
      if (!target) return false;
      {
        const requested = Math.trunc((owner.gold * (definition.goldPercent ?? 0)) / 100);
        const minimum = definition.minimumGoldAmount ?? 0;
        const spent = Math.min(
          owner.gold,
          definition.maximumGoldAmount ?? owner.gold,
          Math.max(minimum, requested),
        );
        if (spent <= 0) return false;
        owner.gold -= spent;
        applyActiveDamage(
          state,
          events,
          owner,
          target,
          Math.max(1, Math.trunc((spent * (definition.damagePercent ?? 0)) / 100)),
          {
            form: 'true',
            ignoreElement: true,
            activeAbilityId: definition.id,
          },
        );
      }
      return true;
    case 'target-dot-reveal':
      if (!target) return false;
      createTargetEffect(state, events, owner, target, definition, 'damage-over-time', {
        fixedDamage: scriptedDamageAmount(owner, definition),
        revealToSource: true,
      });
      return true;
    case 'line-projectile':
      spawnActiveProjectile(state, events, owner, {
        activeId: definition.id,
        kind: 'line-damage',
        direction,
        speedMmPerSecond: definition.projectileSpeedMmPerSecond ?? 50_000,
        collisionRadiusMm: definition.collisionRadiusMm ?? 180,
        fixedDamage: scriptedDamageAmount(owner, definition),
        damagePerDistanceBasisPoints: definition.damagePerDistanceBasisPoints,
        maximumDistanceBonusPercent: definition.maximumDistanceBonusPercent,
        rangeMm: definition.rangeMm ?? 80_000,
      });
      return true;
    case 'lifesteal-aura':
      owner.activeLifestealTicks = definition.durationTicks ?? 1;
      owner.activeLifestealPercent = definition.lifestealPercent ?? 0;
      setActiveStatusEffect(
        state,
        events,
        owner,
        owner,
        'lifesteal',
        definition.durationTicks ?? 1,
        definition.id,
      );
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'lifesteal-aura',
        center: owner.position,
        radiusMm: definition.radiusMm,
        durationTicks: definition.durationTicks,
        pulseIntervalTicks: definition.pulseIntervalTicks,
        fixedDamage: scriptedDamageAmount(owner, definition),
        lifestealPercent: definition.lifestealPercent,
        followsOwner: true,
      });
      return true;
    case 'target-damage-stun':
      if (!target) return false;
      damageAndControl(state, events, owner, target, definition);
      return true;
    case 'target-heal': {
      const healTarget = selectVisiblePlayer(state, owner, definition.rangeMm ?? 0, true);
      if (!healTarget) return false;
      healActiveTarget(
        state,
        events,
        owner,
        healTarget,
        definition.id,
        (definition.healAmount ?? 0) +
          Math.trunc((owner.attackPower * (definition.attackCoefficientBasisPoints ?? 0)) / 10_000),
      );
      return true;
    }
    case 'damage-mark':
      if (!target) return false;
      createTargetEffect(state, events, owner, target, definition, 'damage-mark', {
        targetDamageBonusPercent: definition.targetDamageBonusPercent ?? 0,
        fixedDamage: 0,
        pulseIntervalTicks: 0,
      });
      return true;
    case 'healing-zone':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'healing',
        center,
        radiusMm: definition.radiusMm,
        durationTicks: definition.durationTicks,
        pulseIntervalTicks: definition.pulseIntervalTicks,
        healAmount: definition.healAmount,
      });
      return true;
    case 'ring-wall':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'ring-wall',
        center,
        radiusMm: definition.radiusMm,
        lengthMm: definition.lengthMm,
        durationTicks: definition.durationTicks,
      });
      return true;
    case 'mobile-invulnerability':
      owner.invulnerableTicks = Math.max(owner.invulnerableTicks, definition.durationTicks ?? 1);
      owner.worldInteractionLockTicks = Math.max(
        owner.worldInteractionLockTicks,
        definition.durationTicks ?? 1,
      );
      setActiveStatusEffect(
        state,
        events,
        owner,
        owner,
        'invulnerability',
        definition.durationTicks ?? 1,
        definition.id,
      );
      return true;
    case 'displacement-lock-zone':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'displacement-lock',
        center,
        radiusMm: definition.radiusMm,
        durationTicks: definition.durationTicks,
        pulseIntervalTicks: definition.pulseIntervalTicks,
        fixedDamage: scriptedDamageAmount(owner, definition),
        slowPercent: definition.slowPercent,
        slowDurationTicks: definition.slowDurationTicks,
      });
      return true;
    case 'damage-reduction-speed':
      owner.activeDamageReductionTicks = definition.durationTicks ?? 1;
      owner.activeDamageReductionBasisPoints = definition.damageReductionBasisPoints ?? 10_000;
      owner.activeSpeedBonusTicks = definition.durationTicks ?? 1;
      owner.activeSpeedBonusPercent = definition.speedBonusPercent ?? 0;
      setActiveStatusEffect(
        state,
        events,
        owner,
        owner,
        'damage-reduction',
        definition.durationTicks ?? 1,
        definition.id,
      );
      return true;
    case 'root-projectile':
      spawnActiveProjectile(state, events, owner, {
        activeId: definition.id,
        kind: 'root',
        direction,
        speedMmPerSecond: definition.projectileSpeedMmPerSecond ?? 45_000,
        collisionRadiusMm: definition.collisionRadiusMm ?? 180,
        fixedDamage: 0,
        rootTicks: definition.rootTicks,
        rangeMm: definition.rangeMm ?? 30_000,
      });
      return true;
    case 'ice-wall':
      for (const old of [...state.activeZones.values()]) {
        if (old.ownerEntityId === owner.entityId && old.kind === 'ice-wall') {
          expireActiveZone(state, events, old);
        }
      }
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'ice-wall',
        center: pointInDirection(
          owner.position,
          direction,
          Math.trunc((definition.rangeMm ?? 0) / 2),
        ),
        direction: perpendicular(direction),
        radiusMm: definition.radiusMm,
        lengthMm: definition.lengthMm,
        durationTicks: definition.durationTicks,
        hp: definition.wallHp,
        targetable: true,
      });
      return true;
    case 'self-or-target-petrify':
      if (owner.intent.targetEntityId === owner.entityId || !target) {
        setPetrify(
          state,
          events,
          owner,
          definition.durationTicks ?? 1,
          owner,
          definition.id,
        );
      } else {
        setPetrify(
          state,
          events,
          target,
          definition.durationTicks ?? 1,
          owner,
          definition.id,
        );
      }
      return true;
    case 'smoke-zone':
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'smoke',
        center,
        radiusMm: definition.radiusMm,
        durationTicks: definition.durationTicks,
      });
      return true;
    case 'hook':
      if (!target || isActiveZone(target)) return false;
      spawnActiveProjectile(state, events, owner, {
        activeId: definition.id,
        kind: 'hook',
        direction: directionToward(owner, target),
        speedMmPerSecond: definition.projectileSpeedMmPerSecond ?? 60_000,
        collisionRadiusMm: definition.collisionRadiusMm ?? 180,
        fixedDamage: scriptedDamageAmount(owner, definition),
        displacementMm: definition.displacementMm ?? 0,
        triggerHardControlTicks: definition.triggerHardControlTicks ?? 0,
        rangeMm: definition.rangeMm ?? 80_000,
        targetEntityId: target.entityId,
      });
      return true;
    case 'polymorph':
      if (!target) return false;
      spawnActiveProjectile(state, events, owner, {
        activeId: definition.id,
        kind: 'polymorph',
        direction: directionToward(owner, target),
        speedMmPerSecond: definition.projectileSpeedMmPerSecond ?? 60_000,
        collisionRadiusMm: definition.collisionRadiusMm ?? 180,
        fixedDamage: 0,
        effectDurationTicks: definition.durationTicks ?? 1,
        effectSpeedBonusPercent: definition.speedBonusPercent ?? 0,
        rangeMm: definition.rangeMm ?? 45_000,
        targetEntityId: target.entityId,
      });
      return true;
    case 'stealth':
      owner.stealthTicks = definition.durationTicks ?? 1;
      owner.activeSpeedBonusTicks = definition.durationTicks ?? 1;
      owner.activeSpeedBonusPercent = definition.speedBonusPercent ?? 0;
      setActiveStatusEffect(
        state,
        events,
        owner,
        owner,
        'stealth',
        definition.durationTicks ?? 1,
        definition.id,
      );
      return true;
    case 'chain-lightning': {
      if (!target) return false;
      const hit = new Set<number>();
      let current: ActiveTarget | undefined = target;
      let damage = scriptedDamageAmount(owner, definition);
      for (let index = 0; current && index < (definition.maximumTargets ?? 1); index += 1) {
        const currentTarget: ActiveTarget = current;
        hit.add(Number(currentTarget.entityId));
        applyActiveDamage(state, events, owner, currentTarget, Math.max(1, damage), {
          activeAbilityId: definition.id,
        });
        const next: ActiveTarget | undefined = sortedActiveTargets(state)
          .filter(
            (candidate) =>
              !hit.has(Number(candidate.entityId)) &&
              isHostileActiveTarget(state, owner, candidate, Number.MAX_SAFE_INTEGER) &&
              distanceSquaredMm(
                activeTargetPosition(candidate),
                activeTargetPosition(currentTarget),
              ) <=
                (definition.radiusMm ?? 0) ** 2,
          )
          .sort(
            (left, right) =>
              distanceSquaredMm(activeTargetPosition(currentTarget), activeTargetPosition(left)) -
                distanceSquaredMm(
                  activeTargetPosition(currentTarget),
                  activeTargetPosition(right),
                ) || Number(left.entityId) - Number(right.entityId),
          )[0];
        current = next;
        damage = Math.trunc((damage * (definition.damageDecayBasisPoints ?? 10_000)) / 10_000);
      }
      return true;
    }
    case 'reward-mark':
      if (!target) return false;
      state.bountyMarks.push({
        sourceEntityId: owner.entityId,
        targetEntityId: target.entityId,
        rewardGold: definition.rewardGold ?? 0,
        rewardRecipientEntityId: owner.entityId,
        revealToAll: false,
        expiresAtTick: state.tick + (definition.durationTicks ?? 1),
      });
      return true;
    case 'swap':
      {
        const first =
          owner.intent.targetEntityId === null
            ? owner
            : targetById(state, Number(owner.intent.targetEntityId));
        const second =
          owner.intent.secondaryTargetEntityId === null ||
          owner.intent.secondaryTargetEntityId === undefined
            ? target
            : targetById(state, Number(owner.intent.secondaryTargetEntityId));
        if (!first || !second || first.entityId === second.entityId) {
          return false;
        }
        if (!isSwapEligibleTarget(first) || !isSwapEligibleTarget(second)) {
          return false;
        }
        if (isActiveZone(first) || isActiveZone(second)) {
          return false;
        }
        for (const candidate of [first, second]) {
          if (
            (isActivePlayer(candidate) && candidate.lifeState !== 'alive') ||
            (isActiveSummon(candidate) && candidate.hp <= 0) ||
            (!isActivePlayer(candidate) && !isActiveSummon(candidate) && candidate.hp <= 0) ||
            distanceSquaredMm(owner.position, activeTargetPosition(candidate)) >
              (definition.rangeMm ?? 50_000) ** 2 ||
            (!isActivePlayer(candidate) &&
              !isActiveSummon(candidate) &&
              candidate.invulnerableTicks > 0) ||
            !canSeeActiveTarget(state, owner, candidate)
          ) {
            return false;
          }
        }
        const firstPosition = activeTargetPosition(first);
        const secondPosition = activeTargetPosition(second);
        if (isActivePlayer(first) || isActiveSummon(first)) {
          first.position = secondPosition;
        } else {
          first.position = secondPosition;
        }
        if (isActivePlayer(second) || isActiveSummon(second)) {
          second.position = firstPosition;
        } else {
          second.position = firstPosition;
        }
      }
      return true;
    case 'rewind':
      return castRewind(state, owner, definition);
    case 'active-pickpocket':
      if (!target) return false;
      if (isActivePlayer(target)) {
        const stolen = Math.min(
          target.gold,
          definition.stealFlatGold ?? definition.maximumGoldAmount ?? target.gold,
        );
        if (stolen <= 0) return false;
        transferGold(target, owner, stolen);
        return true;
      }
      if (isActiveSummon(target) || isActiveZone(target)) return false;
      return (
        applyMonsterDamage(state, events, owner.entityId, target, target.maxHp, owner.element, {
          lootGoldMultiplier: definition.lootGoldMultiplier ?? 1,
          activeAbilityId: definition.id,
        }) > 0
      );
    case 'self-bounty': {
      const existingIndex = state.bountyMarks.findIndex(
        (mark) =>
          mark.sourceEntityId === owner.entityId &&
          mark.targetEntityId === owner.entityId &&
          mark.revealToAll,
      );
      if (existingIndex >= 0) {
        state.bountyMarks.splice(existingIndex, 1);
        owner.activeBountyStreak = 0;
        return true;
      }
      owner.activeBountyStreak = 0;
      state.bountyMarks.push({
        sourceEntityId: owner.entityId,
        targetEntityId: owner.entityId,
        rewardGold: 0,
        rewardRecipientEntityId: null,
        revealToAll: true,
        expiresAtTick: Number.MAX_SAFE_INTEGER,
      });
      return true;
    }
    case 'treasure-sense':
      owner.treasureSenseTicks = definition.durationTicks ?? 1;
      for (const [key, reveal] of [...state.activeLootReveals.entries()]) {
        if (reveal.sourceEntityId === owner.entityId) {
          state.activeLootReveals.delete(key);
        }
      }
      for (const drop of state.lootDrops.values()) {
        if (
          drop.equipmentId === null ||
          state.tick - drop.createdAtTick < (definition.minimumLootAgeTicks ?? 0) ||
          distanceSquaredMm(owner.position, drop.position) > (definition.rangeMm ?? 0) ** 2
        ) {
          continue;
        }
        const key = `${Number(owner.entityId)}:${Number(drop.entityId)}`;
        const reveal: ActiveLootReveal = {
          key,
          sourceEntityId: owner.entityId,
          lootEntityId: drop.entityId,
          expiresAtTick: state.tick + (definition.revealTicks ?? definition.durationTicks ?? 1),
        };
        state.activeLootReveals.set(key, reveal);
      }
      return true;
    case 'bean-soldiers':
      return spawnScriptedSummons(state, events, owner, 'bean-soldier', definition);
    case 'trap':
      if (owner.intent.alternateActive === true) {
        return detonateOwnedTraps(state, events, owner);
      }
      {
        const traps = [...state.activeZones.values()]
          .filter((zone) => zone.ownerEntityId === owner.entityId && zone.kind === 'trap')
          .sort(
            (left, right) =>
              left.createdAtTick - right.createdAtTick ||
              Number(left.entityId) - Number(right.entityId),
          );
        const maximumInstances = definition.maximumInstances ?? 3;
        while (traps.length >= maximumInstances) {
          const oldest = traps.shift();
          if (oldest) {
            expireActiveZone(state, events, oldest);
          }
        }
      }
      spawnActiveZone(state, events, owner, {
        activeId: definition.id,
        kind: 'trap',
        center: pointInDirection(owner.position, direction, Math.min(3_500, range || 3_500)),
        radiusMm: definition.radiusMm,
        durationTicks: definition.durationTicks,
        pulseIntervalTicks: 1,
        fixedDamage: scriptedDamageAmount(owner, definition),
        detonationFixedDamage: definition.detonationDamage ?? 0,
        detonationAttackCoefficientBasisPoints:
          definition.detonationAttackCoefficientBasisPoints ?? 0,
        triggerHardControlTicks: definition.triggerHardControlTicks ?? 0,
        triggerRevealTicks: definition.triggerRevealTicks ?? 0,
        triggerRadiusMm: definition.triggerRadiusMm ?? 900,
        hp: definition.wallHp,
        targetable: true,
      });
      return true;
  }
}

function activeTargetMaxHpFor(target: ActiveTarget): number {
  return target.maxHp;
}
