import {
  type FiveElement,
  M0_RULES,
  MAP_COURTS,
  MAP_DRAGONS,
  MAP_ELITES,
  MAP_MONSTER_SLOTS,
  MAP_PIGS,
} from '@jwgb/content';
import {
  distanceSquaredMm,
  entityId,
  moveToward,
  SeededRng,
  TICKS_PER_SECOND,
  type Vec2Mm,
  vec2Mm,
} from '@jwgb/core';
import { flightTraversal } from '../geometry/wall-traversal';
import { sortedMonsters, sortedPlayers } from '../state';
import type {
  DamageRequest,
  MonsterEntity,
  MonsterKind,
  MonsterRing,
  MutableSimulationState,
  PveSimulationOptions,
  SimEvent,
} from '../types';
import {
  clearPendingActiveReplacementForLoot,
  requestActiveReplacement,
} from './active-replacement';
import { hasDirectLineOfSight } from './active-targeting';
import { advanceCoreBoss, initializeCoreBoss } from './core-boss';
import { applyDamage } from './damage';
import { resolveWorldMovement } from './displacement';
import { grantExperience, grantGeneratedGold } from './equipment-economy';
import {
  clearPendingEquipmentPickupForLoot,
  pickupEquipmentLootResult,
  requestEquipmentLootPickup,
} from './equipment-loot-pickup';
import { equipmentHandCapacity } from './equipment-query';
import { applySkillBook } from './passive';
import { isBasicAttackMissed } from './passive-runtime';
import { isInNormalStormZone } from './storm-zone';
import { canUseWorldResources } from './world-interaction';

const ELEMENTS: readonly FiveElement[] = ['metal', 'wood', 'water', 'fire', 'earth'];
const PVE_HOME_POINTS: readonly Vec2Mm[] = [
  vec2Mm(-92_000, 52_000),
  vec2Mm(-72_000, 78_000),
  vec2Mm(-36_000, 96_000),
  vec2Mm(0, 98_000),
  vec2Mm(36_000, 96_000),
  vec2Mm(72_000, 78_000),
  vec2Mm(92_000, 52_000),
  vec2Mm(98_000, 0),
  vec2Mm(92_000, -52_000),
  vec2Mm(72_000, -78_000),
  vec2Mm(36_000, -96_000),
  vec2Mm(0, -98_000),
  vec2Mm(-36_000, -96_000),
  vec2Mm(-72_000, -78_000),
  vec2Mm(-92_000, -52_000),
  vec2Mm(-98_000, 0),
  vec2Mm(-55_000, 34_000),
  vec2Mm(-18_000, 54_000),
  vec2Mm(18_000, 54_000),
  vec2Mm(55_000, 34_000),
  vec2Mm(55_000, -34_000),
  vec2Mm(18_000, -54_000),
  vec2Mm(-18_000, -54_000),
  vec2Mm(-55_000, -34_000),
];

interface MonsterBaseStats {
  readonly maxHp: number;
  readonly attackPower: number;
  readonly attacksPerSecondMilli: number;
  readonly moveSpeedMmPerSecond: number;
  readonly attackRangeMm: number;
  readonly collisionRadiusMm: number;
  readonly aggroRadiusMm: number;
  readonly leashRadiusMm: number;
}

