import { EQUIPMENT_IDS, type EquippedEquipmentInstance, M0_RULES, MAP_CHESTS } from '@jwgb/content';
import {
  distanceSquaredMm,
  type EntityId,
  type EquipmentId,
  TICKS_PER_SECOND,
  type Vec2Mm,
  vec2Mm,
} from '@jwgb/core';
import { getRequiredPlayer, sortedMonsters, sortedPlayers } from '../state';
import type {
  AirdropChannel,
  AirdropEntity,
  AirdropPhase,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
} from '../types';
import { isBlockedByActiveWall } from './active-collision';
import { hasDirectLineOfSight } from './active-targeting';
import { grantGeneratedGold } from './equipment-economy';
import { createEquipmentInstance } from './equipment-inventory';
import { createEquipmentLootDrop, emitLootDropped } from './loot-runtime';
import { normalStormSafeRadiusMm } from './storm-zone';
import { canUseWorldResources } from './world-interaction';

export const AIRDROP_WARNING_TICKS = 15 * TICKS_PER_SECOND;
export const AIRDROP_CHANNEL_TICKS = 3 * TICKS_PER_SECOND;
export const AIRDROP_LIFETIME_TICKS = 120 * TICKS_PER_SECOND;
export const AIRDROP_INTERACTION_RADIUS_MM = 2_500;
export const AIRDROP_LANDING_RESERVATION_RADIUS_MM = 3_000;
export const AIRDROP_INTERRUPT_MOVE_MM = 250;
export const AIRDROP_REWARD_GOLD = 1_200;

export const AIRDROP_SCHEDULE_TICKS = [
  6 * 60 * TICKS_PER_SECOND,
  12 * 60 * TICKS_PER_SECOND,
  18 * 60 * TICKS_PER_SECOND,
] as const;

export const AIRDROP_EQUIPMENT_POOL: readonly EquipmentId[] = [
  EQUIPMENT_IDS.nineTurnPill,
  EQUIPMENT_IDS.primordialPearl,
  EQUIPMENT_IDS.tribulationBell,
  EQUIPMENT_IDS.cloudRide,
  EQUIPMENT_IDS.treasureBasin,
  EQUIPMENT_IDS.demonSubduingMace,
  EQUIPMENT_IDS.keenEars,
  EQUIPMENT_IDS.thunderChisel,
  EQUIPMENT_IDS.soulDevouringRing,
];

const LEGACY_AIRDROP_POINTS: readonly Vec2Mm[] = [
  vec2Mm(0, 60_000),
  vec2Mm(42_426, 42_426),
  vec2Mm(60_000, 0),
  vec2Mm(42_426, -42_426),
  vec2Mm(0, -60_000),
  vec2Mm(-42_426, -42_426),
  vec2Mm(-60_000, 0),
  vec2Mm(-42_426, 42_426),
  vec2Mm(0, 0),
];

export type AirdropChannelCancelReason =
  | 'moved'
  | 'damaged'
  | 'forced-displacement'
  | 'hard-control'
  | 'true-death'
  | 'expired'
  | 'opened-by-other';

export type AirdropTransactionCode =
  | 'accepted'
  | 'match-finished'
  | 'airdrop-not-found'
  | 'airdrop-not-available'
  | 'airdrop-expired'
  | 'player-not-alive'
  | 'pvp-combat-lock'
  | 'airdrop-too-far'
  | 'airdrop-line-of-sight'
  | 'channel-active';

export interface AirdropTransactionResult {
  readonly accepted: boolean;
  readonly code: AirdropTransactionCode;
}

function airdropId(sequence: 1 | 2 | 3): string {
  return `airdrop-${sequence}`;
}

function matchElapsedTick(state: Pick<MutableSimulationState, 'tick' | 'match'>): number {
  if (state.match.startedAtTick === null) {
    return 0;
  }
  return Math.max(0, state.tick - state.match.startedAtTick);
}

function clonePosition(position: Vec2Mm): Vec2Mm {
  return vec2Mm(position.x, position.z);
}

