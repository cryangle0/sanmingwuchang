import {
  getPassiveDefinition,
  PASSIVE_IDS,
  passiveLevelValue,
  type ScriptedActiveDefinition,
} from '@jwgb/content';
import {
  distanceSquaredMm,
  type EntityId,
  entityId,
  moveToward,
  type PassiveId,
  TICKS_PER_SECOND,
  vec2Mm,
} from '@jwgb/core';
import { sortedMonsters, sortedPlayers } from '../state';
import type {
  MonsterEntity,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
  SummonEntity,
  SummonKind,
} from '../types';
import { applyDamage } from './damage';
import { equipmentSummonStatBasisPoints } from './equipment-query';
import { getOutgoingDamageBasisPoints } from './lethal-protection';
import { applyMonsterDamage } from './monster-damage';
import { applyFireSpiritBurn, findPassiveLoadout, scalePassiveMagnitude } from './passive-runtime';
import { applySummonDamage } from './summon-health';

type SummonTarget = PlayerEntity | MonsterEntity;

function scaledSummonStat(owner: PlayerEntity, value: number, attack: boolean): number {
  if (value <= 0) {
    return 0;
  }
  return Math.max(1, Math.trunc((value * equipmentSummonStatBasisPoints(owner, attack)) / 10_000));
}

const FIRE_SPIRIT_OFFSETS = [
  vec2Mm(900, 0),
  vec2Mm(636, 636),
  vec2Mm(0, 900),
  vec2Mm(-636, 636),
  vec2Mm(-900, 0),
  vec2Mm(-636, -636),
  vec2Mm(0, -900),
  vec2Mm(636, -636),
] as const;

function summonCount(
  state: MutableSimulationState,
  ownerEntityId: EntityId,
  kind: SummonKind,
): number {
  return [...state.summons.values()].filter(
    (summon) => summon.ownerEntityId === ownerEntityId && summon.kind === kind,
  ).length;
}

function isPlayerTarget(target: SummonTarget): target is PlayerEntity {
  return 'heroId' in target;
}

function isLivingTarget(target: SummonTarget): boolean {
  return isPlayerTarget(target)
    ? target.lifeState === 'alive' && target.invulnerableTicks <= 0
    : target.hp > 0 && target.invulnerableTicks <= 0;
}

function spawnSummon(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  kind: SummonKind,
): SummonEntity | null {
  const loadout = findPassiveLoadout(
    owner,
    kind === 'wolf-spirit' ? PASSIVE_IDS.wolfSpirit : PASSIVE_IDS.fireSpirit,
  );
  if (!loadout) {
    return null;
  }

  const definition = getPassiveDefinition(loadout.passiveId);
  const maximum =
    definition.effect === 'summon-wolf' || definition.effect === 'summon-fire-spirit'
      ? passiveLevelValue(definition.maximumCountByLevel, loadout.level)
      : 0;
  if (summonCount(state, owner.entityId, kind) >= maximum) {
    return null;
  }

  const isWolf = kind === 'wolf-spirit';
  const baseHp =
    definition.effect === 'summon-wolf'
      ? passiveLevelValue(definition.hpByLevel, loadout.level)
      : 1;
  const hp = scaledSummonStat(owner, baseHp, false);
  const attackPower =
    definition.effect === 'summon-wolf'
      ? scaledSummonStat(owner, passiveLevelValue(definition.attackByLevel, loadout.level), true)
      : 0;
  const summon: SummonEntity = {
    entityId: entityId(state.nextEntityId),
    ownerEntityId: owner.entityId,
    kind,
    position: vec2Mm(owner.position.x, owner.position.z),
    hp,
    maxHp: hp,
    attackPower,
    targetable: isWolf,
    expiresAtTick:
      state.tick +
      (definition.effect === 'summon-wolf' || definition.effect === 'summon-fire-spirit'
        ? definition.durationTicks
        : 0),
    attackCooldownTicks: isWolf ? TICKS_PER_SECOND : 0,
    touchCooldownTicks: 0,
    destroyedByHostileDamage: false,
  };
  state.nextEntityId += 1;
  state.summons.set(summon.entityId, summon);
  events.push({
    type: 'summon-spawned',
    tick: state.tick,
    entityId: summon.entityId,
    ownerEntityId: owner.entityId,
    summonKind: summon.kind,
  });
  return summon;
}

