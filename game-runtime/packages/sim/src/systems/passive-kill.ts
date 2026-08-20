import { getPassiveDefinition, PASSIVE_IDS, passiveLevelValue } from '@jwgb/content';
import { distanceSquaredMm, type EntityId } from '@jwgb/core';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import {
  emitActiveStatusApplied,
  expireActiveTargetEffect,
  setActiveTargetEffect,
} from './active-damage';
import type { ActiveTarget } from './active-targeting';
import {
  activeTargetPosition,
  isActivePlayer,
  isActiveSummon,
  isActiveZone,
  sortedActiveTargets,
} from './active-targeting';
import {
  grantExperience,
  grantGeneratedGold,
  resolveEquipmentHeroKill,
  resolveEquipmentMonsterKill,
} from './equipment-economy';
import { findPassiveLoadout } from './passive-runtime';

export interface PassiveKillContext {
  readonly sourceEntityId: EntityId;
  readonly victimEntityId: EntityId;
  readonly victimKind: 'hero' | 'monster';
  readonly victimHpBefore: number;
  readonly victimMaxHp: number;
  readonly victimPlayer?: PlayerEntity;
  readonly awardBaseHeroReward?: boolean;
}

function creditedPlayer(
  state: MutableSimulationState,
  sourceEntityId: EntityId,
): PlayerEntity | undefined {
  const direct = state.players.get(sourceEntityId);
  if (direct) {
    return direct;
  }
  const summon = state.summons.get(sourceEntityId);
  return summon ? state.players.get(summon.ownerEntityId) : undefined;
}

function emitKillProc(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  passiveId: (typeof PASSIVE_IDS)[keyof typeof PASSIVE_IDS],
  detail: string,
  amount: number,
  targetEntityId: EntityId,
  durationTicks = 0,
): void {
  events.push({
    type: 'passive-proc',
    tick: state.tick,
    passiveId,
    sourceEntityId: player.entityId,
    targetEntityId,
    detail,
    amount,
    durationTicks,
  });
}

function resolveBountyReward(
  state: MutableSimulationState,
  events: SimEvent[],
  killer: PlayerEntity,
  victimEntityId: EntityId,
): boolean {
  let reward = 0;
  for (let index = state.bountyMarks.length - 1; index >= 0; index -= 1) {
    const mark = state.bountyMarks[index];
    if (!mark || mark.expiresAtTick <= state.tick) {
      state.bountyMarks.splice(index, 1);
      continue;
    }
    if (mark.targetEntityId !== victimEntityId) {
      continue;
    }
    if (mark.rewardRecipientEntityId === null || mark.rewardRecipientEntityId === killer.entityId) {
      reward += mark.rewardGold;
    }
    state.bountyMarks.splice(index, 1);
  }
  if (reward <= 0) {
    return false;
  }
  const granted = grantGeneratedGold(killer, reward);
  emitKillProc(state, events, killer, PASSIVE_IDS.bounty, 'bounty-reward', granted, victimEntityId);
  return true;
}

function applyBountyHunter(
  state: MutableSimulationState,
  events: SimEvent[],
  killer: PlayerEntity,
  victimEntityId: EntityId,
): void {
  const loadout = findPassiveLoadout(killer, PASSIVE_IDS.bountyHunter);
  if (!loadout) {
    return;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.bountyHunter);
  if (definition.effect !== 'bounty-hunter') {
    return;
  }
  const reduction = passiveLevelValue(definition.cooldownReductionTicksByLevel, loadout.level);
  killer.activeCooldownTicks = Math.max(0, killer.activeCooldownTicks - reduction);
  if (loadout.level === 5) {
    killer.b42SpeedBoostTicks = definition.speedDurationTicks;
    killer.b42SpeedBonusPercent = definition.speedBonusPercent;
  }
  emitKillProc(
    state,
    events,
    killer,
    PASSIVE_IDS.bountyHunter,
    'bounty-hunter',
    reduction,
    victimEntityId,
    killer.b42SpeedBoostTicks,
  );
}

