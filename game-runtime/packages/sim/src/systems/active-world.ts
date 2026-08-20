import type { ActiveId, EntityId, Vec2Mm } from '@jwgb/core';
import { entityId, vec2Mm } from '@jwgb/core';
import type {
  ActiveProjectileEntity,
  ActiveZoneEntity,
  ActiveZoneKind,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
} from '../types';
import { advanceActiveProjectiles } from './active-world-projectiles';
import { advanceActiveTargetEffects, advanceActiveZones } from './active-world-zones';
import { expireActiveTargetEffect } from './active-damage';

export interface ActiveZoneSpawn {
  readonly activeId: ActiveId;
  readonly kind: ActiveZoneKind;
  readonly targetEntityId?: EntityId | null | undefined;
  readonly center: Vec2Mm;
  readonly direction?: Vec2Mm | undefined;
  readonly radiusMm?: number | undefined;
  readonly lengthMm?: number | undefined;
  readonly delayTicks?: number | undefined;
  readonly durationTicks?: number | undefined;
  readonly pulseIntervalTicks?: number | undefined;
  readonly fixedDamage?: number | undefined;
  readonly attackCoefficientBasisPoints?: number | undefined;
  readonly slowPercent?: number | undefined;
  readonly slowDurationTicks?: number | undefined;
  readonly hardControlTicks?: number | undefined;
  readonly displacementMm?: number | undefined;
  readonly healAmount?: number | undefined;
  readonly lifestealPercent?: number | undefined;
  readonly burnDamagePerSecond?: number | undefined;
  readonly burnDurationTicks?: number | undefined;
  readonly detonationFixedDamage?: number | undefined;
  readonly detonationAttackCoefficientBasisPoints?: number | undefined;
  readonly triggerHardControlTicks?: number | undefined;
  readonly triggerRevealTicks?: number | undefined;
  readonly triggerRadiusMm?: number | undefined;
  readonly hp?: number | undefined;
  readonly targetable?: boolean | undefined;
  readonly followsOwner?: boolean | undefined;
  readonly followTargetEntityId?: EntityId | null | undefined;
  readonly generation?: number | undefined;
}

export function spawnActiveZone(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  options: ActiveZoneSpawn,
): ActiveZoneEntity {
  const delayTicks = options.delayTicks ?? 0;
  const durationTicks = options.durationTicks ?? 1;
  const pulseIntervalTicks = options.pulseIntervalTicks ?? 0;
  const zone: ActiveZoneEntity = {
    entityId: entityId(state.nextEntityId),
    ownerEntityId: owner.entityId,
    activeId: options.activeId,
    kind: options.kind,
    targetEntityId: options.targetEntityId ?? null,
    center: vec2Mm(options.center.x, options.center.z),
    direction: options.direction
      ? vec2Mm(options.direction.x, options.direction.z)
      : vec2Mm(0, 1_000),
    radiusMm: options.radiusMm ?? 0,
    lengthMm: options.lengthMm ?? 0,
    createdAtTick: state.tick,
    activatesAtTick: state.tick + delayTicks,
    expiresAtTick: state.tick + delayTicks + Math.max(1, durationTicks),
    nextPulseTick: state.tick + delayTicks + (delayTicks > 0 ? 0 : Math.max(1, pulseIntervalTicks)),
    pulseIntervalTicks,
    fixedDamage: options.fixedDamage ?? 0,
    attackCoefficientBasisPoints: options.attackCoefficientBasisPoints ?? 0,
    slowPercent: options.slowPercent ?? 0,
    slowDurationTicks: options.slowDurationTicks ?? 0,
    hardControlTicks: options.hardControlTicks ?? 0,
    displacementMm: options.displacementMm ?? 0,
    healAmount: options.healAmount ?? 0,
    lifestealPercent: options.lifestealPercent ?? 0,
    burnDamagePerSecond: options.burnDamagePerSecond ?? 0,
    burnDurationTicks: options.burnDurationTicks ?? 0,
    detonationFixedDamage: options.detonationFixedDamage ?? 0,
    detonationAttackCoefficientBasisPoints: options.detonationAttackCoefficientBasisPoints ?? 0,
    triggerHardControlTicks: options.triggerHardControlTicks ?? 0,
    triggerRevealTicks: options.triggerRevealTicks ?? 0,
    triggerRadiusMm: options.triggerRadiusMm ?? 900,
    hp: options.hp ?? 0,
    maxHp: options.hp ?? 0,
    targetable: options.targetable ?? false,
    followsOwner: options.followsOwner ?? false,
    followTargetEntityId: options.followTargetEntityId ?? null,
    generation: options.generation ?? 0,
  };
  state.nextEntityId += 1;
  state.activeZones.set(zone.entityId, zone);
  events.push({
    type: 'active-world-spawned',
    tick: state.tick,
    entityId: zone.entityId,
    ownerEntityId: owner.entityId,
    activeAbilityId: zone.activeId,
    activeWorldKind: zone.kind,
  });
  return zone;
}