export function spawnScriptedSummons(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  kind: Extract<SummonKind, 'decoy' | 'stone-arhat' | 'bean-soldier'>,
  definition: ScriptedActiveDefinition,
): boolean {
  const count = Math.max(1, definition.summonCount ?? 1);
  for (let index = 0; index < count; index += 1) {
    const offset = vec2Mm((index - Math.trunc(count / 2)) * 900, 0);
    const hp = Math.max(
      1,
      kind === 'decoy' && definition.summonAttributeBasisPoints !== undefined
        ? Math.trunc((owner.maxHp * definition.summonAttributeBasisPoints) / 10_000)
        : (definition.summonHp ?? 1),
    );
    const scaledHp = scaledSummonStat(owner, hp, false);
    const summon: SummonEntity = {
      entityId: entityId(state.nextEntityId),
      ownerEntityId: owner.entityId,
      kind,
      activeAbilityId: definition.id,
      position: vec2Mm(owner.position.x + offset.x, owner.position.z + offset.z),
      hp: scaledHp,
      maxHp: scaledHp,
      attackPower:
        kind === 'decoy'
          ? 0
          : scaledSummonStat(owner, Math.max(0, definition.summonAttack ?? 0), true),
      targetable: true,
      expiresAtTick: state.tick + Math.max(1, definition.durationTicks ?? 1),
      attackCooldownTicks: kind === 'decoy' ? 0 : TICKS_PER_SECOND,
      touchCooldownTicks: 0,
      destroyedByHostileDamage: false,
    };
    state.nextEntityId += 1;
    state.summons.set(summon.entityId, summon);
    events.push({
      type: 'summon-spawned',
      tick: state.tick,
      entityId: summon.entityId,
      ownerEntityId: owner.entityId,
      summonKind: summon.kind,
      activeAbilityId: definition.id,
    });
  }
  return true;
}

export function trySpawnPassiveSummons(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  forcedPassiveId?: PassiveId,
): void {
  const wolf = findPassiveLoadout(owner, PASSIVE_IDS.wolfSpirit);
  if (
    wolf &&
    (forcedPassiveId === PASSIVE_IDS.wolfSpirit ||
      state.random.combat.nextInt(100) < ([6, 8, 10, 12, 15][wolf.level - 1] ?? 0))
  ) {
    spawnSummon(state, events, owner, 'wolf-spirit');
  }

  const fire = findPassiveLoadout(owner, PASSIVE_IDS.fireSpirit);
  if (
    fire &&
    (forcedPassiveId === PASSIVE_IDS.fireSpirit ||
      state.random.combat.nextInt(100) < ([6, 8, 10, 12, 15][fire.level - 1] ?? 0))
  ) {
    spawnSummon(state, events, owner, 'fire-spirit');
  }
}

function nearestEnemy(
  state: MutableSimulationState,
  owner: PlayerEntity,
  position: SummonEntity['position'],
): SummonTarget | undefined {
  const candidates = [...sortedPlayers(state), ...sortedMonsters(state)].filter(
    (target) =>
      target.entityId !== owner.entityId &&
      isLivingTarget(target) &&
      distanceSquaredMm(position, target.position) <= 50_000 * 50_000,
  );
  const requested =
    owner.intent.targetEntityId === null
      ? undefined
      : candidates.find((target) => target.entityId === owner.intent.targetEntityId);
  if (requested) {
    return requested;
  }
  return candidates.sort(
    (left, right) =>
      distanceSquaredMm(position, left.position) - distanceSquaredMm(position, right.position) ||
      Number(left.entityId) - Number(right.entityId),
  )[0];
}