const MONSTER_BASE_STATS: Readonly<Record<MonsterKind, MonsterBaseStats>> = {
  'ground-melee': {
    maxHp: 300,
    attackPower: 35,
    attacksPerSecondMilli: 800,
    moveSpeedMmPerSecond: 2_500,
    attackRangeMm: 1_500,
    collisionRadiusMm: 500,
    aggroRadiusMm: 10_000,
    leashRadiusMm: 40_000,
  },
  'ground-ranged': {
    maxHp: 240,
    attackPower: 42,
    attacksPerSecondMilli: 800,
    moveSpeedMmPerSecond: 2_500,
    attackRangeMm: 12_000,
    collisionRadiusMm: 500,
    aggroRadiusMm: 12_000,
    leashRadiusMm: 40_000,
  },
  flying: {
    maxHp: 200,
    attackPower: 30,
    attacksPerSecondMilli: 800,
    moveSpeedMmPerSecond: 3_000,
    attackRangeMm: 2_000,
    collisionRadiusMm: 400,
    aggroRadiusMm: 15_000,
    leashRadiusMm: 45_000,
  },
  pig: {
    maxHp: 1_200,
    attackPower: 80,
    attacksPerSecondMilli: 166,
    moveSpeedMmPerSecond: 2_600,
    attackRangeMm: 1_000,
    collisionRadiusMm: 800,
    aggroRadiusMm: 8_000,
    leashRadiusMm: 25_000,
  },
  'elite-tank': {
    maxHp: 7_000,
    attackPower: 120,
    attacksPerSecondMilli: 600,
    moveSpeedMmPerSecond: 2_200,
    attackRangeMm: 2_000,
    collisionRadiusMm: 1_200,
    aggroRadiusMm: 25_000,
    leashRadiusMm: 40_000,
  },
  'elite-ranged': {
    maxHp: 4_000,
    attackPower: 220,
    attacksPerSecondMilli: 1_000,
    moveSpeedMmPerSecond: 2_400,
    attackRangeMm: 8_000,
    collisionRadiusMm: 1_200,
    aggroRadiusMm: 25_000,
    leashRadiusMm: 40_000,
  },
  'dragon-king': {
    maxHp: 10_000,
    attackPower: 200,
    attacksPerSecondMilli: 1_000,
    moveSpeedMmPerSecond: 2_800,
    attackRangeMm: 4_000,
    collisionRadiusMm: 1_500,
    aggroRadiusMm: 30_000,
    leashRadiusMm: 120_000,
  },
  'core-boss': {
    maxHp: 22_000,
    attackPower: 300,
    attacksPerSecondMilli: 1_000,
    moveSpeedMmPerSecond: 2_000,
    attackRangeMm: 5_000,
    collisionRadiusMm: 2_000,
    aggroRadiusMm: 120_000,
    leashRadiusMm: 120_000,
  },
};

const PVE_COUNTS: Readonly<Record<'demo' | 'full', Readonly<Record<MonsterKind, number>>>> = {
  demo: {
    'ground-melee': 3,
    'ground-ranged': 2,
    flying: 1,
    pig: 1,
    'elite-tank': 1,
    'elite-ranged': 0,
    'dragon-king': 0,
    'core-boss': 0,
  },
  full: {
    'ground-melee': 58,
    'ground-ranged': 38,
    flying: 12,
    pig: 8,
    'elite-tank': 2,
    'elite-ranged': 2,
    'dragon-king': 2,
    'core-boss': 1,
  },
};

const MONSTER_KINDS: readonly MonsterKind[] = [
  'ground-melee',
  'ground-ranged',
  'flying',
  'pig',
  'elite-tank',
  'elite-ranged',
  'dragon-king',
  'core-boss',
];

function ringFor(kind: MonsterKind, index: number, mapEnabled: boolean): MonsterRing {
  if (mapEnabled) {
    if (kind === 'ground-melee') {
      return index < 30 ? 'outer' : index < 48 ? 'middle' : 'inner';
    }
    if (kind === 'ground-ranged') {
      return index < 20 ? 'outer' : index < 32 ? 'middle' : 'inner';
    }
    if (kind === 'flying') {
      return index < 8 ? 'middle' : 'outer';
    }
  }

  switch (kind) {
    case 'ground-melee':
    case 'ground-ranged':
      return (['outer', 'middle', 'inner'] as const)[index % 3] ?? 'outer';
    case 'flying':
      return index % 2 === 0 ? 'outer' : 'middle';
    case 'pig':
      return 'den';
    case 'elite-tank':
    case 'elite-ranged':
      return 'middle';
    case 'dragon-king':
      return 'arena';
    case 'core-boss':
      return 'court';
  }
}

