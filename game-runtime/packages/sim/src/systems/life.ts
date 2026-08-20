import { M0_RULES, M0_SPAWN_POINTS, MAP_COURTS, MAP_SPAWN_POINTS } from '@jwgb/content';
import {
  distanceSquaredMm,
  invariant,
  moveToward,
  neutralIntent,
  TICKS_PER_SECOND,
  type Vec2Mm,
  vec2Mm,
} from '@jwgb/core';
import { ringContainsPoint } from '../geometry/integer-geometry';
import { sortedPlayers } from '../state';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { clearPendingActiveReplacement } from './active-replacement';
import { hasDirectLineOfSight } from './active-targeting';
import { removeOwnedActiveWorld } from './active-world';
import { interruptAirdropChannel } from './airdrop';
import { dropEquipmentInstances, rebuildEquipmentStats } from './equipment-inventory';
import { clearPendingEquipmentPickup } from './equipment-loot-pickup';
import { clearEquipmentStateOnTrueDeath } from './equipment-state';
import { isInsideNormalStormSafeZone } from './storm-zone';
import { removeOwnedWindWalls } from './wind-wall';

const RESPAWN_ENEMY_BUFFER_MM = 12_000;
const RESPAWN_ENEMY_VISION_BUFFER_MM = 30_000;

function respawnCandidates(state: MutableSimulationState): Vec2Mm[] {
  if (state.mapField && state.stormZone.courtAnnounced) {
    const court = MAP_COURTS.find((candidate) => candidate.id === state.stormZone.selectedCourtId);
    if (court) {
      return court.revivePoints.map((point) => vec2Mm(point.x, point.z));
    }
  }
  if (state.mapField) {
    return MAP_SPAWN_POINTS.map((point) => vec2Mm(point.position.x, point.position.z));
  }
  return M0_SPAWN_POINTS.map((point) => vec2Mm(point.x, point.z));
}

function pointInsideFinalCourt(state: MutableSimulationState, point: Vec2Mm): boolean {
  if (!state.mapField || !state.stormZone.courtAnnounced) {
    return true;
  }
  const court = MAP_COURTS.find((candidate) => candidate.id === state.stormZone.selectedCourtId);
  return court
    ? ringContainsPoint(
        court.hexVertices.map((vertex) => vec2Mm(vertex.x, vertex.z)),
        point,
      )
    : false;
}

function isRespawnPointLegal(
  state: MutableSimulationState,
  player: PlayerEntity,
  point: Vec2Mm,
): boolean {
  if (!isInsideNormalStormSafeZone(state, point) || !pointInsideFinalCourt(state, point)) {
    return false;
  }
  if (state.mapField?.isCircleBlocked(point, M0_RULES.playerCapsuleRadiusMm)) {
    return false;
  }
  return !sortedPlayers(state).some((enemy) => {
    if (
      enemy.entityId === player.entityId ||
      enemy.lifeState === 'eliminated' ||
      enemy.lifeState === 'soul-flight'
    ) {
      return false;
    }
    const distance = distanceSquaredMm(enemy.position, point);
    if (distance <= RESPAWN_ENEMY_BUFFER_MM * RESPAWN_ENEMY_BUFFER_MM) {
      return true;
    }
    return (
      distance <= RESPAWN_ENEMY_VISION_BUFFER_MM * RESPAWN_ENEMY_VISION_BUFFER_MM &&
      hasDirectLineOfSight(state, enemy.position, point, 450)
    );
  });
}

function safeFallbackPoint(state: MutableSimulationState, player: PlayerEntity): Vec2Mm {
  const candidates = respawnCandidates(state);
  const legal = candidates.find((point) => isRespawnPointLegal(state, player, point));
  if (legal) {
    return legal;
  }
  if (state.mapField && state.stormZone.courtAnnounced) {
    const court = MAP_COURTS.find((candidate) => candidate.id === state.stormZone.selectedCourtId);
    if (court) {
      const center = vec2Mm(court.center.x, court.center.z);
      if (
        isInsideNormalStormSafeZone(state, center) &&
        pointInsideFinalCourt(state, center) &&
        !state.mapField.isCircleBlocked(center, M0_RULES.playerCapsuleRadiusMm)
      ) {
        return center;
      }
    }
  }
  const geometricFallback = candidates.find(
    (point) =>
      isInsideNormalStormSafeZone(state, point) &&
      pointInsideFinalCourt(state, point) &&
      !state.mapField?.isCircleBlocked(point, M0_RULES.playerCapsuleRadiusMm),
  );
  if (geometricFallback) {
    return geometricFallback;
  }
  return vec2Mm(player.position.x, player.position.z);
}