function applySummonAttack(
  state: MutableSimulationState,
  events: SimEvent[],
  summon: SummonEntity,
  owner: PlayerEntity,
  target: SummonTarget,
  amount: number,
  form: 'basic' | 'skill',
  cause: 'passive' | 'active' = 'passive',
): number {
  if (isPlayerTarget(target)) {
    return applyDamage(state, events, {
      sourceEntityId: summon.entityId,
      targetEntityId: target.entityId,
      amount,
      cause,
      form,
      ...(summon.activeAbilityId === undefined
        ? {}
        : { activeAbilityId: summon.activeAbilityId }),
      outgoingDamageBasisPointsOverride: 10_000,
      ignoreExecute: true,
      ignoreSourceBonuses: true,
    });
  }
  return applyMonsterDamage(state, events, summon.entityId, target, amount, owner.element, {
    outgoingDamageBasisPointsOverride: 10_000,
    ignoreExecute: true,
    ignoreSourceBonuses: true,
    ...(summon.activeAbilityId === undefined
      ? {}
      : { activeAbilityId: summon.activeAbilityId }),
  });
}

function advanceWolf(
  state: MutableSimulationState,
  events: SimEvent[],
  summon: SummonEntity,
  owner: PlayerEntity,
): void {
  const target = nearestEnemy(state, owner, summon.position);
  if (!target) {
    summon.position = moveToward(
      summon.position,
      owner.position,
      Math.trunc(4_000 / TICKS_PER_SECOND),
    );
    return;
  }

  const distance = distanceSquaredMm(summon.position, target.position);
  if (distance > 2_000 * 2_000) {
    summon.position = moveToward(
      summon.position,
      target.position,
      Math.trunc(4_000 / TICKS_PER_SECOND),
    );
    return;
  }

  if (summon.attackCooldownTicks > 0) {
    return;
  }
  summon.attackCooldownTicks = TICKS_PER_SECOND;
  applySummonAttack(state, events, summon, owner, target, summon.attackPower, 'skill');
}

function advanceScriptedCombatSummon(
  state: MutableSimulationState,
  events: SimEvent[],
  summon: SummonEntity,
  owner: PlayerEntity,
): void {
  const target = nearestEnemy(state, owner, summon.position);
  if (!target) {
    summon.position = moveToward(
      summon.position,
      owner.position,
      Math.trunc(4_000 / TICKS_PER_SECOND),
    );
    return;
  }
  if (distanceSquaredMm(summon.position, target.position) > 2_000 * 2_000) {
    summon.position = moveToward(
      summon.position,
      target.position,
      Math.trunc(4_000 / TICKS_PER_SECOND),
    );
    return;
  }
  if (summon.attackCooldownTicks > 0 || summon.attackPower <= 0) {
    return;
  }
  summon.attackCooldownTicks = TICKS_PER_SECOND;
  applySummonAttack(state, events, summon, owner, target, summon.attackPower, 'skill', 'active');
}

function advanceFireSpirit(
  state: MutableSimulationState,
  events: SimEvent[],
  summon: SummonEntity,
  owner: PlayerEntity,
): void {
  const offset = FIRE_SPIRIT_OFFSETS[state.tick % FIRE_SPIRIT_OFFSETS.length];
  if (!offset) {
    return;
  }
  summon.position = vec2Mm(owner.position.x + offset.x, owner.position.z + offset.z);
  summon.touchCooldownTicks = Math.max(0, summon.touchCooldownTicks - 1);
  if (summon.touchCooldownTicks > 0) {
    return;
  }

  const target = nearestEnemy(state, owner, summon.position);
  if (!target || distanceSquaredMm(summon.position, target.position) > 1_000 * 1_000) {
    return;
  }
  const loadout = findPassiveLoadout(owner, PASSIVE_IDS.fireSpirit);
  if (!loadout) {
    return;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.fireSpirit);
  if (definition.effect !== 'summon-fire-spirit') {
    return;
  }
  summon.touchCooldownTicks = definition.contactCooldownTicks;
  applySummonAttack(
    state,
    events,
    summon,
    owner,
    target,
    scaledSummonStat(
      owner,
      passiveLevelValue(definition.contactDamageByLevel, loadout.level),
      true,
    ),
    'skill',
  );
  applyFireSpiritBurn(
    state,
    owner.entityId,
    target.entityId,
    definition.burnDamagePerSecond,
    definition.burnDurationTicks,
  );
}

function applyOwnerAreaDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
  center: SummonEntity['position'],
  radiusMm: number,
  amount: number,
): void {
  if (amount <= 0) {
    return;
  }
  const radiusSquared = radiusMm * radiusMm;
  for (const target of [...sortedPlayers(state), ...sortedMonsters(state)]) {
    if (
      target.entityId === owner.entityId ||
      !isLivingTarget(target) ||
      distanceSquaredMm(center, target.position) > radiusSquared
    ) {
      continue;
    }
    if (isPlayerTarget(target)) {
      applyDamage(state, events, {
        sourceEntityId: owner.entityId,
        targetEntityId: target.entityId,
        amount,
        cause: 'passive',
        form: 'skill',
      });
    } else {
      applyMonsterDamage(state, events, owner.entityId, target, amount, owner.element);
    }
  }
  const summonDamage = Math.max(
    1,
    Math.trunc((amount * getOutgoingDamageBasisPoints(owner)) / 10_000),
  );
  for (const target of state.summons.values()) {
    if (
      target.ownerEntityId === owner.entityId ||
      !target.targetable ||
      target.hp <= 0 ||
      distanceSquaredMm(center, target.position) > radiusSquared
    ) {
      continue;
    }
    applySummonDamage(state, events, owner.entityId, target, summonDamage);
  }
}

function resolveSummonDeathEffects(
  state: MutableSimulationState,
  events: SimEvent[],
  summon: SummonEntity,
  owner: PlayerEntity | undefined,
  destroyed: boolean,
): void {
  if (!owner) {
    return;
  }
  const resonance = findPassiveLoadout(owner, PASSIVE_IDS.resonance);
  if (resonance && destroyed) {
    const definition = getPassiveDefinition(PASSIVE_IDS.resonance);
    if (definition.effect === 'summon-resonance') {
      const multiplier =
        resonance.level === 5 ? definition.level5EffectMultiplierBasisPoints : 10_000;
      const heal = scalePassiveMagnitude(
        Math.trunc(
          (passiveLevelValue(definition.healByLevel, resonance.level) * multiplier) / 10_000,
        ),
        owner,
      );
      const aoeDamage = scalePassiveMagnitude(
        Math.trunc(
          (passiveLevelValue(definition.aoeDamageByLevel, resonance.level) * multiplier) / 10_000,
        ),
        owner,
      );
      const before = owner.hp;
      owner.hp = Math.min(owner.maxHp, owner.hp + heal);
      applyOwnerAreaDamage(
        state,
        events,
        owner,
        summon.position,
        definition.aoeRadiusMm,
        aoeDamage,
      );
      events.push({
        type: 'passive-proc',
        tick: state.tick,
        passiveId: PASSIVE_IDS.resonance,
        sourceEntityId: owner.entityId,
        targetEntityId: summon.entityId,
        detail: 'summon-death',
        amount: owner.hp - before,
        durationTicks: 0,
      });
    }
  }

  if (summon.kind === 'stone-statue' && destroyed) {
    const definition = getPassiveDefinition(PASSIVE_IDS.stoneStatue);
    if (definition.effect === 'out-of-combat-statue') {
      applyOwnerAreaDamage(
        state,
        events,
        owner,
        summon.position,
        definition.destructionRadiusMm,
        scalePassiveMagnitude(definition.destructionDamage, owner),
      );
    }
  }
}