function homeFor(
  state: MutableSimulationState,
  kind: MonsterKind,
  kindIndex: number,
  placementIndex: number,
  ring: MonsterRing,
): Vec2Mm {
  if (state.mapField) {
    return mapHome(state.rootSeed, kind, kindIndex);
  }
  if (kind === 'core-boss') {
    return vec2Mm(0, 0);
  }
  if (kind === 'dragon-king') {
    const point = PVE_HOME_POINTS[placementIndex % 8] ?? vec2Mm(0, 0);
    return vec2Mm(Math.trunc(point.x / 2), Math.trunc(point.z / 2));
  }
  const point = PVE_HOME_POINTS[placementIndex % PVE_HOME_POINTS.length] ?? vec2Mm(0, 0);
  const ringOffset = ring === 'inner' ? 8_000 : ring === 'middle' ? 18_000 : 0;
  const sign = placementIndex % 2 === 0 ? 1 : -1;
  return vec2Mm(point.x - sign * ringOffset, point.z + sign * ringOffset);
}

function mapHome(rootSeed: number, kind: MonsterKind, index: number): Vec2Mm {
  if (kind === 'ground-melee' || kind === 'ground-ranged' || kind === 'flying') {
    const code = kind === 'ground-melee' ? 'MEL' : kind === 'ground-ranged' ? 'RNG' : 'FLY';
    const slot = MAP_MONSTER_SLOTS.filter((candidate) => candidate.kind === code)[index];
    if (!slot) {
      throw new Error(`map monster slot ${code}:${index} is missing`);
    }
    return vec2Mm(slot.position.x, slot.position.z);
  }
  if (kind === 'pig') {
    const candidate = MAP_PIGS[candidateIndex(rootSeed, 'pve-pigs', index)];
    if (!candidate) {
      throw new Error(`map pig candidate ${index} is missing`);
    }
    return vec2Mm(candidate.position.x, candidate.position.z);
  }
  if (kind === 'elite-tank' || kind === 'elite-ranged') {
    const candidate = MAP_ELITES[kind === 'elite-tank' ? index : index + 2];
    if (!candidate) {
      throw new Error(`map elite candidate ${index} is missing`);
    }
    return vec2Mm(candidate.position.x, candidate.position.z);
  }
  if (kind === 'dragon-king') {
    const candidate = mapDragon(rootSeed, index);
    return vec2Mm(candidate.position.x, candidate.position.z);
  }
  const court = mapCoreCourt(rootSeed, 0);
  if (!court) {
    throw new Error('map core court is missing');
  }
  return vec2Mm(court.center.x, court.center.z);
}

const DRAGON_ELEMENT_BY_SITE_ID: Readonly<Record<string, FiveElement>> = {
  DK1: 'metal',
  DK2: 'wood',
  DK3: 'water',
  DK4: 'fire',
  DK5: 'earth',
};

function mapDragon(rootSeed: number, requestedIndex: number) {
  const candidate = MAP_DRAGONS[candidateIndex(rootSeed, 'pve-dragons', requestedIndex)];
  if (!candidate) {
    throw new Error(`map dragon candidate ${requestedIndex} is missing`);
  }
  return candidate;
}

function mapDragonElement(rootSeed: number, requestedIndex: number): FiveElement {
  const dragon = mapDragon(rootSeed, requestedIndex);
  const element = DRAGON_ELEMENT_BY_SITE_ID[dragon.id];
  if (!element) {
    throw new Error(`map dragon site ${dragon.id} has no element`);
  }
  return element;
}

function mapCoreCourt(rootSeed: number, requestedIndex: number) {
  return MAP_COURTS[candidateIndex(rootSeed, 'pve-court', requestedIndex)];
}

function candidateIndex(rootSeed: number, streamName: string, requestedIndex: number): number {
  const capacity =
    streamName === 'pve-pigs'
      ? MAP_PIGS.length
      : streamName === 'pve-dragons'
        ? MAP_DRAGONS.length
        : MAP_COURTS.length;
  const indices = Array.from({ length: capacity }, (_, index) => index);
  const random = new SeededRng(rootSeed).fork(streamName);
  for (let index = capacity - 1; index > 0; index -= 1) {
    const selected = random.nextInt(index + 1);
    const swapped = indices[selected] as number;
    indices[selected] = indices[index] as number;
    indices[index] = swapped;
  }
  const selected = indices[requestedIndex];
  if (selected === undefined) {
    throw new Error(`candidate index ${requestedIndex} is out of range`);
  }
  return selected;
}