export function initializeAirdrops(state: MutableSimulationState): void {
  if (state.airdrops.size > 0) {
    return;
  }
  for (let index = 0; index < AIRDROP_SCHEDULE_TICKS.length; index += 1) {
    const sequence = (index + 1) as 1 | 2 | 3;
    const scheduledElapsedTick = AIRDROP_SCHEDULE_TICKS[index];
    if (scheduledElapsedTick === undefined) {
      continue;
    }
    state.airdrops.set(airdropId(sequence), {
      id: airdropId(sequence),
      sequence,
      scheduledElapsedTick,
      phase: 'pending',
      position: null,
      announcedAtTick: null,
      landedAtTick: null,
      expiresAtTick: null,
      openedAtTick: null,
      openedByEntityId: null,
      equipmentId: null,
      lootEntityId: null,
    });
  }
}

function fallbackCandidates(state: MutableSimulationState): readonly Vec2Mm[] {
  if (state.mapField !== null) {
    return MAP_CHESTS.map((chest) => vec2Mm(chest.position.x, chest.position.z));
  }
  return LEGACY_AIRDROP_POINTS;
}

function isInsideLegacyArena(position: Vec2Mm, radiusMm: number): boolean {
  const legalRadius = M0_RULES.arenaRadiusMm - radiusMm;
  return position.x * position.x + position.z * position.z <= legalRadius * legalRadius;
}

function touchesStaticSolid(
  position: Vec2Mm,
  radiusMm: number,
  solids: MutableSimulationState['staticSolids'],
): boolean {
  return solids.some(
    (solid) =>
      position.x >= solid.minimumX - radiusMm &&
      position.x <= solid.maximumX + radiusMm &&
      position.z >= solid.minimumZ - radiusMm &&
      position.z <= solid.maximumZ + radiusMm,
  );
}

function isLegalLandingPoint(state: MutableSimulationState, position: Vec2Mm): boolean {
  const reservationRadius = AIRDROP_LANDING_RESERVATION_RADIUS_MM;
  if (
    state.mapField
      ? state.mapField.isCircleBlocked(position, reservationRadius)
      : !isInsideLegacyArena(position, reservationRadius)
  ) {
    return false;
  }
  if (touchesStaticSolid(position, reservationRadius, state.staticSolids)) {
    return false;
  }
  if (isBlockedByActiveWall(state, position, reservationRadius)) {
    return false;
  }

  const safeRadius = normalStormSafeRadiusMm(state.tick);
  if (
    safeRadius <= reservationRadius ||
    distanceSquaredMm(position, vec2Mm(0, 0)) >
      (safeRadius - reservationRadius) * (safeRadius - reservationRadius)
  ) {
    return false;
  }

  for (const player of sortedPlayers(state)) {
    if (
      player.lifeState !== 'eliminated' &&
      distanceSquaredMm(player.position, position) <=
        (reservationRadius + M0_RULES.playerCapsuleRadiusMm) *
          (reservationRadius + M0_RULES.playerCapsuleRadiusMm)
    ) {
      return false;
    }
  }
  for (const monster of sortedMonsters(state)) {
    if (
      monster.hp > 0 &&
      (monster.kind === 'dragon-king' || monster.kind === 'core-boss') &&
      distanceSquaredMm(monster.position, position) <=
        (reservationRadius + monster.collisionRadiusMm) *
          (reservationRadius + monster.collisionRadiusMm)
    ) {
      return false;
    }
  }
  return true;
}

function selectLandingPoint(state: MutableSimulationState): Vec2Mm | null {
  const candidates = fallbackCandidates(state);
  if (candidates.length === 0) {
    return null;
  }
  const start = state.random.airdrop.nextInt(candidates.length);
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidate = candidates[(start + offset) % candidates.length];
    if (candidate && isLegalLandingPoint(state, candidate)) {
      return clonePosition(candidate);
    }
  }
  return null;
}

function setChannelLock(player: PlayerEntity, ticks: number): void {
  player.worldInteractionLockTicks = Math.max(player.worldInteractionLockTicks, ticks);
}

function clearChannelLock(player: PlayerEntity): void {
  player.worldInteractionLockTicks = 0;
}

function cancelChannel(
  state: MutableSimulationState,
  events: SimEvent[],
  channel: AirdropChannel,
  reason: AirdropChannelCancelReason,
): void {
  if (state.airdropChannels.get(channel.playerEntityId) !== channel) {
    return;
  }
  state.airdropChannels.delete(channel.playerEntityId);
  const player = state.players.get(channel.playerEntityId);
  if (player) {
    clearChannelLock(player);
  }
  events.push({
    type: 'airdrop-channel',
    tick: state.tick,
    entityId: channel.playerEntityId,
    airdropId: channel.airdropId,
    phase: 'cancelled',
    reason,
  });
}