function removeSummon(
  state: MutableSimulationState,
  events: SimEvent[],
  summon: SummonEntity,
  destroyed: boolean,
): void {
  if (!state.summons.delete(summon.entityId)) {
    return;
  }
  const owner = state.players.get(summon.ownerEntityId);
  resolveSummonDeathEffects(state, events, summon, owner, destroyed);
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

function spawnStoneStatue(
  state: MutableSimulationState,
  events: SimEvent[],
  owner: PlayerEntity,
): SummonEntity | null {
  const loadout = findPassiveLoadout(owner, PASSIVE_IDS.stoneStatue);
  if (!loadout || summonCount(state, owner.entityId, 'stone-statue') > 0) {
    return null;
  }
  const definition = getPassiveDefinition(PASSIVE_IDS.stoneStatue);
  if (definition.effect !== 'out-of-combat-statue') {
    return null;
  }
  const hp = scaledSummonStat(owner, passiveLevelValue(definition.hpByLevel, loadout.level), false);
  const summon: SummonEntity = {
    entityId: entityId(state.nextEntityId),
    ownerEntityId: owner.entityId,
    kind: 'stone-statue',
    position: vec2Mm(owner.position.x, owner.position.z),
    hp,
    maxHp: hp,
    attackPower: 0,
    targetable: true,
    expiresAtTick: Number.MAX_SAFE_INTEGER,
    attackCooldownTicks: 0,
    touchCooldownTicks: 0,
    destroyedByHostileDamage: false,
  };
  state.nextEntityId += 1;
  state.summons.set(summon.entityId, summon);
  events.push({
    type: 'summon-spawned',
    tick: state.tick,
    entityId: summon.entityId,
    ownerEntityId: owner.entityId,
    summonKind: summon.kind,
  });
  return summon;
}

function ensureStoneStatues(state: MutableSimulationState, events: SimEvent[]): void {
  for (const owner of sortedPlayers(state)) {
    if (owner.lifeState !== 'alive') {
      continue;
    }
    const loadout = findPassiveLoadout(owner, PASSIVE_IDS.stoneStatue);
    if (!loadout) {
      continue;
    }
    const definition = getPassiveDefinition(PASSIVE_IDS.stoneStatue);
    if (
      definition.effect === 'out-of-combat-statue' &&
      state.tick - owner.lastCombatTick >=
        passiveLevelValue(definition.outOfCombatTicksByLevel, loadout.level)
    ) {
      spawnStoneStatue(state, events, owner);
    }
  }
}

function advanceStoneStatue(summon: SummonEntity, owner: PlayerEntity): void {
  if (distanceSquaredMm(summon.position, owner.position) > 2_000 * 2_000) {
    summon.position = moveToward(
      summon.position,
      owner.position,
      Math.trunc(4_000 / TICKS_PER_SECOND),
    );
  }
}

export function advanceSummons(state: MutableSimulationState, events: SimEvent[]): void {
  ensureStoneStatues(state, events);
  const summons = [...state.summons.values()].sort(
    (left, right) => Number(left.entityId) - Number(right.entityId),
  );
  for (const summon of summons) {
    if (!state.summons.has(summon.entityId)) {
      continue;
    }
    if (summon.hp <= 0) {
      removeSummon(state, events, summon, summon.destroyedByHostileDamage);
      continue;
    }
    const owner = state.players.get(summon.ownerEntityId);
    if (summon.kind === 'core-mirror' && !owner) {
      continue;
    }
    if (owner?.lifeState !== 'alive' || summon.expiresAtTick <= state.tick) {
      removeSummon(state, events, summon, false);
      continue;
    }

    summon.attackCooldownTicks = Math.max(0, summon.attackCooldownTicks - 1);
    if (summon.kind === 'wolf-spirit') {
      advanceWolf(state, events, summon, owner);
    } else if (summon.kind === 'fire-spirit') {
      advanceFireSpirit(state, events, summon, owner);
    } else if (summon.kind === 'stone-arhat' || summon.kind === 'bean-soldier') {
      advanceScriptedCombatSummon(state, events, summon, owner);
    } else if (summon.kind === 'decoy') {
      if (distanceSquaredMm(summon.position, owner.position) > 2_000 * 2_000) {
        summon.position = moveToward(
          summon.position,
          owner.position,
          Math.trunc(2_000 / TICKS_PER_SECOND),
        );
      }
    } else {
      advanceStoneStatue(summon, owner);
    }
  }
}