function kindStats(kind: MonsterKind, ring: MonsterRing, spawnTick: number): MonsterBaseStats {
  const base = MONSTER_BASE_STATS[kind];
  const elapsedMinutes = spawnTick / (60 * TICKS_PER_SECOND);
  const ordinaryHealthMultiplier =
    elapsedMinutes >= 15 ? 1.15 : elapsedMinutes >= 10 ? 1.1 : elapsedMinutes >= 5 ? 1.05 : 1;
  if (kind === 'ground-melee') {
    return {
      ...base,
      maxHp: Math.trunc(
        (ring === 'outer' ? 110 : ring === 'middle' ? 300 : 600) * ordinaryHealthMultiplier,
      ),
      attackPower: ring === 'outer' ? 18 : ring === 'middle' ? 35 : 60,
      attacksPerSecondMilli: ring === 'inner' ? 500 : 800,
    };
  }
  if (kind === 'ground-ranged') {
    return {
      ...base,
      maxHp: Math.trunc(
        (ring === 'outer' ? 88 : ring === 'middle' ? 240 : 480) * ordinaryHealthMultiplier,
      ),
      attackPower: ring === 'outer' ? 22 : ring === 'middle' ? 42 : 72,
      attacksPerSecondMilli: ring === 'inner' ? 500 : 800,
    };
  }
  if (kind === 'flying') {
    return {
      ...base,
      maxHp: Math.trunc(
        (ring === 'outer' ? 80 : ring === 'middle' ? 200 : 400) * ordinaryHealthMultiplier,
      ),
      attackPower: ring === 'outer' ? 15 : ring === 'middle' ? 30 : 50,
    };
  }
  if (
    kind === 'elite-tank' ||
    kind === 'elite-ranged' ||
    kind === 'dragon-king' ||
    kind === 'core-boss'
  ) {
    const hpMultiplier = elapsedMinutes >= 15 ? 1.2 : elapsedMinutes >= 10 ? 1.1 : 1;
    const attackMultiplier =
      (kind === 'dragon-king' || kind === 'core-boss') && elapsedMinutes >= 15
        ? 1.1
        : (kind === 'dragon-king' || kind === 'core-boss') && elapsedMinutes >= 10
          ? 1.05
          : 1;
    const cooldownMultiplier =
      kind === 'core-boss'
        ? elapsedMinutes >= 10
          ? 0.9
          : 1
        : elapsedMinutes >= 15
          ? 0.9
          : elapsedMinutes >= 10
            ? 0.95
            : 1;
    return {
      ...base,
      maxHp: Math.trunc(base.maxHp * hpMultiplier),
      attackPower: Math.trunc(base.attackPower * attackMultiplier),
      attacksPerSecondMilli: Math.trunc(base.attacksPerSecondMilli / cooldownMultiplier),
    };
  }
  return base;
}

function createMonster(
  state: MutableSimulationState,
  kind: MonsterKind,
  ring: MonsterRing,
  element: FiveElement | null,
  homePosition: Vec2Mm,
  courtId: string | null,
): MonsterEntity {
  const stats = kindStats(kind, ring, state.tick);
  const monster: MonsterEntity = {
    entityId: entityId(state.nextEntityId),
    kind,
    ring,
    element,
    position: vec2Mm(homePosition.x, homePosition.z),
    homePosition: vec2Mm(homePosition.x, homePosition.z),
    courtId,
    facing: vec2Mm(0, 1_000),
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    attackPower: stats.attackPower,
    moveSpeedMmPerSecond: stats.moveSpeedMmPerSecond,
    attackRangeMm: stats.attackRangeMm,
    attackPeriodTicks: Math.max(
      1,
      Math.ceil((TICKS_PER_SECOND * 1_000) / stats.attacksPerSecondMilli),
    ),
    attackCooldownTicks: 0,
    collisionRadiusMm: stats.collisionRadiusMm,
    aggroRadiusMm: stats.aggroRadiusMm,
    leashRadiusMm: stats.leashRadiusMm,
    targetEntityId: null,
    spawnTick: state.tick,
    invulnerableTicks: TICKS_PER_SECOND,
    hardControlTicks: 0,
    slowTicks: 0,
    slowBasisPoints: 10_000,
    silenceTicks: 0,
    silenceCooldownPenaltyTicks: 0,
    blindTicks: 0,
    blindMissPercent: 0,
    blindPreventsCritical: false,
    polymorphTicks: 0,
    polymorphSpeedBonusPercent: 0,
    displacementLockTicks: 0,
  };
  state.nextEntityId += 1;
  state.monsters.set(monster.entityId, monster);
  return monster;
}

