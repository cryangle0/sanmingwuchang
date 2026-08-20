import {
  EQUIPMENT_IDS,
  getEquipmentDefinition,
  getPassiveDefinition,
  PASSIVE_IDS,
  type PassiveLoadoutEntry,
  passiveLevelValue,
} from '@jwgb/content';
import { integerSquareRoot, type Vec2Mm, vec2Mm } from '@jwgb/core';
import type { MutableSimulationState, PlayerEntity, SimEvent } from '../types';
import { clearRemovedEquipmentState } from './equipment-state';

const B19_DIRECTION_COUNT = 8;

function createEightDirectionOffsets(distanceMm: number): readonly Vec2Mm[] {
  const diagonalMm = integerSquareRoot(Math.trunc((distanceMm * distanceMm) / 2));
  return [
    vec2Mm(distanceMm, 0),
    vec2Mm(diagonalMm, diagonalMm),
    vec2Mm(0, distanceMm),
    vec2Mm(-diagonalMm, diagonalMm),
    vec2Mm(-distanceMm, 0),
    vec2Mm(-diagonalMm, -diagonalMm),
    vec2Mm(0, -distanceMm),
    vec2Mm(diagonalMm, -diagonalMm),
  ];
}

function findPassive(
  player: PlayerEntity,
  passiveId: (typeof PASSIVE_IDS)[keyof typeof PASSIVE_IDS],
): PassiveLoadoutEntry | undefined {
  return player.passives.find((entry) => entry.passiveId === passiveId);
}

function restoreFromZero(player: PlayerEntity, maxHpPercent: number): number {
  const restoredHp = Math.max(1, Math.trunc((player.maxHp * maxHpPercent) / 100));
  player.hp = Math.min(player.maxHp, restoredHp);
  return player.hp;
}

function isInsideArena(position: Vec2Mm, arenaRadiusMm: number): boolean {
  return position.x * position.x + position.z * position.z <= arenaRadiusMm * arenaRadiusMm;
}

function pointAlongOffset(origin: Vec2Mm, offset: Vec2Mm, basisPoints: number): Vec2Mm {
  return vec2Mm(
    origin.x + Math.trunc((offset.x * basisPoints) / 10_000),
    origin.z + Math.trunc((offset.z * basisPoints) / 10_000),
  );
}

function farthestLegalBlinkPoint(origin: Vec2Mm, offset: Vec2Mm, arenaRadiusMm: number): Vec2Mm {
  let legalBasisPoints = 0;
  let illegalBasisPoints = 10_001;

  while (illegalBasisPoints - legalBasisPoints > 1) {
    const candidateBasisPoints = Math.trunc((legalBasisPoints + illegalBasisPoints) / 2);
    const candidate = pointAlongOffset(origin, offset, candidateBasisPoints);
    if (isInsideArena(candidate, arenaRadiusMm)) {
      legalBasisPoints = candidateBasisPoints;
    } else {
      illegalBasisPoints = candidateBasisPoints;
    }
  }

  return pointAlongOffset(origin, offset, legalBasisPoints);
}

function tryB19(state: MutableSimulationState, events: SimEvent[], player: PlayerEntity): boolean {
  const loadout = findPassive(player, PASSIVE_IDS.feignDeath);
  if (!loadout || player.b19RetriggerLockTicks > 0) {
    return false;
  }

  const definition = getPassiveDefinition(PASSIVE_IDS.feignDeath);
  if (definition.effect !== 'lethal-proc') {
    return false;
  }
  const chancePercent = passiveLevelValue(definition.chancePercentByLevel, loadout.level);
  if (state.random.combat.nextInt(100) >= chancePercent) {
    return false;
  }

  const previousPosition = player.position;
  let newPosition = previousPosition;
  if (loadout.level === 5) {
    const directionIndex = state.random.combat.nextInt(B19_DIRECTION_COUNT);
    const offset = createEightDirectionOffsets(definition.level5BlinkDistanceMm)[directionIndex];
    if (offset) {
      newPosition = farthestLegalBlinkPoint(previousPosition, offset, state.arenaRadiusMm);
      player.position = newPosition;
    }
  }

  const hpRestored = restoreFromZero(
    player,
    passiveLevelValue(definition.healMaxHpPercentByLevel, loadout.level),
  );
  player.b19RetriggerLockTicks = definition.postSuccessRetriggerLockTicks;
  events.push({
    type: 'lethal-protection',
    tick: state.tick,
    entityId: player.entityId,
    protection: 'b19-feign-death',
    hpRestored,
    previousPosition,
    newPosition,
    didBlink: previousPosition.x !== newPosition.x || previousPosition.z !== newPosition.z,
  });
  return true;
}

