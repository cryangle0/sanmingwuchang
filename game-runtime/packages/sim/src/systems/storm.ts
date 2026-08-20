import { getPassiveDefinition, M0_RULES, PASSIVE_IDS, passiveLevelValue } from '@jwgb/content';
import { TICKS_PER_SECOND } from '@jwgb/core';
import { sortedMonsters, sortedPlayers } from '../state';
import type { MutableSimulationState, SimEvent } from '../types';
import { applyDamage } from './damage';
import { applyMonsterDamage } from './monster-damage';
import { findPassiveLoadout } from './passive-runtime';
import { isInNormalStormZone } from './storm-zone';
import { applyHardControl } from './whirlwind';

function resolveNormalStorm(state: MutableSimulationState, events: SimEvent[]): void {
  if (state.tick >= M0_RULES.apocalypseStartTick || state.tick % (3 * TICKS_PER_SECOND) !== 0) {
    return;
  }
  for (const player of sortedPlayers(state)) {
    if (player.lifeState !== 'alive' || !isInNormalStormZone(state, player.position)) {
      continue;
    }
    let hitChancePercent = 50;
    const ward = findPassiveLoadout(player, PASSIVE_IDS.stormWard);
    if (ward) {
      const definition = getPassiveDefinition(PASSIVE_IDS.stormWard);
      if (definition.effect === 'storm-ward') {
        hitChancePercent = Math.trunc(
          (hitChancePercent *
            (100 - passiveLevelValue(definition.stormChanceReductionPercentByLevel, ward.level))) /
            100,
        );
      }
    }
    if (state.random.storm.nextInt(100) >= hitChancePercent) {
      continue;
    }
    const applied = applyDamage(state, events, {
      sourceEntityId: null,
      targetEntityId: player.entityId,
      amount: Math.max(1, Math.trunc((player.maxHp * 20) / 100)),
      cause: 'storm',
      form: 'storm',
    });
    if (applied > 0 && player.lifeState === 'alive') {
      applyHardControl(player, Math.trunc(TICKS_PER_SECOND / 2), state, events);
    }
  }
}

function resolveFinalStorm(state: MutableSimulationState, events: SimEvent[]): void {
  if (
    state.tick < M0_RULES.apocalypseFirstDamageTick ||
    state.tick % M0_RULES.apocalypseDamageIntervalTicks !== 0
  ) {
    return;
  }

  const elapsedSeconds = Math.floor(state.tick / TICKS_PER_SECOND);
  const damagePercent = 2 + Math.floor((elapsedSeconds - 1_200) / 5);

  for (const player of sortedPlayers(state)) {
    if (player.lifeState !== 'alive') {
      continue;
    }

    const damage = Math.max(1, Math.trunc((player.maxHp * damagePercent) / 100));
    applyDamage(state, events, {
      sourceEntityId: null,
      targetEntityId: player.entityId,
      amount: damage,
      cause: 'storm',
      form: 'storm',
    });
  }

  for (const monster of sortedMonsters(state)) {
    if (
      monster.kind !== 'core-boss' ||
      monster.invulnerableTicks > 0 ||
      !state.monsters.has(monster.entityId)
    ) {
      continue;
    }
    const damage = Math.max(1, Math.trunc((monster.maxHp * damagePercent) / 200));
    applyMonsterDamage(state, events, null, monster, damage, null, {
      ignoreSourceBonuses: true,
      ignoreElement: true,
      periodic: true,
      lootGoldMultiplier: 0,
      lootExperienceMultiplier: 0,
      environmental: true,
    });
  }
}

export function resolveApocalypseStorm(state: MutableSimulationState, events: SimEvent[]): void {
  resolveNormalStorm(state, events);
  resolveFinalStorm(state, events);
}