function createBountyMark(
  state: MutableSimulationState,
  events: SimEvent[],
  victim: PlayerEntity,
  killer: PlayerEntity,
): void {
  const loadout = findPassiveLoadout(victim, PASSIVE_IDS.bounty);
  if (!loadout || victim.entityId === killer.entityId) {
    return;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.bounty);
  if (definition.effect !== 'bounty-mark') {
    return;
  }
  const durationTicks = passiveLevelValue(definition.markDurationTicksByLevel, loadout.level);
  const rewardGold = passiveLevelValue(definition.rewardGoldByLevel, loadout.level);
  const existingIndex = state.bountyMarks.findIndex(
    (mark) => mark.targetEntityId === killer.entityId,
  );
  const existing = existingIndex < 0 ? undefined : state.bountyMarks[existingIndex];
  if (existingIndex >= 0) {
    state.bountyMarks.splice(existingIndex, 1);
  }
  state.bountyMarks.push({
    sourceEntityId: victim.entityId,
    targetEntityId: killer.entityId,
    rewardGold: Math.max(existing?.rewardGold ?? 0, rewardGold),
    rewardRecipientEntityId: null,
    revealToAll:
      (existing?.revealToAll ?? false) || (loadout.level === 5 && definition.level5Reveal),
    expiresAtTick: Math.max(existing?.expiresAtTick ?? 0, state.tick + durationTicks),
  });
  emitKillProc(
    state,
    events,
    victim,
    PASSIVE_IDS.bounty,
    'bounty-mark',
    rewardGold,
    killer.entityId,
    durationTicks,
  );
}

function resolveActiveKillEffects(
  state: MutableSimulationState,
  events: SimEvent[],
  killer: PlayerEntity,
  victimEntityId: EntityId,
): void {
  const markEffects = [...state.activeTargetEffects.values()].filter(
    (effect) =>
      effect.kind === 'damage-mark' &&
      effect.activeId === 'H028' &&
      effect.sourceEntityId === killer.entityId &&
      effect.targetEntityId === victimEntityId &&
      effect.expiresAtTick > state.tick,
  );
  for (const effect of markEffects) {
    expireActiveTargetEffect(state, events, effect);
    const nextTarget = sortedActiveTargets(state)
      .filter((candidate): candidate is ActiveTarget => {
        if (
          isActiveZone(candidate) ||
          candidate.entityId === killer.entityId ||
          candidate.entityId === victimEntityId
        ) {
          return false;
        }
        if (isActivePlayer(candidate)) {
          return candidate.lifeState === 'alive';
        }
        if (isActiveSummon(candidate)) {
          return (
            candidate.targetable && candidate.hp > 0 && candidate.ownerEntityId !== killer.entityId
          );
        }
        return candidate.hp > 0 && candidate.invulnerableTicks <= 0;
      })
      .filter(
        (candidate) =>
          distanceSquaredMm(
            activeTargetPosition(candidate),
            activeTargetPosition(
              state.players.get(victimEntityId) ??
                state.monsters.get(victimEntityId) ??
                state.summons.get(victimEntityId) ??
                killer,
            ),
          ) <=
          30_000 * 30_000,
      )
      .sort(
        (left, right) =>
          distanceSquaredMm(activeTargetPosition(left), killer.position) -
            distanceSquaredMm(activeTargetPosition(right), killer.position) ||
          Number(left.entityId) - Number(right.entityId),
      )[0];
    if (!nextTarget) {
      continue;
    }
    const transferred = setActiveTargetEffect(state, {
      sourceEntityId: killer.entityId,
      targetEntityId: nextTarget.entityId,
      activeId: effect.activeId,
      kind: 'damage-mark',
      stacks: 1,
      maximumStacks: 1,
      fixedDamage: 0,
      attackCoefficientBasisPoints: 0,
      percentDamage: 0,
      targetDamageBonusPercent: effect.targetDamageBonusPercent,
      revealToSource: false,
      expiresAtTick: state.tick + 8 * 20,
      nextPulseTick: Number.MAX_SAFE_INTEGER,
      pulseIntervalTicks: 0,
    });
    emitActiveStatusApplied(
      state,
      events,
      killer,
      nextTarget,
      'damage-mark',
      transferred.expiresAtTick - state.tick,
      effect.activeId,
    );
  }
}

function resolveActiveBountyKill(
  state: MutableSimulationState,
  killer: PlayerEntity,
  victimEntityId: EntityId,
): void {
  const mark = state.bountyMarks.find(
    (candidate) =>
      candidate.sourceEntityId === killer.entityId &&
      candidate.targetEntityId === killer.entityId &&
      candidate.revealToAll &&
      candidate.expiresAtTick > state.tick,
  );
  if (!mark || victimEntityId === killer.entityId) {
    return;
  }
  killer.activeBountyStreak += 1;
  const reward = 500 * 2 ** Math.min(20, killer.activeBountyStreak - 1);
  grantGeneratedGold(killer, reward);
  const cumulative = 500 * (2 ** Math.min(20, killer.activeBountyStreak) - 1);
  mark.rewardGold = Math.trunc(cumulative / 2);
}