function spawnMonster(
  state: MutableSimulationState,
  events: SimEvent[],
  kind: MonsterKind,
  ring: MonsterRing,
  element: FiveElement | null,
  homePosition: Vec2Mm,
  courtId: string | null,
): MonsterEntity {
  const monster = createMonster(state, kind, ring, element, homePosition, courtId);
  events.push({
    type: 'monster-spawned',
    tick: state.tick,
    entityId: monster.entityId,
    kind: monster.kind,
  });
  if (monster.kind === 'core-boss') {
    initializeCoreBoss(state, monster);
  }
  return monster;
}

export function initializePve(
  state: MutableSimulationState,
  events: SimEvent[],
  options: PveSimulationOptions,
): void {
  if (!options.enabled) {
    return;
  }
  const counts = PVE_COUNTS[options.population ?? 'demo'];
  let placementIndex = 0;
  for (const kind of MONSTER_KINDS) {
    for (let index = 0; index < (counts[kind] ?? 0); index += 1) {
      const ring = ringFor(kind, index, state.mapField !== null);
      const homePosition = homeFor(state, kind, index, placementIndex, ring);
      const element =
        kind === 'dragon-king' && state.mapField
          ? mapDragonElement(state.rootSeed, index)
          : kind === 'pig' || kind === 'dragon-king'
            ? (ELEMENTS[placementIndex % ELEMENTS.length] ?? 'metal')
            : null;
      const courtId =
        kind === 'core-boss' && state.mapField
          ? (mapCoreCourt(state.rootSeed, 0)?.id ?? null)
          : null;
      spawnMonster(state, events, kind, ring, element, homePosition, courtId);
      placementIndex += 1;
    }
  }
}

function nearestLivingPlayer(
  state: MutableSimulationState,
  monster: MonsterEntity,
): ReturnType<typeof sortedPlayers>[number] | undefined {
  return sortedPlayers(state)
    .filter(
      (player) =>
        player.lifeState === 'alive' &&
        (!(player.stealthTicks > 0 || player.nightCloakStealthed) ||
          (monster.kind === 'core-boss' &&
            distanceSquaredMm(monster.position, player.position) <= 10_000 * 10_000)),
    )
    .map((player) => ({
      player,
      distance: distanceSquaredMm(monster.position, player.position),
    }))
    .filter(({ distance }) => distance <= monster.aggroRadiusMm * monster.aggroRadiusMm)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        Number(left.player.entityId) - Number(right.player.entityId),
    )
    .find(({ player }) =>
      hasDirectLineOfSight(
        state,
        monster.position,
        player.position,
        monster.collisionRadiusMm,
        monsterTraversal(monster),
      ),
    )?.player;
}

/** Flying monsters cross flight-passable walls up to 2.5 m; everything else walks. */
function monsterTraversal(monster: MonsterEntity) {
  return flightTraversal(monster.kind === 'flying' ? 2_500 : 0);
}

