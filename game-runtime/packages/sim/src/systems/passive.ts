import type { PassiveLevel } from '@jwgb/content';
import { distanceSquaredMm, type EntityId, type PassiveId } from '@jwgb/core';
import { getRequiredPlayer } from '../state';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { hasDirectLineOfSight } from './active-targeting';
import { clearRemovedPassiveState } from './loadout-cleanup';
import { canUseWorldResources } from './world-interaction';

export type PassiveTransactionCode =
  | 'accepted'
  | 'match-finished'
  | 'player-not-alive'
  | 'pvp-combat-lock'
  | 'no-gems'
  | 'passive-not-learned'
  | 'passive-maxed'
  | 'loot-not-found'
  | 'loot-not-skill-book'
  | 'skill-book-too-far'
  | 'skill-book-line-of-sight'
  | 'invalid-replacement';

export interface PassiveTransactionResult {
  readonly accepted: boolean;
  readonly code: PassiveTransactionCode;
}

function accepted(): PassiveTransactionResult {
  return { accepted: true, code: 'accepted' };
}

function rejected(code: PassiveTransactionCode): PassiveTransactionResult {
  return { accepted: false, code };
}

function nextPassiveLevel(level: PassiveLevel): PassiveLevel | null {
  return level >= 5 ? null : ((level + 1) as PassiveLevel);
}

export function applySkillBook(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  passiveId: PassiveId,
): boolean {
  const existingIndex = player.passives.findIndex((entry) => entry.passiveId === passiveId);
  const existing = existingIndex < 0 ? undefined : player.passives[existingIndex];
  if (existing && existingIndex >= 0) {
    const nextLevel = nextPassiveLevel(existing.level);
    if (nextLevel === null) {
      return false;
    }
    player.passives[existingIndex] = { passiveId, level: nextLevel };
    events.push({
      type: 'passive-upgraded',
      tick: state.tick,
      entityId: player.entityId,
      passiveId,
      level: nextLevel,
      source: 'skill-book',
    });
    return true;
  }
  if (player.passives.length >= 4) {
    return false;
  }
  player.passives.push({ passiveId, level: 1 });
  events.push({
    type: 'passive-learned',
    tick: state.tick,
    entityId: player.entityId,
    passiveId,
    source: 'skill-book',
  });
  return true;
}

export function spendGemResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  passiveId: PassiveId,
): PassiveTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  if (!canUseWorldResources(player)) {
    return rejected('player-not-alive');
  }
  if (player.pvpCombatTicks > 0) {
    return rejected('pvp-combat-lock');
  }
  if (player.gems <= 0) {
    return rejected('no-gems');
  }
  const existingIndex = player.passives.findIndex((entry) => entry.passiveId === passiveId);
  const existing = existingIndex < 0 ? undefined : player.passives[existingIndex];
  if (!existing || existingIndex < 0) {
    return rejected('passive-not-learned');
  }
  const nextLevel = nextPassiveLevel(existing.level);
  if (nextLevel === null) {
    return rejected('passive-maxed');
  }
  player.gems -= 1;
  player.passives[existingIndex] = { passiveId, level: nextLevel };
  events.push({
    type: 'passive-upgraded',
    tick: state.tick,
    entityId: player.entityId,
    passiveId,
    level: nextLevel,
    source: 'gem',
  });
  return accepted();
}

export function replaceSkillBookResult(
  state: MutableSimulationState,
  events: SimEvent[],
  playerEntityId: EntityId,
  lootEntityId: EntityId,
  replacePassiveId: PassiveId,
): PassiveTransactionResult {
  const player = getRequiredPlayer(state, playerEntityId);
  if (!canUseWorldResources(player)) {
    return rejected('player-not-alive');
  }
  if (player.pvpCombatTicks > 0) {
    return rejected('pvp-combat-lock');
  }
  const drop = state.lootDrops.get(lootEntityId);
  if (!drop) {
    return rejected('loot-not-found');
  }
  if (drop.bookPassiveId === null) {
    return rejected('loot-not-skill-book');
  }
  if (distanceSquaredMm(player.position, drop.position) > 2_500 * 2_500) {
    return rejected('skill-book-too-far');
  }
  if (!hasDirectLineOfSight(state, player.position, drop.position)) {
    return rejected('skill-book-line-of-sight');
  }
  if (player.passives.length < 4) {
    return rejected('invalid-replacement');
  }
  if (player.passives.some((entry) => entry.passiveId === drop.bookPassiveId)) {
    return rejected('invalid-replacement');
  }
  const replaceIndex = player.passives.findIndex((entry) => entry.passiveId === replacePassiveId);
  if (replaceIndex < 0) {
    return rejected('invalid-replacement');
  }
  clearRemovedPassiveState(state, events, player, replacePassiveId);
  player.passives[replaceIndex] = {
    passiveId: drop.bookPassiveId,
    level: 1,
  };
  state.lootDrops.delete(lootEntityId);
  events.push({
    type: 'passive-learned',
    tick: state.tick,
    entityId: player.entityId,
    passiveId: drop.bookPassiveId,
    source: 'skill-book',
  });
  events.push({
    type: 'loot-collected',
    tick: state.tick,
    entityId: drop.entityId,
    collectorEntityId: player.entityId,
    gold: 0,
    experience: 0,
    gems: 0,
    equipmentId: null,
    bookPassiveId: drop.bookPassiveId,
    activeId: null,
  });
  return accepted();
}
