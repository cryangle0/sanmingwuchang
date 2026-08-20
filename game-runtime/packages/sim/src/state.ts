import {
  getActiveDefinition,
  getEquipmentDefinition,
  getEquipmentStatTotals,
  getHeroDefinition,
  getPassiveDefinition,
  M0_RULES,
  M0_SPAWN_POINTS,
  MAP_BOUNDARY,
  MAP_COURTS,
  MAP_GEOMETRY_HASH,
  MAP_INITIAL_SAFE_RADIUS_MM,
  MAP_SPAWN_POINTS,
  MAP_WALL_PIECES,
} from '@jwgb/content';
import {
  assertSafeInteger,
  type EntityId,
  entityId,
  equipmentInstanceId,
  invariant,
  neutralIntent,
  SeededRng,
  TICKS_PER_SECOND,
  type Vec2Mm,
  vec2Mm,
} from '@jwgb/core';
import { MapCollisionField } from './geometry/map-collision-field';
import { initialStormZone } from './systems/storm-zone';
import type {
  AddPlayerOptions,
  MapSimulationOptions,
  MonsterEntity,
  MutableSimulationState,
  PlayerEntity,
  PveSimulationOptions,
  RandomStreams,
  StaticSolidRect,
} from './types';

function createRandomStreams(rootSeed: number): RandomStreams {
  const root = new SeededRng(rootSeed);
  return {
    spawn: root.fork('spawn'),
    combat: root.fork('combat'),
    storm: root.fork('storm'),
    stormLayout: root.fork('storm-layout'),
    shop: root.fork('shop'),
    blackMountain: root.fork('black-mountain'),
    airdrop: root.fork('airdrop'),
  };
}

function compareStableText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function normalizeStaticSolids(solids: readonly StaticSolidRect[]): StaticSolidRect[] {
  const solidIds = new Set<string>();
  const normalized = solids.map((solid) => {
    invariant(solid.solidId.trim().length > 0, 'static solid id must not be empty');
    invariant(!solidIds.has(solid.solidId), `duplicate static solid ${solid.solidId}`);
    solidIds.add(solid.solidId);
    assertSafeInteger(solid.minimumX, `${solid.solidId}.minimumX`);
    assertSafeInteger(solid.maximumX, `${solid.solidId}.maximumX`);
    assertSafeInteger(solid.minimumZ, `${solid.solidId}.minimumZ`);
    assertSafeInteger(solid.maximumZ, `${solid.solidId}.maximumZ`);
    invariant(solid.minimumX < solid.maximumX, `${solid.solidId} must have positive width`);
    invariant(solid.minimumZ < solid.maximumZ, `${solid.solidId} must have positive depth`);
    return { ...solid };
  });
  return normalized.sort((left, right) => compareStableText(left.solidId, right.solidId));
}

export function createSimulationState(
  rootSeed: number,
  staticSolids: readonly StaticSolidRect[] = [],
  pve: PveSimulationOptions = { enabled: false },
  map: MapSimulationOptions = { enabled: false },
): MutableSimulationState {
  const random = createRandomStreams(rootSeed);
  return {
    tick: 0,
    rootSeed: rootSeed >>> 0,
    arenaRadiusMm: map.enabled ? MAP_INITIAL_SAFE_RADIUS_MM : M0_RULES.arenaRadiusMm,
    players: new Map(),
    windWalls: new Map(),
    projectiles: new Map(),
    activeProjectiles: new Map(),
    activeZones: new Map(),
    activeTargetEffects: new Map(),
    playerHistoryFrames: [],
    monsters: new Map(),
    lootDrops: new Map(),
    summons: new Map(),
    afterimages: new Map(),
    bountyMarks: [],
    activeLootReveals: new Map(),
    equipmentReveals: new Map(),
    airdrops: new Map(),
    airdropChannels: new Map(),
    shops: new Map(),
    terminalShopAssignments: new Map(),
    monsterRespawns: [],
    coreBossRuntimes: new Map(),
    coreBossHazards: new Map(),
    coreBossRevealAnchors: new Map(),
    coreBossThreat: new Map(),
    pendingActiveReplacements: new Map(),
    pendingEquipmentPickups: new Map(),
    pveEnabled: pve.enabled,
    pvePopulation: pve.population ?? 'demo',
    staticSolids: normalizeStaticSolids(staticSolids),
    mapField: map.enabled
      ? new MapCollisionField(MAP_GEOMETRY_HASH, MAP_BOUNDARY, MAP_WALL_PIECES)
      : null,
    mapGeometryHash: map.enabled ? MAP_GEOMETRY_HASH : null,
    entityIdByPlayerId: new Map(),
    random,
    stormZone: initialStormZone(
      map.enabled ? (MAP_COURTS[random.stormLayout.nextInt(MAP_COURTS.length)]?.id ?? null) : null,
    ),
    initialSpawnIndices: new Set(),
    consumedB20PlayerIds: new Set(),
    passiveTargetStates: new Map(),
    eliminationOrder: [],
    eliminationTicks: new Map(),
    match: {
      status: 'waiting',
      startedAtTick: null,
      finishedAtTick: null,
      outcome: null,
      winnerEntityId: null,
      winnerEntityIds: [],
      placements: [],
      placementGroups: [],
      voidAbortReason: null,
      mmrEligible: false,
      cultivationAwards: [],
      diagnosticReplayRequired: false,
    },
    nextEntityId: 1,
    nextEquipmentInstanceId: 1,
    nextShieldSequence: 1,
    nextAirdropChannelSequence: 1,
    goldenCudgelDropped: false,
  };
}

