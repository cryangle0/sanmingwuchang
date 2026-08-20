import { EQUIPMENT_IDS } from '@jwgb/content';
import { type EntityId, TICKS_PER_SECOND } from '@jwgb/core';
import { sortedPlayers } from '../state';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { applyDamage } from './damage';
import {
  equipmentHasActiveReveal,
  equipmentHasNightCloak,
  equipmentOutOfCombatHeal,
  hasEquipment,
} from './equipment-query';
import { clearDormantBootsState } from './equipment-state';
import { applyMonsterDamage } from './monster-damage';
import { getOrCreatePassiveTargetState } from './passive-runtime';

const OUT_OF_COMBAT_TICKS = 5 * TICKS_PER_SECOND;
const NIGHT_CLOAK_STILL_TICKS = 2 * TICKS_PER_SECOND;
const FLIGHT_DELAY_TICKS = 5 * TICKS_PER_SECOND;
const EQUIPMENT_BURN_DURATION_TICKS = 2 * TICKS_PER_SECOND;
const EQUIPMENT_BURN_DAMAGE_PER_SECOND = 20;
const DORMANT_BOOTS_SPEED_TICKS = 2 * TICKS_PER_SECOND;
const DORMANT_BOOTS_COOLDOWN_TICKS = 8 * TICKS_PER_SECOND;
const COMBO_SHOES_DURATION_TICKS = 3 * TICKS_PER_SECOND;
const COMBO_SHOES_MAX_STACKS = 6;

function isOutOfCombat(state: MutableSimulationState, player: PlayerEntity): boolean {
  return state.tick - player.lastCombatTick >= OUT_OF_COMBAT_TICKS;
}

function emitEquipmentProc(
  events: SimEvent[],
  state: MutableSimulationState,
  equipmentId: PlayerEntity['equipment'][number]['equipmentId'],
  sourceEntityId: EntityId,
  targetEntityId: EntityId | null,
  detail: string,
  amount: number,
  durationTicks = 0,
): void {
  events.push({
    type: 'equipment-proc',
    tick: state.tick,
    equipmentId,
    sourceEntityId,
    targetEntityId,
    detail,
    amount,
    durationTicks,
  });
}

export function breakEquipmentStealth(player: PlayerEntity): void {
  player.nightCloakStillTicks = 0;
  player.nightCloakStealthed = false;
}

function isStealthed(player: PlayerEntity): boolean {
  return player.stealthTicks > 0 || player.nightCloakStealthed;
}

export function triggerDormantBootsOffensiveReveal(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
  detail: 'hostile-basic-commit' | 'hostile-active-commit',
  targetEntityId: EntityId | null,
): boolean {
  if (!hasEquipment(player, EQUIPMENT_IDS.dormantBoots) || !isStealthed(player)) {
    return false;
  }
  if (!player.dormantBootsStealthEpisodeActive) {
    player.dormantBootsStealthEpisodeActive = true;
    player.dormantBootsTriggeredThisEpisode = false;
  }
  if (player.dormantBootsTriggeredThisEpisode || player.dormantBootsCooldownTicks > 0) {
    player.dormantBootsTriggeredThisEpisode = true;
    return false;
  }
  player.dormantBootsTriggeredThisEpisode = true;
  player.dormantBootsSpeedTicks = DORMANT_BOOTS_SPEED_TICKS;
  player.dormantBootsCooldownTicks = DORMANT_BOOTS_COOLDOWN_TICKS;
  emitEquipmentProc(
    events,
    state,
    EQUIPMENT_IDS.dormantBoots,
    player.entityId,
    targetEntityId,
    detail,
    30,
    DORMANT_BOOTS_SPEED_TICKS,
  );
  return true;
}

