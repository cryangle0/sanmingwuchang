import { PASSIVE_IDS } from '@jwgb/content';
import type { ActiveId, PassiveId } from '@jwgb/core';
import type { MutableSimulationState, PlayerEntity, SimEvent, SummonKind } from '../types';
import { expireActiveTargetEffect } from './active-damage';
import { expireActiveProjectile, expireActiveZone } from './active-world';
import { rebuildEquipmentStats } from './equipment-inventory';
import { removeOwnedWindWalls } from './wind-wall';

const ACTIVE_SUMMON_KINDS = new Set<SummonKind>(['decoy', 'stone-arhat', 'bean-soldier']);

function removeOwnedSummons(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  kinds: ReadonlySet<SummonKind>,
): void {
  for (const [entityId, summon] of state.summons) {
    if (summon.ownerEntityId !== player.entityId || !kinds.has(summon.kind)) {
      continue;
    }
    state.summons.delete(entityId);
    events.push({
      type: 'summon-expired',
      tick: state.tick,
      entityId,
      ownerEntityId: player.entityId,
      summonKind: summon.kind,
      ...(summon.activeAbilityId === undefined ? {} : { activeAbilityId: summon.activeAbilityId }),
    });
  }
}

export function clearOwnedActiveStateForReplacement(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  activeId: ActiveId,
): void {
  for (const projectile of state.activeProjectiles.values()) {
    if (projectile.ownerEntityId === player.entityId && projectile.activeId === activeId) {
      expireActiveProjectile(state, events, projectile);
    }
  }
  for (const zone of state.activeZones.values()) {
    if (zone.ownerEntityId === player.entityId && zone.activeId === activeId) {
      expireActiveZone(state, events, zone);
    }
  }
  for (const effect of state.activeTargetEffects.values()) {
    if (effect.sourceEntityId === player.entityId && effect.activeId === activeId) {
      expireActiveTargetEffect(state, events, effect);
    }
  }
  for (const [key, reveal] of state.activeLootReveals) {
    if (reveal.sourceEntityId === player.entityId) {
      state.activeLootReveals.delete(key);
    }
  }
  if (player.armedActiveId === activeId) {
    player.armedActiveId = null;
    player.armedCriticalTicks = 0;
    player.armedMissingHpDamagePercent = 0;
  }
  player.activeBountyStreak = 0;
  removeOwnedWindWalls(state, player.entityId, events);
  removeOwnedSummons(state, events, player, ACTIVE_SUMMON_KINDS);
}

export function clearRemovedPassiveState(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  passiveId: PassiveId,
): void {
  for (let index = player.shields.length - 1; index >= 0; index -= 1) {
    const shield = player.shields[index];
    if (shield?.source.kind === 'passive' && shield.source.passiveId === passiveId) {
      player.shields.splice(index, 1);
    }
  }

  if (passiveId === PASSIVE_IDS.wolfSpirit) {
    removeOwnedSummons(state, events, player, new Set(['wolf-spirit']));
  } else if (passiveId === PASSIVE_IDS.fireSpirit) {
    removeOwnedSummons(state, events, player, new Set(['fire-spirit']));
  } else if (passiveId === PASSIVE_IDS.stoneStatue) {
    removeOwnedSummons(state, events, player, new Set(['stone-statue']));
  } else if (passiveId === PASSIVE_IDS.afterimage) {
    for (const [entityId, afterimage] of state.afterimages) {
      if (afterimage.ownerEntityId === player.entityId) {
        state.afterimages.delete(entityId);
      }
    }
    player.b30NextAfterimageTick = 0;
  } else if (passiveId === PASSIVE_IDS.coldArrow) {
    for (const [entityId, projectile] of state.projectiles) {
      if (projectile.ownerEntityId === player.entityId && projectile.kind === 'cold-arrow') {
        state.projectiles.delete(entityId);
      }
    }
  } else if (passiveId === PASSIVE_IDS.bounty) {
    for (let index = state.bountyMarks.length - 1; index >= 0; index -= 1) {
      if (state.bountyMarks[index]?.sourceEntityId === player.entityId) {
        state.bountyMarks.splice(index, 1);
      }
    }
  } else if (passiveId === PASSIVE_IDS.tenacity) {
    player.b40KillCount = 0;
    player.b40BonusMaxHp = 0;
    rebuildEquipmentStats(player);
  }

  if (passiveId === PASSIVE_IDS.momentum) {
    player.b36Stacks = 0;
    player.b36MovingTicks = 0;
  } else if (passiveId === PASSIVE_IDS.rage) {
    player.b25NextBasicBonusPercent = 0;
    player.b25AttackSpeedBoostTicks = 0;
    player.b25AttackSpeedBonusPercent = 0;
  } else if (passiveId === PASSIVE_IDS.sprint) {
    player.b27SpeedBoostTicks = 0;
    player.b27SpeedBonusPercent = 0;
  } else if (passiveId === PASSIVE_IDS.bountyHunter) {
    player.b42SpeedBoostTicks = 0;
    player.b42SpeedBonusPercent = 0;
  }

  for (const targetState of state.passiveTargetStates.values()) {
    if (targetState.sourceEntityId !== player.entityId) {
      continue;
    }
    if (passiveId === PASSIVE_IDS.burn) {
      targetState.burnStacks = 0;
    } else if (passiveId === PASSIVE_IDS.poison) {
      targetState.poisonStacks = 0;
      targetState.poisonExpiresAtTick = 0;
      targetState.poisonNextTick = 0;
    } else if (passiveId === PASSIVE_IDS.fireSpirit) {
      targetState.fireBurnDamagePerSecond = 0;
      targetState.fireBurnExpiresAtTick = 0;
      targetState.fireBurnNextTick = 0;
      targetState.fireBurnSourceEntityId = null;
    } else if (passiveId === PASSIVE_IDS.stun) {
      targetState.stunCooldownTicks = 0;
    } else if (passiveId === PASSIVE_IDS.counter) {
      targetState.counterCooldownTicks = 0;
    } else if (passiveId === PASSIVE_IDS.pickpocket) {
      targetState.pickpocketCooldownTicks = 0;
    } else if (passiveId === PASSIVE_IDS.ambush) {
      targetState.lastBasicHitTick = 0;
      targetState.revealExpiresAtTick = 0;
    }
  }
}