interface SpawnSelection {
  readonly position: Vec2Mm;
  readonly facing: Vec2Mm;
}

function spawnCapacity(state: MutableSimulationState): number {
  return state.mapField ? MAP_SPAWN_POINTS.length : M0_SPAWN_POINTS.length;
}

function takeInitialSpawn(state: MutableSimulationState): SpawnSelection {
  const capacity = spawnCapacity(state);
  invariant(state.initialSpawnIndices.size < capacity, 'spawn capacity exhausted');

  const availableIndices: number[] = [];
  for (let index = 0; index < capacity; index += 1) {
    if (!state.initialSpawnIndices.has(index)) {
      availableIndices.push(index);
    }
  }
  const chosenIndex = availableIndices[state.random.spawn.nextInt(availableIndices.length)];
  invariant(chosenIndex !== undefined, 'spawn selection failed');
  state.initialSpawnIndices.add(chosenIndex);

  if (state.mapField) {
    const spawn = MAP_SPAWN_POINTS[chosenIndex];
    invariant(spawn !== undefined, 'map spawn point missing');
    return {
      position: vec2Mm(spawn.position.x, spawn.position.z),
      facing: vec2Mm(spawn.facing.x, spawn.facing.z),
    };
  }
  const position = M0_SPAWN_POINTS[chosenIndex];
  invariant(position !== undefined, 'spawn point missing');
  return { position: vec2Mm(position.x, position.z), facing: vec2Mm(0, 1_000) };
}