export function recordComboShoesBasicHit(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  targetEntityId: EntityId,
  appliedDamage: number,
): void {
  if (
    appliedDamage <= 0 ||
    !hasEquipment(owner, EQUIPMENT_IDS.comboShoes) ||
    owner.lifeState !== 'alive'
  ) {
    return;
  }
  const targetPlayer = state.players.get(targetEntityId);
  const targetMonster = state.monsters.get(targetEntityId);
  if (
    (targetPlayer !== undefined && targetPlayer.lifeState !== 'alive') ||
    (targetPlayer === undefined && (targetMonster === undefined || targetMonster.hp <= 0))
  ) {
    const invalidState = state.passiveTargetStates.get(
      `${Number(owner.entityId)}:${Number(targetEntityId)}`,
    );
    if (invalidState) {
      invalidState.comboShoesStacks = 0;
      invalidState.comboShoesExpiresAtTick = 0;
    }
    return;
  }
  for (const targetState of state.passiveTargetStates.values()) {
    if (
      targetState.sourceEntityId === owner.entityId &&
      targetState.targetEntityId !== targetEntityId
    ) {
      targetState.comboShoesStacks = 0;
      targetState.comboShoesExpiresAtTick = 0;
    }
  }
  const targetState = getOrCreatePassiveTargetState(state, owner.entityId, targetEntityId);
  const previousStacks =
    targetState.comboShoesExpiresAtTick > state.tick ? targetState.comboShoesStacks : 0;
  targetState.comboShoesStacks = Math.min(COMBO_SHOES_MAX_STACKS, previousStacks + 1);
  targetState.comboShoesExpiresAtTick = state.tick + COMBO_SHOES_DURATION_TICKS;
  emitEquipmentProc(
    events,
    state,
    EQUIPMENT_IDS.comboShoes,
    owner.entityId,
    targetEntityId,
    'same-target-basic-attack-speed-stack',
    targetState.comboShoesStacks,
    COMBO_SHOES_DURATION_TICKS,
  );
}

export function applyEquipmentBurn(
  state: MutableSimulationState,
  source: PlayerEntity,
  targetEntityId: EntityId,
): void {
  if (!source.equipment.some((instance) => instance.equipmentId === EQUIPMENT_IDS.fireTipSpear)) {
    return;
  }
  const targetState = getOrCreatePassiveTargetState(state, source.entityId, targetEntityId);
  targetState.equipmentBurnDamagePerSecond = EQUIPMENT_BURN_DAMAGE_PER_SECOND;
  targetState.equipmentBurnExpiresAtTick = Math.max(
    targetState.equipmentBurnExpiresAtTick,
    state.tick + EQUIPMENT_BURN_DURATION_TICKS,
  );
  targetState.equipmentBurnNextTick = state.tick + TICKS_PER_SECOND;
  targetState.equipmentBurnSourceEntityId = source.entityId;
}

function advanceEquipmentBurn(state: MutableSimulationState, events: SimEvent[]): void {
  for (const targetState of state.passiveTargetStates.values()) {
    if (targetState.equipmentBurnExpiresAtTick <= state.tick) {
      targetState.equipmentBurnDamagePerSecond = 0;
      targetState.equipmentBurnExpiresAtTick = 0;
      targetState.equipmentBurnNextTick = 0;
      targetState.equipmentBurnSourceEntityId = null;
      continue;
    }
    if (
      targetState.equipmentBurnDamagePerSecond <= 0 ||
      targetState.equipmentBurnNextTick > state.tick
    ) {
      continue;
    }
    const source =
      targetState.equipmentBurnSourceEntityId === null
        ? undefined
        : state.players.get(targetState.equipmentBurnSourceEntityId);
    if (!source || source.lifeState === 'eliminated') {
      targetState.equipmentBurnNextTick += TICKS_PER_SECOND;
      continue;
    }
    const targetPlayer = state.players.get(targetState.targetEntityId);
    const targetMonster = state.monsters.get(targetState.targetEntityId);
    let applied = 0;
    if (targetPlayer) {
      applied = applyDamage(state, events, {
        sourceEntityId: source.entityId,
        targetEntityId: targetPlayer.entityId,
        amount: targetState.equipmentBurnDamagePerSecond,
        cause: 'active',
        form: 'dot',
        periodic: true,
      });
    } else if (targetMonster) {
      applied = applyMonsterDamage(
        state,
        events,
        source.entityId,
        targetMonster,
        targetState.equipmentBurnDamagePerSecond,
        source.element,
        { periodic: true },
      );
    }
    if (applied > 0) {
      emitEquipmentProc(
        events,
        state,
        EQUIPMENT_IDS.fireTipSpear,
        source.entityId,
        targetState.targetEntityId,
        'basic-attack-burn',
        applied,
        Math.max(0, targetState.equipmentBurnExpiresAtTick - state.tick),
      );
    }
    targetState.equipmentBurnNextTick += TICKS_PER_SECOND;
  }
}