/**
 * Called by damage and displacement systems at the point the interruption is
 * authoritative. This keeps channel cancellation independent of tick order.
 */
export function interruptAirdropChannel(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  reason: Extract<
    AirdropChannelCancelReason,
    'damaged' | 'forced-displacement' | 'hard-control' | 'true-death'
  >,
): void {
  const channel = state.airdropChannels.get(playerEntityId);
  if (channel) {
    cancelChannel(state, events, channel, reason);
  }
}

function announceAirdrop(
  state: MutableSimulationState,
  events: SimEvent[],
  airdrop: AirdropEntity,
): void {
  const position = selectLandingPoint(state);
  if (!position) {
    return;
  }
  airdrop.phase = 'warning';
  airdrop.position = position;
  airdrop.announcedAtTick = state.tick;
  events.push({
    type: 'airdrop-warning',
    tick: state.tick,
    airdropId: airdrop.id,
    scheduledAtTick: (state.match.startedAtTick ?? state.tick) + airdrop.scheduledElapsedTick,
    position: clonePosition(position),
  });
}

function landAirdrop(
  state: MutableSimulationState,
  events: SimEvent[],
  airdrop: AirdropEntity,
): void {
  if (!airdrop.position || !isLegalLandingPoint(state, airdrop.position)) {
    const replacement = selectLandingPoint(state);
    if (!replacement) {
      return;
    }
    airdrop.position = replacement;
  }
  if (!airdrop.position) {
    return;
  }
  airdrop.phase = 'available';
  airdrop.landedAtTick = state.tick;
  airdrop.expiresAtTick = state.tick + AIRDROP_LIFETIME_TICKS;
  events.push({
    type: 'airdrop-landed',
    tick: state.tick,
    airdropId: airdrop.id,
    position: clonePosition(airdrop.position),
    expiresAtTick: airdrop.expiresAtTick,
  });
}

function expireAirdrop(
  state: MutableSimulationState,
  events: SimEvent[],
  airdrop: AirdropEntity,
): void {
  if (airdrop.phase !== 'available') {
    return;
  }
  airdrop.phase = 'expired';
  for (const channel of [...state.airdropChannels.values()]) {
    if (channel.airdropId === airdrop.id) {
      cancelChannel(state, events, channel, 'expired');
    }
  }
  events.push({
    type: 'airdrop-expired',
    tick: state.tick,
    airdropId: airdrop.id,
  });
}

function completeChannel(
  state: MutableSimulationState,
  events: SimEvent[],
  channel: AirdropChannel,
  airdrop: AirdropEntity,
): void {
  const player = state.players.get(channel.playerEntityId);
  if (!player || !airdrop.position || airdrop.phase !== 'available') {
    cancelChannel(state, events, channel, 'expired');
    return;
  }

  const equipmentId =
    AIRDROP_EQUIPMENT_POOL[state.random.airdrop.nextInt(AIRDROP_EQUIPMENT_POOL.length)];
  if (!equipmentId) {
    cancelChannel(state, events, channel, 'expired');
    return;
  }
  const instance: EquippedEquipmentInstance = createEquipmentInstance(state, equipmentId);
  const drop = createEquipmentLootDrop(state, airdrop.position, instance);
  const rewardGold = grantGeneratedGold(player, AIRDROP_REWARD_GOLD);

  airdrop.phase = 'opened';
  airdrop.openedAtTick = state.tick;
  airdrop.openedByEntityId = player.entityId;
  airdrop.equipmentId = equipmentId;
  airdrop.lootEntityId = drop.entityId;
  state.airdropChannels.delete(player.entityId);
  clearChannelLock(player);
  events.push({
    type: 'airdrop-channel',
    tick: state.tick,
    entityId: player.entityId,
    airdropId: airdrop.id,
    phase: 'completed',
  });
  emitLootDropped(state, events, drop, player.entityId);
  events.push({
    type: 'airdrop-opened',
    tick: state.tick,
    airdropId: airdrop.id,
    entityId: player.entityId,
    equipmentId,
    lootEntityId: drop.entityId,
    rewardGold,
  });

  for (const other of [...state.airdropChannels.values()]) {
    if (other.airdropId === airdrop.id) {
      cancelChannel(state, events, other, 'opened-by-other');
    }
  }
}