function selectRespawnTarget(
  state: MutableSimulationState,
  player: PlayerEntity,
  excluded: Vec2Mm | null = null,
): Vec2Mm {
  const livingEnemies = sortedPlayers(state).filter(
    (candidate) =>
      candidate.entityId !== player.entityId &&
      candidate.lifeState !== 'eliminated' &&
      candidate.lifeState !== 'soul-flight',
  );
  const ranked = respawnCandidates(state)
    .map((point, index) => ({
      point,
      index,
      legal: isRespawnPointLegal(state, player, point),
      fromDeath: distanceSquaredMm(player.position, point),
      nearestEnemy:
        livingEnemies.length === 0
          ? Number.MAX_SAFE_INTEGER
          : Math.min(...livingEnemies.map((enemy) => distanceSquaredMm(enemy.position, point))),
    }))
    .filter(
      (candidate) =>
        candidate.legal &&
        (excluded === null || candidate.point.x !== excluded.x || candidate.point.z !== excluded.z),
    )
    .sort(
      (left, right) =>
        right.nearestEnemy - left.nearestEnemy ||
        right.fromDeath - left.fromDeath ||
        left.index - right.index,
    );
  return ranked[0]?.point ?? safeFallbackPoint(state, player);
}

function respawnFlightTicks(from: Vec2Mm, to: Vec2Mm): number {
  const distance = Math.trunc(Math.sqrt(distanceSquaredMm(from, to)));
  const seconds = Math.min(10, Math.max(3, distance / 18_000));
  return Math.max(1, Math.ceil(seconds * TICKS_PER_SECOND));
}

function assignRespawnTarget(
  state: MutableSimulationState,
  player: PlayerEntity,
  excluded: Vec2Mm | null = null,
): void {
  const target = selectRespawnTarget(state, player, excluded);
  player.respawnTarget = target;
  player.respawnFlightDeadlineTick = state.tick + respawnFlightTicks(player.position, target);
  player.respawnRetryUntilTick = player.respawnFlightDeadlineTick + 3 * TICKS_PER_SECOND;
  player.respawnAttemptCount += 1;
}

export function beginTrueDeath(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
): void {
  interruptAirdropChannel(state, events, player.entityId, 'true-death');
  clearPendingActiveReplacement(state, events, player.entityId, 'player-unavailable');
  clearPendingEquipmentPickup(state, events, player.entityId, 'player-unavailable');
  clearEquipmentStateOnTrueDeath(state, player);
  player.hp = 0;
  player.trueDeaths += 1;
  player.livesRemaining -= 1;
  const droppedEquipment =
    player.trueDeaths >= 3
      ? [...player.inventoryEquipment, ...player.equipment]
      : [...player.inventoryEquipment];
  player.inventoryEquipment.length = 0;
  if (player.trueDeaths >= 3) {
    player.equipment.length = 0;
    rebuildEquipmentStats(player);
  }
  dropEquipmentInstances(state, events, player, droppedEquipment);
  player.attackCooldownTicks = 0;
  player.activeCooldownTicks = 0;
  player.activeBuffTicks = 0;
  player.armedCriticalTicks = 0;
  player.armedMissingHpDamagePercent = 0;
  player.armedActiveId = null;
  player.activeLifestealTicks = 0;
  player.activeLifestealPercent = 0;
  player.activeDamageReductionTicks = 0;
  player.activeDamageReductionBasisPoints = 10_000;
  player.activeSpeedBonusTicks = 0;
  player.activeSpeedBonusPercent = 0;
  player.worldInteractionLockTicks = 0;
  player.polymorphTicks = 0;
  player.polymorphSpeedBonusPercent = 0;
  player.stealthTicks = 0;
  player.displacementLockTicks = 0;
  player.treasureSenseTicks = 0;
  player.hardControlTicks = 0;
  player.slowTicks = 0;
  player.slowBasisPoints = 10_000;
  player.silenceTicks = 0;
  player.silenceCooldownPenaltyTicks = 0;
  player.blindTicks = 0;
  player.blindMissPercent = 0;
  player.blindPreventsCritical = false;
  player.b15SpeedBoostTicks = 0;
  player.b15SpeedBonusPercent = 0;
  player.b25NextBasicBonusPercent = 0;
  player.b25AttackSpeedBoostTicks = 0;
  player.b25AttackSpeedBonusPercent = 0;
  player.b27SpeedBoostTicks = 0;
  player.b27SpeedBonusPercent = 0;
  player.b36Stacks = 0;
  player.b36MovingTicks = 0;
  player.b38NextHealTick = 0;
  player.whirlwindTicks = 0;
  player.whirlwindNextPulseTick = 0;
  player.b20ReviveBuffTicks = 0;
  player.invulnerableTicks = 0;
  player.pvpCombatTicks = 0;
  player.iceCoffinTicks = 0;
  player.taibaiChannelTicks = 0;
  player.taibaiTargetHeroId = null;
  player.consumableVisionTicks = 0;
  player.consumableRevealTicks = 0;
  player.shields.length = 0;
  player.reviveProtectionTicks = 0;
  player.moveRemainderX = 0;
  player.moveRemainderZ = 0;
  player.intent = neutralIntent(player.intent.sequence);
  for (let index = state.bountyMarks.length - 1; index >= 0; index -= 1) {
    const mark = state.bountyMarks[index];
    if (mark?.sourceEntityId === player.entityId && mark.targetEntityId !== player.entityId) {
      state.bountyMarks.splice(index, 1);
    }
  }
  removeOwnedWindWalls(state, player.entityId, events);
  removeOwnedActiveWorld(state, events, player.entityId);

  events.push({
    type: 'true-death',
    tick: state.tick,
    entityId: player.entityId,
    trueDeaths: player.trueDeaths,
    livesRemaining: player.livesRemaining,
  });

  if (player.livesRemaining <= 0) {
    player.lifeState = 'eliminated';
    player.respawnTarget = null;
    player.respawnFlightDeadlineTick = 0;
    player.respawnRetryUntilTick = 0;
    player.respawnAttemptCount = 0;
    state.eliminationOrder.push(player.entityId);
    state.eliminationTicks.set(player.entityId, state.tick);
    events.push({
      type: 'eliminated',
      tick: state.tick,
      entityId: player.entityId,
      placementBasis: 'third-true-death',
    });
    return;
  }

  player.lifeState = 'soul-flight';
  player.respawnAttemptCount = 0;
  assignRespawnTarget(state, player);
}