function tryB20(state: MutableSimulationState, events: SimEvent[], player: PlayerEntity): boolean {
  const loadout = findPassive(player, PASSIVE_IDS.passiveRevive);
  if (!loadout || state.consumedB20PlayerIds.has(player.playerId)) {
    return false;
  }

  const definition = getPassiveDefinition(PASSIVE_IDS.passiveRevive);
  if (definition.effect !== 'once-per-match-revive') {
    return false;
  }

  state.consumedB20PlayerIds.add(player.playerId);
  const hpRestored = restoreFromZero(
    player,
    passiveLevelValue(definition.healMaxHpPercentByLevel, loadout.level),
  );
  player.b20ReviveBuffTicks = loadout.level === 5 ? definition.level5BuffTicks : 0;
  events.push({
    type: 'lethal-protection',
    tick: state.tick,
    entityId: player.entityId,
    protection: 'b20-passive-revive',
    hpRestored,
    buffTicks: player.b20ReviveBuffTicks,
  });
  return true;
}

function tryG1(state: MutableSimulationState, events: SimEvent[], player: PlayerEntity): boolean {
  const equipmentIndex = player.equipment.findIndex(
    (instance) => instance.equipmentId === EQUIPMENT_IDS.nineTurnPill,
  );
  if (equipmentIndex < 0) {
    return false;
  }

  const definition = getEquipmentDefinition(EQUIPMENT_IDS.nineTurnPill);
  if (definition.effect !== 'lethal-protection-consumable') {
    return false;
  }
  const [consumedEquipment] = player.equipment.splice(equipmentIndex, 1);
  if (!consumedEquipment) {
    return false;
  }
  clearRemovedEquipmentState(state, player, consumedEquipment.equipmentId);
  const hpRestored = restoreFromZero(player, definition.restoreHpPercent);
  player.invulnerableTicks = definition.invulnerableTicks;
  events.push({
    type: 'lethal-protection',
    tick: state.tick,
    entityId: player.entityId,
    protection: 'g1-nine-turn-pill',
    hpRestored,
    consumedEquipmentInstanceId: consumedEquipment.instanceId,
    invulnerableTicks: player.invulnerableTicks,
  });
  return true;
}

export function hasAvailableB20Charge(
  state: MutableSimulationState,
  player: PlayerEntity,
): boolean {
  return (
    findPassive(player, PASSIVE_IDS.passiveRevive) !== undefined &&
    !state.consumedB20PlayerIds.has(player.playerId)
  );
}

export function hasNineTurnPill(player: PlayerEntity): boolean {
  return player.equipment.some((instance) => instance.equipmentId === EQUIPMENT_IDS.nineTurnPill);
}

export function getOutgoingDamageBasisPoints(player: PlayerEntity): number {
  if (player.b20ReviveBuffTicks <= 0) {
    return 10_000;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.passiveRevive);
  return definition.effect === 'once-per-match-revive'
    ? definition.level5DamageMultiplierBasisPoints
    : 10_000;
}

export function hasB20ControlImmunity(player: PlayerEntity): boolean {
  if (player.b20ReviveBuffTicks <= 0) {
    return false;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.passiveRevive);
  return definition.effect === 'once-per-match-revive' && definition.level5ControlImmune;
}

export function resolveLethalProtection(
  state: MutableSimulationState,
  events: SimEvent[],
  player: PlayerEntity,
): boolean {
  if (player.hp > 0 || player.lifeState !== 'alive') {
    return false;
  }

  return (
    tryB19(state, events, player) || tryB20(state, events, player) || tryG1(state, events, player)
  );
}