function advanceChannels(state: MutableSimulationState, events: SimEvent[]): void {
  const channels = [...state.airdropChannels.values()].sort(
    (left, right) => left.completesAtTick - right.completesAtTick || left.sequence - right.sequence,
  );
  for (const channel of channels) {
    if (state.airdropChannels.get(channel.playerEntityId) !== channel) {
      continue;
    }
    const player = state.players.get(channel.playerEntityId);
    const airdrop = state.airdrops.get(channel.airdropId);
    if (!player || !airdrop || airdrop.phase !== 'available') {
      cancelChannel(state, events, channel, 'expired');
      continue;
    }
    if (airdrop.expiresAtTick !== null && airdrop.expiresAtTick <= state.tick) {
      cancelChannel(state, events, channel, 'expired');
      continue;
    }
    if (player.lifeState !== 'alive') {
      cancelChannel(state, events, channel, 'true-death');
      continue;
    }
    if (player.hardControlTicks > 0) {
      cancelChannel(state, events, channel, 'hard-control');
      continue;
    }
    if (
      distanceSquaredMm(player.position, channel.originPosition) >
      AIRDROP_INTERRUPT_MOVE_MM * AIRDROP_INTERRUPT_MOVE_MM
    ) {
      cancelChannel(state, events, channel, 'moved');
      continue;
    }
    if (channel.completesAtTick <= state.tick) {
      completeChannel(state, events, channel, airdrop);
    }
  }
}

export function advanceAirdrops(state: MutableSimulationState, events: SimEvent[]): void {
  initializeAirdrops(state);
  if (state.match.status !== 'running') {
    return;
  }
  const elapsedTick = matchElapsedTick(state);
  for (const airdrop of state.airdrops.values()) {
    if (
      airdrop.phase === 'pending' &&
      elapsedTick >= airdrop.scheduledElapsedTick - AIRDROP_WARNING_TICKS
    ) {
      announceAirdrop(state, events, airdrop);
    }
    if (airdrop.phase === 'warning' && elapsedTick >= airdrop.scheduledElapsedTick) {
      landAirdrop(state, events, airdrop);
    }
    if (
      airdrop.phase === 'available' &&
      airdrop.expiresAtTick !== null &&
      airdrop.expiresAtTick <= state.tick
    ) {
      expireAirdrop(state, events, airdrop);
    }
  }
  advanceChannels(state, events);
}

export function startAirdropOpenResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  airdropIdValue: string,
): AirdropTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  const airdrop = state.airdrops.get(airdropIdValue);
  if (!airdrop) {
    return { accepted: false, code: 'airdrop-not-found' };
  }
  if (state.airdropChannels.has(playerEntityId)) {
    return { accepted: false, code: 'channel-active' };
  }
  if (airdrop.phase === 'expired' || airdrop.phase === 'opened') {
    return { accepted: false, code: 'airdrop-expired' };
  }
  if (airdrop.phase !== 'available' || !airdrop.position) {
    return { accepted: false, code: 'airdrop-not-available' };
  }
  if (!canUseWorldResources(player)) {
    return { accepted: false, code: 'player-not-alive' };
  }
  if (player.pvpCombatTicks > 0) {
    return { accepted: false, code: 'pvp-combat-lock' };
  }
  if (
    distanceSquaredMm(player.position, airdrop.position) >
    AIRDROP_INTERACTION_RADIUS_MM * AIRDROP_INTERACTION_RADIUS_MM
  ) {
    return { accepted: false, code: 'airdrop-too-far' };
  }
  if (
    !hasDirectLineOfSight(state, player.position, airdrop.position, M0_RULES.playerCapsuleRadiusMm)
  ) {
    return { accepted: false, code: 'airdrop-line-of-sight' };
  }

  const channel: AirdropChannel = {
    sequence: state.nextAirdropChannelSequence,
    playerEntityId,
    airdropId: airdrop.id,
    startedAtTick: state.tick,
    completesAtTick: state.tick + AIRDROP_CHANNEL_TICKS,
    originPosition: clonePosition(player.position),
  };
  state.nextAirdropChannelSequence += 1;
  state.airdropChannels.set(playerEntityId, channel);
  setChannelLock(player, AIRDROP_CHANNEL_TICKS);
  events.push({
    type: 'airdrop-channel',
    tick: state.tick,
    entityId: playerEntityId,
    airdropId: airdrop.id,
    phase: 'started',
  });
  return { accepted: true, code: 'accepted' };
}

export function airdropPhaseIsPublic(phase: AirdropPhase): boolean {
  return phase !== 'pending';
}