function advancePersonalEquipment(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
): void {
  if (!hasEquipment(player, EQUIPMENT_IDS.dormantBoots)) {
    clearDormantBootsState(player);
  } else {
    player.dormantBootsSpeedTicks = Math.max(0, player.dormantBootsSpeedTicks - 1);
    player.dormantBootsCooldownTicks = Math.max(0, player.dormantBootsCooldownTicks - 1);
    if (isStealthed(player)) {
      if (!player.dormantBootsStealthEpisodeActive) {
        player.dormantBootsStealthEpisodeActive = true;
        player.dormantBootsTriggeredThisEpisode = false;
      }
    } else {
      player.dormantBootsStealthEpisodeActive = false;
      player.dormantBootsTriggeredThisEpisode = false;
    }
  }

  if (player.lifeState !== 'alive') {
    breakEquipmentStealth(player);
    player.flightActive = false;
    return;
  }

  const outOfCombat = isOutOfCombat(state, player);
  const healAmount = equipmentOutOfCombatHeal(player);
  if (outOfCombat && healAmount > 0 && state.tick > 0 && state.tick % TICKS_PER_SECOND === 0) {
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + healAmount);
    if (player.hp > before) {
      emitEquipmentProc(
        events,
        state,
        player.equipment.some(
          (instance) => instance.equipmentId === EQUIPMENT_IDS.tenThousandYearLingzhi,
        )
          ? EQUIPMENT_IDS.tenThousandYearLingzhi
          : EQUIPMENT_IDS.medicineGourd,
        player.entityId,
        null,
        'out-of-combat-heal',
        player.hp - before,
        TICKS_PER_SECOND,
      );
    }
  }

  if (
    equipmentHasNightCloak(player) &&
    outOfCombat &&
    player.intent.movement.x === 0 &&
    player.intent.movement.z === 0
  ) {
    player.nightCloakStillTicks += 1;
    if (player.nightCloakStillTicks >= NIGHT_CLOAK_STILL_TICKS) {
      player.nightCloakStealthed = true;
      player.stealthTicks = Math.max(player.stealthTicks, 2);
    }
  } else {
    breakEquipmentStealth(player);
  }

  player.flightActive =
    outOfCombat &&
    state.tick - player.lastCombatTick >= FLIGHT_DELAY_TICKS &&
    player.equipment.some((instance) => instance.equipmentId === EQUIPMENT_IDS.cloudRide);
}

function advanceComboShoesStates(state: MutableSimulationState): void {
  for (const targetState of state.passiveTargetStates.values()) {
    if (targetState.comboShoesStacks <= 0) {
      targetState.comboShoesExpiresAtTick = 0;
      continue;
    }
    const source = state.players.get(targetState.sourceEntityId);
    const targetPlayer = state.players.get(targetState.targetEntityId);
    const targetMonster = state.monsters.get(targetState.targetEntityId);
    const sourceValid =
      source?.lifeState === 'alive' && hasEquipment(source, EQUIPMENT_IDS.comboShoes);
    const targetValid =
      targetPlayer !== undefined
        ? targetPlayer.lifeState === 'alive'
        : targetMonster !== undefined && targetMonster.hp > 0;
    if (!sourceValid || !targetValid || targetState.comboShoesExpiresAtTick <= state.tick) {
      targetState.comboShoesStacks = 0;
      targetState.comboShoesExpiresAtTick = 0;
    }
  }
}

export function recordEnemyActiveReveal(
  state: MutableSimulationState,
  events: SimEvent[],
  caster: PlayerEntity,
): void {
  for (const observer of sortedPlayers(state)) {
    if (
      observer.entityId === caster.entityId ||
      observer.lifeState === 'eliminated' ||
      !equipmentHasActiveReveal(observer)
    ) {
      continue;
    }
    const key = `${Number(observer.entityId)}:${Number(caster.entityId)}`;
    state.equipmentReveals.set(key, {
      key,
      observerEntityId: observer.entityId,
      targetEntityId: caster.entityId,
      position: { x: caster.position.x, z: caster.position.z },
      expiresAtTick: state.tick + 3 * TICKS_PER_SECOND,
    });
    emitEquipmentProc(
      events,
      state,
      EQUIPMENT_IDS.keenEars,
      caster.entityId,
      observer.entityId,
      'enemy-active-position-snapshot',
      0,
      3 * TICKS_PER_SECOND,
    );
  }
}

export function advanceEquipmentRuntime(state: MutableSimulationState, events: SimEvent[]): void {
  for (const player of sortedPlayers(state)) {
    advancePersonalEquipment(state, events, player);
  }
  advanceComboShoesStates(state);
  advanceEquipmentBurn(state, events);
  for (const [key, reveal] of state.equipmentReveals) {
    if (reveal.expiresAtTick <= state.tick) {
      state.equipmentReveals.delete(key);
    }
  }
}