export interface ActiveProjectileSpawn {
  readonly activeId: ActiveId;
  readonly kind: ActiveProjectileEntity['kind'];
  readonly direction: Vec2Mm;
  readonly speedMmPerSecond: number;
  readonly collisionRadiusMm: number;
  readonly fixedDamage: number;
  readonly attackCoefficientBasisPoints?: number | undefined;
  readonly rootTicks?: number | undefined;
  readonly rangeMm: number;
  readonly displacementMm?: number | undefined;
  readonly effectDurationTicks?: number | undefined;
  readonly effectSpeedBonusPercent?: number | undefined;
  readonly triggerHardControlTicks?: number | undefined;
  readonly damagePerDistanceBasisPoints?: number | undefined;
  readonly maximumDistanceBonusPercent?: number | undefined;
  readonly targetEntityId?: EntityId | null | undefined;
}

export function spawnActiveProjectile(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  options: ActiveProjectileSpawn,
): ActiveProjectileEntity {
  const projectile: ActiveProjectileEntity = {
    entityId: entityId(state.nextEntityId),
    ownerEntityId: owner.entityId,
    activeId: options.activeId,
    kind: options.kind,
    position: vec2Mm(owner.position.x, owner.position.z),
    direction: vec2Mm(options.direction.x, options.direction.z),
    speedMmPerSecond: options.speedMmPerSecond,
    collisionRadiusMm: options.collisionRadiusMm,
    fixedDamage: options.fixedDamage,
    attackCoefficientBasisPoints: options.attackCoefficientBasisPoints ?? 0,
    rootTicks: options.rootTicks ?? 0,
    displacementMm: options.displacementMm ?? 0,
    effectDurationTicks: options.effectDurationTicks ?? 0,
    effectSpeedBonusPercent: options.effectSpeedBonusPercent ?? 0,
    triggerHardControlTicks: options.triggerHardControlTicks ?? 0,
    damagePerDistanceBasisPoints: options.damagePerDistanceBasisPoints ?? 0,
    maximumDistanceBonusPercent: options.maximumDistanceBonusPercent ?? 0,
    targetEntityId: options.targetEntityId ?? null,
    createdAtTick: state.tick,
    remainingTravelMm: options.rangeMm,
    distanceTravelledMm: 0,
    movementRemainder: 0,
  };
  state.nextEntityId += 1;
  state.activeProjectiles.set(projectile.entityId, projectile);
  events.push({
    type: 'active-world-spawned',
    tick: state.tick,
    entityId: projectile.entityId,
    ownerEntityId: owner.entityId,
    activeAbilityId: projectile.activeId,
    activeWorldKind: projectile.kind,
  });
  return projectile;
}

export function expireActiveZone(
  state: MutableSimulationState,
  events: SimEvent[],
  zone: ActiveZoneEntity,
): void {
  if (!state.activeZones.delete(zone.entityId)) {
    return;
  }
  events.push({
    type: 'active-world-expired',
    tick: state.tick,
    entityId: zone.entityId,
    ownerEntityId: zone.ownerEntityId,
    activeAbilityId: zone.activeId,
    activeWorldKind: zone.kind,
  });
}

export function expireActiveProjectile(
  state: MutableSimulationState,
  events: SimEvent[],
  projectile: ActiveProjectileEntity,
): void {
  if (!state.activeProjectiles.delete(projectile.entityId)) {
    return;
  }
  events.push({
    type: 'active-world-expired',
    tick: state.tick,
    entityId: projectile.entityId,
    ownerEntityId: projectile.ownerEntityId,
    activeAbilityId: projectile.activeId,
    activeWorldKind: projectile.kind,
  });
}