function releaseProtectionForIntent(player: PlayerEntity, events: SimEvent[], tick: number): void {
  if (
    player.lifeState === 'revive-protection' &&
    (player.intent.attack || player.intent.castActive || player.intent.interact)
  ) {
    player.lifeState = 'alive';
    player.reviveProtectionTicks = 0;
    events.push({
      type: 'revive-protection-ended',
      tick,
      entityId: player.entityId,
      reason: 'intent',
    });
  }
}

export function advanceLifeStates(state: MutableSimulationState, events: SimEvent[]): void {
  const soulStepMm = Math.trunc(M0_RULES.soulSpeedMmPerSecond / TICKS_PER_SECOND);

  for (const player of sortedPlayers(state)) {
    if (player.lifeState === 'eliminated') {
      continue;
    }

    player.attackCooldownTicks = Math.max(0, player.attackCooldownTicks - 1);
    player.activeCooldownTicks = Math.max(0, player.activeCooldownTicks - 1);
    player.activeBuffTicks = Math.max(0, player.activeBuffTicks - 1);
    player.armedCriticalTicks = Math.max(0, player.armedCriticalTicks - 1);
    if (player.armedCriticalTicks === 0) {
      player.armedMissingHpDamagePercent = 0;
      player.armedActiveId = null;
    }
    player.activeLifestealTicks = Math.max(0, player.activeLifestealTicks - 1);
    player.activeDamageReductionTicks = Math.max(0, player.activeDamageReductionTicks - 1);
    player.activeSpeedBonusTicks = Math.max(0, player.activeSpeedBonusTicks - 1);
    player.worldInteractionLockTicks = Math.max(0, player.worldInteractionLockTicks - 1);
    player.polymorphTicks = Math.max(0, player.polymorphTicks - 1);
    player.stealthTicks = Math.max(0, player.stealthTicks - 1);
    player.displacementLockTicks = Math.max(0, player.displacementLockTicks - 1);
    player.treasureSenseTicks = Math.max(0, player.treasureSenseTicks - 1);
    player.hardControlTicks = Math.max(0, player.hardControlTicks - 1);
    player.b19RetriggerLockTicks = Math.max(0, player.b19RetriggerLockTicks - 1);
    player.b20ReviveBuffTicks = Math.max(0, player.b20ReviveBuffTicks - 1);
    player.invulnerableTicks = Math.max(0, player.invulnerableTicks - 1);
    player.pvpCombatTicks = Math.max(0, player.pvpCombatTicks - 1);
    player.iceCoffinTicks = Math.max(0, player.iceCoffinTicks - 1);
    player.consumableVisionTicks = Math.max(0, player.consumableVisionTicks - 1);
    player.consumableRevealTicks = Math.max(0, player.consumableRevealTicks - 1);

    releaseProtectionForIntent(player, events, state.tick);

    if (player.lifeState === 'revive-protection') {
      player.reviveProtectionTicks = Math.max(0, player.reviveProtectionTicks - 1);
      if (player.reviveProtectionTicks === 0) {
        player.lifeState = 'alive';
        events.push({
          type: 'revive-protection-ended',
          tick: state.tick,
          entityId: player.entityId,
          reason: 'timeout',
        });
      }
      continue;
    }

    if (player.lifeState !== 'soul-flight') {
      continue;
    }

    invariant(player.respawnTarget, 'soul-flight player must have a respawn target');
    const remainingTicks = Math.max(
      1,
      (player.respawnRetryUntilTick > state.tick
        ? player.respawnRetryUntilTick
        : player.respawnFlightDeadlineTick) - state.tick,
    );
    const distanceRemaining = Math.trunc(
      Math.sqrt(distanceSquaredMm(player.position, player.respawnTarget)),
    );
    const adaptiveSoulStepMm = Math.max(
      1,
      Math.ceil(distanceRemaining / remainingTicks),
      remainingTicks <= 1 ? soulStepMm : 0,
    );
    player.position = moveToward(player.position, player.respawnTarget, adaptiveSoulStepMm);

    if (
      player.position.x === player.respawnTarget.x &&
      player.position.z === player.respawnTarget.z
    ) {
      if (
        !isRespawnPointLegal(state, player, player.respawnTarget) &&
        state.tick < player.respawnRetryUntilTick
      ) {
        const previousTarget = player.respawnTarget;
        const nextTarget = selectRespawnTarget(state, player, previousTarget);
        player.respawnTarget = nextTarget;
        player.respawnAttemptCount += 1;
        continue;
      }
      if (!isRespawnPointLegal(state, player, player.respawnTarget)) {
        player.position = safeFallbackPoint(state, player);
      }
      player.lifeState = 'revive-protection';
      player.hp = player.maxHp;
      player.attackCooldownTicks = 0;
      player.activeCooldownTicks = 0;
      player.activeBuffTicks = 0;
      player.armedCriticalTicks = 0;
      player.armedMissingHpDamagePercent = 0;
      player.armedActiveId = null;
      player.activeLifestealTicks = 0;
      player.activeLifestealPercent = 0;
      player.activeDamageReductionTicks = 0;
      player.activeDamageReductionBasisPoints = 10_000;
      player.activeSpeedBonusTicks = 0;
      player.activeSpeedBonusPercent = 0;
      player.worldInteractionLockTicks = 0;
      player.polymorphTicks = 0;
      player.polymorphSpeedBonusPercent = 0;
      player.stealthTicks = 0;
      player.displacementLockTicks = 0;
      player.treasureSenseTicks = 0;
      player.hardControlTicks = 0;
      player.slowTicks = 0;
      player.slowBasisPoints = 10_000;
      player.silenceTicks = 0;
      player.silenceCooldownPenaltyTicks = 0;
      player.blindTicks = 0;
      player.blindMissPercent = 0;
      player.blindPreventsCritical = false;
      player.b15SpeedBoostTicks = 0;
      player.b15SpeedBonusPercent = 0;
      player.b25NextBasicBonusPercent = 0;
      player.b25AttackSpeedBoostTicks = 0;
      player.b25AttackSpeedBonusPercent = 0;
      player.b27SpeedBoostTicks = 0;
      player.b27SpeedBonusPercent = 0;
      player.b36Stacks = 0;
      player.b36MovingTicks = 0;
      player.b38NextHealTick = 0;
      player.whirlwindTicks = 0;
      player.whirlwindNextPulseTick = 0;
      player.b20ReviveBuffTicks = 0;
      player.invulnerableTicks = 0;
      player.pvpCombatTicks = 0;
      player.iceCoffinTicks = 0;
      player.taibaiChannelTicks = 0;
      player.taibaiTargetHeroId = null;
      player.consumableVisionTicks = 0;
      player.consumableRevealTicks = 0;
      player.shields.length = 0;
      player.reviveProtectionTicks = M0_RULES.reviveProtectionTicks;
      player.respawnTarget = null;
      player.respawnFlightDeadlineTick = 0;
      player.respawnRetryUntilTick = 0;
      player.respawnAttemptCount = 0;
      events.push({
        type: 'respawn',
        tick: state.tick,
        entityId: player.entityId,
        position: player.position,
      });
    }
  }
}