function advanceMonster(
  state: MutableSimulationState,
  events: SimEvent[],
  monster: MonsterEntity,
): void {
  monster.attackCooldownTicks = Math.max(0, monster.attackCooldownTicks - 1);
  monster.invulnerableTicks = Math.max(0, monster.invulnerableTicks - 1);
  monster.hardControlTicks = Math.max(0, monster.hardControlTicks - 1);
  monster.slowTicks = Math.max(0, monster.slowTicks - 1);
  if (monster.slowTicks === 0) {
    monster.slowBasisPoints = 10_000;
  }

  if (monster.hardControlTicks > 0) {
    return;
  }

  const scriptedSpeed = Math.trunc(
    (monster.moveSpeedMmPerSecond *
      (100 + (monster.polymorphTicks > 0 ? monster.polymorphSpeedBonusPercent : 0))) /
      100,
  );

  const existingTarget =
    monster.targetEntityId === null ? undefined : state.players.get(monster.targetEntityId);
  const existingTargetIsLegal =
    existingTarget?.lifeState === 'alive' &&
    distanceSquaredMm(monster.homePosition, existingTarget.position) <=
      monster.leashRadiusMm * monster.leashRadiusMm &&
    hasDirectLineOfSight(
      state,
      monster.position,
      existingTarget.position,
      monster.collisionRadiusMm,
      monsterTraversal(monster),
    );
  const target = existingTargetIsLegal ? existingTarget : nearestLivingPlayer(state, monster);
  monster.targetEntityId = target?.entityId ?? null;

  if (!target) {
    const previous = monster.position;
    const requested = moveToward(
      monster.position,
      monster.homePosition,
      Math.trunc((scriptedSpeed * monster.slowBasisPoints) / (TICKS_PER_SECOND * 10_000)),
    );
    monster.position = resolveWorldMovement(
      state,
      previous,
      requested,
      monster.collisionRadiusMm,
      monsterTraversal(monster),
    );
    return;
  }

  const distance = distanceSquaredMm(monster.position, target.position);
  const attackRangeSquared =
    (monster.attackRangeMm + M0_RULES.playerCapsuleRadiusMm) *
    (monster.attackRangeMm + M0_RULES.playerCapsuleRadiusMm);
  if (distance > attackRangeSquared) {
    const previous = monster.position;
    const requested = moveToward(
      monster.position,
      target.position,
      Math.trunc((scriptedSpeed * monster.slowBasisPoints) / (TICKS_PER_SECOND * 10_000)),
    );
    monster.position = resolveWorldMovement(
      state,
      previous,
      requested,
      monster.collisionRadiusMm,
      monsterTraversal(monster),
    );
    const dx = target.position.x - monster.position.x;
    const dz = target.position.z - monster.position.z;
    monster.facing = vec2Mm(
      dx === 0 ? 0 : dx > 0 ? 1_000 : -1_000,
      dz === 0 ? 0 : dz > 0 ? 1_000 : -1_000,
    );
    return;
  }

  if (
    monster.attackCooldownTicks > 0 ||
    target.lifeState !== 'alive' ||
    monster.polymorphTicks > 0 ||
    !hasDirectLineOfSight(
      state,
      monster.position,
      target.position,
      monster.collisionRadiusMm,
      monsterTraversal(monster),
    )
  ) {
    return;
  }
  monster.attackCooldownTicks = monster.attackPeriodTicks;
  if (isBasicAttackMissed(state, monster)) {
    return;
  }
  const request: DamageRequest = {
    sourceEntityId: monster.entityId,
    targetEntityId: target.entityId,
    amount: monster.attackPower,
    cause: 'monster',
    form: 'basic',
    outgoingDamageBasisPointsOverride: 10_000,
  };
  applyDamage(state, events, request);
}