export function addPlayerToState(
  state: MutableSimulationState,
  options: AddPlayerOptions,
): PlayerEntity {
  invariant(state.players.size < spawnCapacity(state), 'player capacity exhausted');
  invariant(
    !state.entityIdByPlayerId.has(options.playerId),
    `duplicate player ${options.playerId}`,
  );

  const hero = getHeroDefinition(options.heroId);
  const activeAbilityId = options.activeAbilityId ?? hero.active.id;
  getActiveDefinition(activeAbilityId);
  const passives = (options.passives ?? []).map((entry) => {
    getPassiveDefinition(entry.passiveId);
    invariant(
      Number.isInteger(entry.level) && entry.level >= 1 && entry.level <= 5,
      `invalid passive level: ${entry.level}`,
    );
    return { ...entry };
  });
  invariant(passives.length <= 4, 'passive loadout capacity exceeded');
  invariant(
    new Set(passives.map((entry) => entry.passiveId)).size === passives.length,
    'duplicate passive in loadout',
  );
  const equipmentIds = options.equipmentIds ?? [];
  invariant(equipmentIds.length <= 3, 'equipped equipment capacity exceeded');
  invariant(new Set(equipmentIds).size === equipmentIds.length, 'duplicate equipped equipment');
  for (const id of equipmentIds) {
    getEquipmentDefinition(id);
  }
  const equipmentStats = getEquipmentStatTotals(equipmentIds);

  const newEntityId = entityId(state.nextEntityId);
  state.nextEntityId += 1;
  const spawn: SpawnSelection = options.position
    ? { position: vec2Mm(options.position.x, options.position.z), facing: vec2Mm(0, 1_000) }
    : takeInitialSpawn(state);
  const equipment = equipmentIds.map((id) => {
    const instance = {
      instanceId: equipmentInstanceId(state.nextEquipmentInstanceId),
      equipmentId: id,
      acquiredAtTick: state.tick,
      permanentAttackBonus: 0,
    };
    state.nextEquipmentInstanceId += 1;
    return instance;
  });
  const attacksPerSecondMilli = Math.trunc(
    (hero.level1.attacksPerSecondMilli * (100 + equipmentStats.attackSpeedPercent)) / 100,
  );
  const attackPeriodTicks = Math.ceil((TICKS_PER_SECOND * 1_000) / attacksPerSecondMilli);
  const maxHp = hero.level1.maxHp + equipmentStats.maxHpFlat;

  const player: PlayerEntity = {
    entityId: newEntityId,
    playerId: options.playerId,
    heroId: options.heroId,
    basicAttackKind: hero.basicAttackKind,
    element: hero.element,
    activeAbilityId,
    position: spawn.position,
    facing: spawn.facing,
    hp: maxHp,
    maxHp,
    attackPower: hero.level1.attack + equipmentStats.attackFlat,
    moveSpeedMmPerSecond: hero.level1.moveSpeedMmPerSecond + equipmentStats.moveSpeedFlat,
    attackRangeMm: hero.level1.attackRangeMm + equipmentStats.basicAttackRangeFlatMm,
    attacksPerSecondMilli,
    attackPeriodTicks,
    attackCooldownTicks: 0,
    activeCooldownTicks: 0,
    activeBuffTicks: 0,
    armedCriticalTicks: 0,
    armedMissingHpDamagePercent: 0,
    armedActiveId: null,
    activeLifestealTicks: 0,
    activeLifestealPercent: 0,
    activeDamageReductionTicks: 0,
    activeDamageReductionBasisPoints: 10_000,
    activeSpeedBonusTicks: 0,
    activeSpeedBonusPercent: 0,
    worldInteractionLockTicks: 0,
    polymorphTicks: 0,
    polymorphSpeedBonusPercent: 0,
    stealthTicks: 0,
    dormantBootsSpeedTicks: 0,
    dormantBootsCooldownTicks: 0,
    dormantBootsStealthEpisodeActive: false,
    dormantBootsTriggeredThisEpisode: false,
    displacementLockTicks: 0,
    treasureSenseTicks: 0,
    activeBountyStreak: 0,
    hardControlTicks: 0,
    slowTicks: 0,
    slowBasisPoints: 10_000,
    silenceTicks: 0,
    silenceCooldownPenaltyTicks: 0,
    blindTicks: 0,
    blindMissPercent: 0,
    blindPreventsCritical: false,
    b15SpeedBoostTicks: 0,
    b15SpeedBonusPercent: 0,
    b25NextBasicBonusPercent: 0,
    b25AttackSpeedBoostTicks: 0,
    b25AttackSpeedBonusPercent: 0,
    b27SpeedBoostTicks: 0,
    b27SpeedBonusPercent: 0,
    b36Stacks: 0,
    b36MovingTicks: 0,
    b38NextHealTick: 0,
    b21FirstHitReady: false,
    b30NextAfterimageTick: 0,
    b40KillCount: 0,
    b40BonusMaxHp: 0,
    b42SpeedBoostTicks: 0,
    b42SpeedBonusPercent: 0,
    lastCombatTick: 0,
    whirlwindTicks: 0,
    whirlwindNextPulseTick: 0,
    b19RetriggerLockTicks: 0,
    b20ReviveBuffTicks: 0,
    invulnerableTicks: 0,
    iceCoffinTicks: 0,
    nightCloakStillTicks: 0,
    nightCloakStealthed: false,
    flightActive: false,
    taibaiChannelTicks: 0,
    taibaiTargetHeroId: null,
    taibaiCooldownTicks: 0,
    heishanGambleCount: 0,
    consumableVisionTicks: 0,
    consumableRevealTicks: 0,
    passives,
    equipment,
    inventoryEquipment: [],
    gold: 500,
    experience: 0,
    level: 1,
    gems: 0,
    pvpCombatTicks: 0,
    shields: [],
    livesRemaining: M0_RULES.playerLives,
    trueDeaths: 0,
    lifeState: 'alive',
    respawnTarget: null,
    respawnFlightDeadlineTick: 0,
    respawnRetryUntilTick: 0,
    respawnAttemptCount: 0,
    reviveProtectionTicks: 0,
    moveRemainderX: 0,
    moveRemainderZ: 0,
    intent: neutralIntent(),
  };

  state.players.set(newEntityId, player);
  state.entityIdByPlayerId.set(options.playerId, newEntityId);
  return player;
}

export function sortedPlayers(state: MutableSimulationState): PlayerEntity[] {
  return [...state.players.values()].sort(
    (left, right) => Number(left.entityId) - Number(right.entityId),
  );
}

export function sortedMonsters(state: MutableSimulationState): MonsterEntity[] {
  return [...state.monsters.values()].sort(
    (left, right) => Number(left.entityId) - Number(right.entityId),
  );
}

export function getRequiredPlayer(
  state: MutableSimulationState,
  targetEntityId: EntityId,
): PlayerEntity {
  const player = state.players.get(targetEntityId);
  invariant(player, `unknown entity ${targetEntityId}`);
  return player;
}

export function getRequiredMonster(
  state: MutableSimulationState,
  targetEntityId: EntityId,
): MonsterEntity {
  const monster = state.monsters.get(targetEntityId);
  invariant(monster, `unknown monster entity ${targetEntityId}`);
  return monster;
}