export function resolvePassiveKill(
  state: MutableSimulationState,
  events: SimEvent[],
  context: PassiveKillContext,
): void {
  const killer = creditedPlayer(state, context.sourceEntityId);
  if (!killer) {
    if (context.victimKind === 'hero') {
      for (let index = state.bountyMarks.length - 1; index >= 0; index -= 1) {
        if (state.bountyMarks[index]?.targetEntityId === context.victimEntityId) {
          state.bountyMarks.splice(index, 1);
        }
      }
    }
    return;
  }

  if (
    context.awardBaseHeroReward === true &&
    context.victimKind === 'hero' &&
    context.victimPlayer
  ) {
    const victim = context.victimPlayer;
    const baseGold =
      500 +
      Math.min(1_500, Math.max(0, victim.level) * 100) +
      Math.trunc(Math.max(0, victim.gold) / 10);
    const eliminationBonus = victim.livesRemaining <= 0 ? 500 : 0;
    const gold = grantGeneratedGold(killer, baseGold + eliminationBonus);
    const experience = grantExperience(killer, Math.min(180, 60 + Math.max(0, victim.level) * 8));
    events.push({
      type: 'hero-kill-reward',
      tick: state.tick,
      sourceEntityId: killer.entityId,
      targetEntityId: victim.entityId,
      gold,
      experience,
      eliminated: victim.livesRemaining <= 0,
    });
  }

  const wasBountyTarget =
    context.victimKind === 'hero'
      ? resolveBountyReward(state, events, killer, context.victimEntityId)
      : false;
  if (wasBountyTarget) {
    applyBountyHunter(state, events, killer, context.victimEntityId);
  }

  const greed = findPassiveLoadout(killer, PASSIVE_IDS.greed);
  if (greed) {
    const definition = getPassiveDefinition(PASSIVE_IDS.greed);
    if (definition.effect === 'monster-kill-gold') {
      const gold =
        context.victimKind === 'monster'
          ? passiveLevelValue(definition.monsterGoldByLevel, greed.level)
          : greed.level === 5
            ? definition.heroKillGold
            : 0;
      if (gold > 0) {
        const granted = grantGeneratedGold(killer, gold);
        emitKillProc(
          state,
          events,
          killer,
          PASSIVE_IDS.greed,
          'kill-gold',
          granted,
          context.victimEntityId,
        );
      }
    }
  }

  const tenacity = findPassiveLoadout(killer, PASSIVE_IDS.tenacity);
  if (tenacity) {
    const definition = getPassiveDefinition(PASSIVE_IDS.tenacity);
    if (definition.effect === 'kill-growth') {
      killer.b40KillCount += 1;
      let growth = passiveLevelValue(definition.hpPerKillByLevel, tenacity.level);
      if (killer.b40KillCount % definition.milestoneKills === 0) {
        growth += definition.milestoneHpBonus;
      }
      killer.b40BonusMaxHp += growth;
      killer.maxHp += growth;
      killer.hp += growth;
      emitKillProc(
        state,
        events,
        killer,
        PASSIVE_IDS.tenacity,
        'kill-growth',
        growth,
        context.victimEntityId,
      );
    }
  }

  const directKiller = state.players.get(context.sourceEntityId);
  const execute = directKiller ? findPassiveLoadout(directKiller, PASSIVE_IDS.execute) : undefined;
  if (directKiller && execute?.level === 5) {
    const definition = getPassiveDefinition(PASSIVE_IDS.execute);
    if (
      definition.effect === 'low-hp-execute' &&
      context.victimHpBefore * 100 <=
        context.victimMaxHp * passiveLevelValue(definition.thresholdPercentByLevel, execute.level)
    ) {
      const before = directKiller.hp;
      directKiller.hp = Math.min(
        directKiller.maxHp,
        directKiller.hp +
          Math.max(1, Math.trunc((directKiller.maxHp * definition.level5KillHealPercent) / 100)),
      );
      emitKillProc(
        state,
        events,
        directKiller,
        PASSIVE_IDS.execute,
        'execute-heal',
        directKiller.hp - before,
        context.victimEntityId,
      );
    }
  }

  if (context.victimPlayer) {
    createBountyMark(state, events, context.victimPlayer, killer);
    resolveEquipmentHeroKill(state, events, killer, context.victimPlayer);
  } else if (context.victimKind === 'monster') {
    resolveEquipmentMonsterKill(state, events, killer, context.victimEntityId);
  }
  if (context.victimKind === 'hero' || context.victimKind === 'monster') {
    resolveActiveBountyKill(state, killer, context.victimEntityId);
    if (context.victimKind === 'hero') {
      resolveActiveKillEffects(state, events, killer, context.victimEntityId);
    }
  }
}

export function advanceBountyMarks(state: MutableSimulationState): void {
  for (let index = state.bountyMarks.length - 1; index >= 0; index -= 1) {
    if ((state.bountyMarks[index]?.expiresAtTick ?? 0) <= state.tick) {
      state.bountyMarks.splice(index, 1);
    }
  }
}