function collectNearbyLoot(state: MutableSimulationState, events: SimEvent[]): void {
  for (const player of sortedPlayers(state)) {
    if (!player.intent.interact || !canUseWorldResources(player)) {
      continue;
    }
    const drop = [...state.lootDrops.values()]
      .filter(
        (candidate) =>
          distanceSquaredMm(player.position, candidate.position) <= 2_500 * 2_500 &&
          candidate.expiresAtTick > state.tick &&
          hasDirectLineOfSight(state, player.position, candidate.position),
      )
      .sort(
        (left, right) =>
          distanceSquaredMm(player.position, left.position) -
            distanceSquaredMm(player.position, right.position) ||
          Number(left.entityId) - Number(right.entityId),
      )[0];
    if (!drop) {
      continue;
    }
    if (drop.bookPassiveId !== null || drop.kind === 'skill-book') {
      const bookPassiveId = drop.bookPassiveId;
      if (bookPassiveId === null || !applySkillBook(state, events, player, bookPassiveId)) {
        continue;
      }
      state.lootDrops.delete(drop.entityId);
      events.push({
        type: 'loot-collected',
        tick: state.tick,
        entityId: drop.entityId,
        collectorEntityId: player.entityId,
        gold: 0,
        experience: 0,
        gems: 0,
        equipmentId: null,
        bookPassiveId,
        activeId: null,
        ...(drop.kind === undefined ? {} : { lootKind: drop.kind }),
      });
      continue;
    }
    if (drop.activeId !== undefined && drop.activeId !== null) {
      requestActiveReplacement(state, events, player, drop);
      continue;
    }
    if (drop.equipmentId !== null) {
      if (player.inventoryEquipment.length >= equipmentHandCapacity(player)) {
        requestEquipmentLootPickup(state, events, player, drop);
      } else {
        pickupEquipmentLootResult(state, events, player.entityId, drop.entityId, 'inventory', null);
      }
      continue;
    }
    state.lootDrops.delete(drop.entityId);
    const collectedGold = grantGeneratedGold(player, drop.gold);
    const collectedExperience = grantExperience(player, drop.experience);
    player.gems += drop.gems;
    events.push({
      type: 'loot-collected',
      tick: state.tick,
      entityId: drop.entityId,
      collectorEntityId: player.entityId,
      gold: collectedGold,
      experience: collectedExperience,
      gems: drop.gems,
      equipmentId: drop.equipmentId,
      bookPassiveId: null,
      activeId: null,
      ...(drop.kind === undefined ? {} : { lootKind: drop.kind }),
    });
  }
}

function advanceRespawns(state: MutableSimulationState, events: SimEvent[]): void {
  const pending = state.monsterRespawns.splice(0, state.monsterRespawns.length);
  for (const respawn of pending) {
    if (respawn.respawnAtTick > state.tick) {
      state.monsterRespawns.push(respawn);
      continue;
    }
    spawnMonster(
      state,
      events,
      respawn.kind,
      respawn.ring,
      respawn.element,
      respawn.homePosition,
      respawn.courtId,
    );
  }
}

function expireLoot(state: MutableSimulationState, events: SimEvent[]): void {
  for (const drop of state.lootDrops.values()) {
    const persistent =
      drop.kind === 'equipment' ||
      drop.kind === 'death-equipment' ||
      drop.kind === 'skill-book' ||
      drop.kind === 'active';
    if (!persistent && drop.expiresAtTick <= state.tick) {
      state.lootDrops.delete(drop.entityId);
      events.push({
        type: 'loot-expired',
        tick: state.tick,
        entityId: drop.entityId,
        lootKind: drop.kind,
        reason: 'natural-expiry',
      });
      continue;
    }
    if (!persistent) {
      continue;
    }
    const covered =
      state.tick >= 1_200 * TICKS_PER_SECOND || isInNormalStormZone(state, drop.position);
    if (covered) {
      const coveredSince = drop.stormCoveredSinceTick ?? state.tick;
      if (state.tick - coveredSince >= 60 * TICKS_PER_SECOND) {
        state.lootDrops.delete(drop.entityId);
        clearPendingActiveReplacementForLoot(state, events, drop.entityId);
        clearPendingEquipmentPickupForLoot(state, events, drop.entityId);
        events.push({
          type: 'loot-expired',
          tick: state.tick,
          entityId: drop.entityId,
          lootKind: drop.kind,
          reason: 'storm',
        });
      } else if (drop.stormCoveredSinceTick !== coveredSince) {
        state.lootDrops.set(drop.entityId, {
          ...drop,
          stormCoveredSinceTick: coveredSince,
        });
      }
    } else if (drop.stormCoveredSinceTick !== null && drop.stormCoveredSinceTick !== undefined) {
      state.lootDrops.set(drop.entityId, {
        ...drop,
        stormCoveredSinceTick: null,
      });
    }
  }
}

export function advancePve(state: MutableSimulationState, events: SimEvent[]): void {
  if (!state.pveEnabled || state.match.status !== 'running') {
    return;
  }
  advanceRespawns(state, events);
  expireLoot(state, events);
  advanceCoreBoss(state, events);
  for (const monster of sortedMonsters(state)) {
    if (state.monsters.has(monster.entityId)) {
      advanceMonster(state, events, monster);
    }
  }
  collectNearbyLoot(state, events);
}