function recordPlayerHistory(state: MutableSimulationState): void {
  const minimumTick = state.tick - 100;
  for (let index = state.playerHistoryFrames.length - 1; index >= 0; index -= 1) {
    const frame = state.playerHistoryFrames[index];
    if (frame && frame.tick < minimumTick) {
      state.playerHistoryFrames.splice(index, 1);
    }
  }
  for (const player of state.players.values()) {
    if (player.lifeState !== 'alive') {
      continue;
    }
    state.playerHistoryFrames.push({
      entityId: player.entityId,
      tick: state.tick,
      position: vec2Mm(player.position.x, player.position.z),
      hp: player.hp,
    });
  }
}

function advanceFollowPositions(state: MutableSimulationState): void {
  for (const zone of state.activeZones.values()) {
    if (zone.followsOwner) {
      const owner = state.players.get(zone.ownerEntityId);
      if (owner) {
        zone.center = vec2Mm(owner.position.x, owner.position.z);
      }
    } else if (zone.followTargetEntityId !== null) {
      const target =
        state.players.get(zone.followTargetEntityId) ??
        state.monsters.get(zone.followTargetEntityId) ??
        state.summons.get(zone.followTargetEntityId);
      if (target) {
        zone.center = vec2Mm(target.position.x, target.position.z);
      }
    }
  }
}

function advanceMonsterActiveTimers(state: MutableSimulationState): void {
  for (const monster of state.monsters.values()) {
    monster.polymorphTicks = Math.max(0, monster.polymorphTicks - 1);
    monster.displacementLockTicks = Math.max(0, monster.displacementLockTicks - 1);
  }
}

export function advanceActiveWorld(state: MutableSimulationState, events: SimEvent[]): void {
  recordPlayerHistory(state);
  advanceMonsterActiveTimers(state);
  advanceFollowPositions(state);
  advanceActiveTargetEffects(state, events);
  advanceActiveZones(state, events);
  advanceActiveProjectiles(state, events);

  for (const player of state.players.values()) {
    const hasSelfBounty = state.bountyMarks.some(
      (mark) =>
        mark.sourceEntityId === player.entityId &&
        mark.targetEntityId === player.entityId &&
        mark.revealToAll &&
        mark.expiresAtTick > state.tick,
    );
    if (!hasSelfBounty) {
      player.activeBountyStreak = 0;
    }
  }
  for (const [key, reveal] of state.activeLootReveals) {
    if (reveal.expiresAtTick <= state.tick || !state.lootDrops.has(reveal.lootEntityId)) {
      state.activeLootReveals.delete(key);
    }
  }
}

export function removeOwnedActiveWorld(
  state: MutableSimulationState,
  events: SimEvent[],
  ownerEntityId: EntityId,
): void {
  for (const zone of [...state.activeZones.values()]) {
    if (zone.ownerEntityId === ownerEntityId) {
      expireActiveZone(state, events, zone);
    }
  }
  for (const projectile of [...state.activeProjectiles.values()]) {
    if (projectile.ownerEntityId === ownerEntityId) {
      expireActiveProjectile(state, events, projectile);
    }
  }
  for (const effect of [...state.activeTargetEffects.values()]) {
    if (effect.sourceEntityId === ownerEntityId || effect.targetEntityId === ownerEntityId) {
      expireActiveTargetEffect(state, events, effect);
    }
  }
  for (const [key, reveal] of [...state.activeLootReveals.entries()]) {
    if (reveal.sourceEntityId === ownerEntityId) {
      state.activeLootReveals.delete(key);
    }
  }
  for (const summon of [...state.summons.values()]) {
    if (
      summon.ownerEntityId === ownerEntityId &&
      (summon.kind === 'decoy' || summon.kind === 'stone-arhat' || summon.kind === 'bean-soldier')
    ) {
      state.summons.delete(summon.entityId);
      events.push({
        type: 'summon-expired',
        tick: state.tick,
        entityId: summon.entityId,
        ownerEntityId: summon.ownerEntityId,
        summonKind: summon.kind,
        ...(summon.activeAbilityId === undefined
          ? {}
          : { activeAbilityId: summon.activeAbilityId }),
      });
    }
  }
}
