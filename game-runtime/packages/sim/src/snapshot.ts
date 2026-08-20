import { distanceSquaredMm, type EntityId, stableHash32, vec2Mm } from '@jwgb/core';
import { sortedPlayers } from './state';
import { canSeeActiveTarget, hasDirectLineOfSight } from './systems/active-targeting';
import { equipmentVisionRangeMm } from './systems/equipment-query';
import { hasAvailableB20Charge, hasNineTurnPill } from './systems/lethal-protection';
import { getTotalShield } from './systems/shield';
import type {
  ActiveLootRevealSnapshot,
  ActiveProjectileSnapshot,
  ActiveTargetEffectSnapshot,
  ActiveZoneSnapshot,
  AfterimageSnapshot,
  AirdropChannelSnapshot,
  AirdropSnapshot,
  BountyMarkSnapshot,
  EquipmentRevealSnapshot,
  LootSnapshot,
  MonsterRespawnSnapshot,
  MonsterSnapshot,
  MutableSimulationState,
  PassiveTargetSnapshot,
  PendingActiveReplacementSnapshot,
  PendingEquipmentPickupSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  ShopSnapshot,
  SimEvent,
  SummonSnapshot,
  WindWallSnapshot,
  WorldSnapshot,
} from './types';

function playerSnapshot(
  state: MutableSimulationState,
  player: ReturnType<typeof sortedPlayers>[number],
): PlayerSnapshot {
  return {
    entityId: player.entityId,
    playerId: player.playerId,
    heroId: player.heroId,
    activeAbilityId: player.activeAbilityId,
    position: vec2Mm(player.position.x, player.position.z),
    facing: vec2Mm(player.facing.x, player.facing.z),
    hp: player.hp,
    maxHp: player.maxHp,
    attackPower: player.attackPower,
    moveSpeedMmPerSecond: player.moveSpeedMmPerSecond,
    attackRangeMm: player.attackRangeMm,
    attacksPerSecondMilli: player.attacksPerSecondMilli,
    livesRemaining: player.livesRemaining,
    trueDeaths: player.trueDeaths,
    lifeState: player.lifeState,
    attackCooldownTicks: player.attackCooldownTicks,
    activeCooldownTicks: player.activeCooldownTicks,
    activeBuffTicks: player.activeBuffTicks,
    armedCriticalTicks: player.armedCriticalTicks,
    armedMissingHpDamagePercent: player.armedMissingHpDamagePercent,
    armedActiveId: player.armedActiveId,
    activeLifestealTicks: player.activeLifestealTicks,
    activeLifestealPercent: player.activeLifestealPercent,
    activeDamageReductionTicks: player.activeDamageReductionTicks,
    activeDamageReductionBasisPoints: player.activeDamageReductionBasisPoints,
    activeSpeedBonusTicks: player.activeSpeedBonusTicks,
    activeSpeedBonusPercent: player.activeSpeedBonusPercent,
    worldInteractionLockTicks: player.worldInteractionLockTicks,
    polymorphTicks: player.polymorphTicks,
    polymorphSpeedBonusPercent: player.polymorphSpeedBonusPercent,
    stealthTicks: player.stealthTicks,
    dormantBootsSpeedTicks: player.dormantBootsSpeedTicks,
    dormantBootsCooldownTicks: player.dormantBootsCooldownTicks,
    dormantBootsStealthEpisodeActive: player.dormantBootsStealthEpisodeActive,
    dormantBootsTriggeredThisEpisode: player.dormantBootsTriggeredThisEpisode,
    displacementLockTicks: player.displacementLockTicks,
    treasureSenseTicks: player.treasureSenseTicks,
    activeBountyStreak: player.activeBountyStreak,
    hardControlTicks: player.hardControlTicks,
    slowTicks: player.slowTicks,
    slowBasisPoints: player.slowBasisPoints,
    silenceTicks: player.silenceTicks,
    silenceCooldownPenaltyTicks: player.silenceCooldownPenaltyTicks,
    blindTicks: player.blindTicks,
    blindMissPercent: player.blindMissPercent,
    blindPreventsCritical: player.blindPreventsCritical,
    b15SpeedBoostTicks: player.b15SpeedBoostTicks,
    b15SpeedBonusPercent: player.b15SpeedBonusPercent,
    b21FirstHitReady: player.b21FirstHitReady,
    b25NextBasicBonusPercent: player.b25NextBasicBonusPercent,
    b25AttackSpeedBoostTicks: player.b25AttackSpeedBoostTicks,
    b25AttackSpeedBonusPercent: player.b25AttackSpeedBonusPercent,
    b27SpeedBoostTicks: player.b27SpeedBoostTicks,
    b27SpeedBonusPercent: player.b27SpeedBonusPercent,
    b30NextAfterimageTick: player.b30NextAfterimageTick,
    b36Stacks: player.b36Stacks,
    b36MovingTicks: player.b36MovingTicks,
    b38NextHealTick: player.b38NextHealTick,
    b40KillCount: player.b40KillCount,
    b40BonusMaxHp: player.b40BonusMaxHp,
    b42SpeedBoostTicks: player.b42SpeedBoostTicks,
    b42SpeedBonusPercent: player.b42SpeedBonusPercent,
    lastCombatTick: player.lastCombatTick,
    pvpCombatTicks: player.pvpCombatTicks,
    totalShield: getTotalShield(player),
    whirlwindTicks: player.whirlwindTicks,
    whirlwindNextPulseTick: player.whirlwindNextPulseTick,
    b19RetriggerLockTicks: player.b19RetriggerLockTicks,
    b20ReviveBuffTicks: player.b20ReviveBuffTicks,
    invulnerableTicks: player.invulnerableTicks,
    iceCoffinTicks: player.iceCoffinTicks,
    nightCloakStillTicks: player.nightCloakStillTicks,
    nightCloakStealthed: player.nightCloakStealthed,
    flightActive: player.flightActive,
    taibaiChannelTicks: player.taibaiChannelTicks,
    taibaiTargetHeroId: player.taibaiTargetHeroId,
    taibaiCooldownTicks: player.taibaiCooldownTicks,
    heishanGambleCount: player.heishanGambleCount,
    consumableVisionTicks: player.consumableVisionTicks,
    consumableRevealTicks: player.consumableRevealTicks,
    attackPeriodTicks: player.attackPeriodTicks,
    respawnTarget: player.respawnTarget
      ? vec2Mm(player.respawnTarget.x, player.respawnTarget.z)
      : null,
    respawnFlightDeadlineTick: player.respawnFlightDeadlineTick,
    respawnRetryUntilTick: player.respawnRetryUntilTick,
    respawnAttemptCount: player.respawnAttemptCount,
    reviveProtectionTicks: player.reviveProtectionTicks,
    moveRemainderX: player.moveRemainderX,
    moveRemainderZ: player.moveRemainderZ,
    intent: { ...player.intent },
    b20ChargeAvailable: hasAvailableB20Charge(state, player),
    hasNineTurnPill: hasNineTurnPill(player),
    passives: player.passives.map((entry) => ({ ...entry })),
    equipment: player.equipment.map((instance) => ({ ...instance })),
    inventoryEquipment: player.inventoryEquipment.map((instance) => ({ ...instance })),
    gold: player.gold,
    experience: player.experience,
    level: player.level,
    gems: player.gems,
    shields: player.shields
      .map((shield) => ({
        source: { ...shield.source },
        expiresAtTick: shield.expiresAtTick,
        creationSequence: shield.creationSequence,
        absorbs: [...shield.absorbs],
        breakEffect: shield.breakEffect ? { ...shield.breakEffect } : null,
        remainingAmount: shield.remainingAmount,
      }))
      .sort((left, right) => left.creationSequence - right.creationSequence),
  };
}

function monsterSnapshots(state: MutableSimulationState): MonsterSnapshot[] {
  return [...state.monsters.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((monster) => ({
      entityId: monster.entityId,
      kind: monster.kind,
      ring: monster.ring,
      element: monster.element,
      position: vec2Mm(monster.position.x, monster.position.z),
      homePosition: vec2Mm(monster.homePosition.x, monster.homePosition.z),
      courtId: monster.courtId,
      facing: vec2Mm(monster.facing.x, monster.facing.z),
      hp: monster.hp,
      maxHp: monster.maxHp,
      attackPower: monster.attackPower,
      moveSpeedMmPerSecond: monster.moveSpeedMmPerSecond,
      attackRangeMm: monster.attackRangeMm,
      attackCooldownTicks: monster.attackCooldownTicks,
      collisionRadiusMm: monster.collisionRadiusMm,
      targetEntityId: monster.targetEntityId,
      spawnTick: monster.spawnTick,
      invulnerableTicks: monster.invulnerableTicks,
      hardControlTicks: monster.hardControlTicks,
      slowTicks: monster.slowTicks,
      slowBasisPoints: monster.slowBasisPoints,
      silenceTicks: monster.silenceTicks,
      silenceCooldownPenaltyTicks: monster.silenceCooldownPenaltyTicks,
      blindTicks: monster.blindTicks,
      blindMissPercent: monster.blindMissPercent,
      blindPreventsCritical: monster.blindPreventsCritical,
      polymorphTicks: monster.polymorphTicks,
      polymorphSpeedBonusPercent: monster.polymorphSpeedBonusPercent,
      displacementLockTicks: monster.displacementLockTicks,
      attackPeriodTicks: monster.attackPeriodTicks,
      aggroRadiusMm: monster.aggroRadiusMm,
      leashRadiusMm: monster.leashRadiusMm,
    }));
}

function monsterRespawnSnapshots(state: MutableSimulationState): MonsterRespawnSnapshot[] {
  return state.monsterRespawns
    .map((respawn) => ({
      kind: respawn.kind,
      ring: respawn.ring,
      element: respawn.element,
      homePosition: vec2Mm(respawn.homePosition.x, respawn.homePosition.z),
      courtId: respawn.courtId,
      respawnAtTick: respawn.respawnAtTick,
    }))
    .sort(
      (left, right) =>
        left.respawnAtTick - right.respawnAtTick ||
        left.kind.localeCompare(right.kind) ||
        left.ring.localeCompare(right.ring) ||
        (left.courtId ?? '').localeCompare(right.courtId ?? '') ||
        left.homePosition.x - right.homePosition.x ||
        left.homePosition.z - right.homePosition.z,
    );
}

function coreBossRuntimeSnapshots(state: MutableSimulationState) {
  return [...state.coreBossRuntimes.values()]
    .sort((left, right) => Number(left.bossEntityId) - Number(right.bossEntityId))
    .map((runtime) => ({ ...runtime }));
}

function coreBossHazardSnapshots(state: MutableSimulationState) {
  return [...state.coreBossHazards.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((hazard) => ({
      ...hazard,
      center: vec2Mm(hazard.center.x, hazard.center.z),
      direction: vec2Mm(hazard.direction.x, hazard.direction.z),
      targetMarks: hazard.targetMarks
        .map((mark) => ({
          targetEntityId: mark.targetEntityId,
          position: vec2Mm(mark.position.x, mark.position.z),
        }))
        .sort(
          (left, right) =>
            Number(left.targetEntityId ?? 0) - Number(right.targetEntityId ?? 0) ||
            left.position.x - right.position.x ||
            left.position.z - right.position.z,
        ),
      hitEntityIds: [...hazard.hitEntityIds].sort((left, right) => Number(left) - Number(right)),
    }));
}

function coreBossRevealAnchorSnapshots(state: MutableSimulationState) {
  return [...state.coreBossRevealAnchors.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((anchor) => ({
      ...anchor,
      position: vec2Mm(anchor.position.x, anchor.position.z),
    }));
}

function coreBossThreatSnapshots(state: MutableSimulationState) {
  return [...state.coreBossThreat.entries()]
    .map(([entityId, threat]) => ({ entityId, threat }))
    .sort((left, right) => Number(left.entityId) - Number(right.entityId));
}

function pendingActiveReplacementSnapshots(
  state: MutableSimulationState,
): PendingActiveReplacementSnapshot[] {
  return [...state.pendingActiveReplacements.values()]
    .sort(
      (left, right) =>
        Number(left.playerEntityId) - Number(right.playerEntityId) ||
        Number(left.lootEntityId) - Number(right.lootEntityId),
    )
    .map((pending) => ({ ...pending }));
}

function pendingEquipmentPickupSnapshots(
  state: MutableSimulationState,
): PendingEquipmentPickupSnapshot[] {
  return [...state.pendingEquipmentPickups.values()]
    .sort(
      (left, right) =>
        Number(left.playerEntityId) - Number(right.playerEntityId) ||
        Number(left.lootEntityId) - Number(right.lootEntityId),
    )
    .map((pending) => ({ ...pending }));
}

function summonSnapshots(state: MutableSimulationState): SummonSnapshot[] {
  return [...state.summons.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((summon) => ({
      entityId: summon.entityId,
      ownerEntityId: summon.ownerEntityId,
      kind: summon.kind,
      ...(summon.activeAbilityId === undefined
        ? {}
        : { activeAbilityId: summon.activeAbilityId }),
      position: vec2Mm(summon.position.x, summon.position.z),
      hp: summon.hp,
      maxHp: summon.maxHp,
      attackPower: summon.attackPower,
      targetable: summon.targetable,
      expiresAtTick: summon.expiresAtTick,
      attackCooldownTicks: summon.attackCooldownTicks,
      touchCooldownTicks: summon.touchCooldownTicks,
      destroyedByHostileDamage: summon.destroyedByHostileDamage,
    }));
}

function afterimageSnapshots(state: MutableSimulationState): AfterimageSnapshot[] {
  return [...state.afterimages.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((afterimage) => ({
      entityId: afterimage.entityId,
      ownerEntityId: afterimage.ownerEntityId,
      position: vec2Mm(afterimage.position.x, afterimage.position.z),
      slowPercent: afterimage.slowPercent,
      slowDurationTicks: afterimage.slowDurationTicks,
      explosionDamage: afterimage.explosionDamage,
      explosionRadiusMm: afterimage.explosionRadiusMm,
      expiresAtTick: afterimage.expiresAtTick,
    }));
}

function bountyMarkSnapshots(state: MutableSimulationState): BountyMarkSnapshot[] {
  return state.bountyMarks
    .map((mark) => ({ ...mark }))
    .sort(
      (left, right) =>
        Number(left.sourceEntityId) - Number(right.sourceEntityId) ||
        Number(left.targetEntityId) - Number(right.targetEntityId) ||
        left.expiresAtTick - right.expiresAtTick,
    );
}

function activeLootRevealSnapshots(state: MutableSimulationState): ActiveLootRevealSnapshot[] {
  return [...state.activeLootReveals.values()]
    .sort(
      (left, right) =>
        Number(left.sourceEntityId) - Number(right.sourceEntityId) ||
        Number(left.lootEntityId) - Number(right.lootEntityId),
    )
    .map((reveal) => ({ ...reveal }));
}

function equipmentRevealSnapshots(state: MutableSimulationState): EquipmentRevealSnapshot[] {
  return [...state.equipmentReveals.values()]
    .sort(
      (left, right) =>
        Number(left.observerEntityId) - Number(right.observerEntityId) ||
        Number(left.targetEntityId) - Number(right.targetEntityId),
    )
    .map((reveal) => ({
      ...reveal,
      position: vec2Mm(reveal.position.x, reveal.position.z),
    }));
}

function passiveTargetSnapshots(state: MutableSimulationState): PassiveTargetSnapshot[] {
  return [...state.passiveTargetStates.values()]
    .sort(
      (left, right) =>
        Number(left.sourceEntityId) - Number(right.sourceEntityId) ||
        Number(left.targetEntityId) - Number(right.targetEntityId),
    )
    .map((targetState) => ({ ...targetState }));
}

function lootSnapshots(state: MutableSimulationState): LootSnapshot[] {
  return [...state.lootDrops.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((drop) => ({
      entityId: drop.entityId,
      position: vec2Mm(drop.position.x, drop.position.z),
      gold: drop.gold,
      experience: drop.experience,
      gems: drop.gems,
      equipmentId: drop.equipmentId,
      bookPassiveId: drop.bookPassiveId,
      createdAtTick: drop.createdAtTick,
      expiresAtTick: drop.expiresAtTick,
      ...(drop.kind === undefined ? {} : { kind: drop.kind }),
      ...(drop.activeId === undefined ? {} : { activeId: drop.activeId }),
      ...(drop.equipmentInstanceId === undefined
        ? {}
        : { equipmentInstanceId: drop.equipmentInstanceId }),
      ...(drop.acquiredAtTick === undefined ? {} : { acquiredAtTick: drop.acquiredAtTick }),
      ...(drop.permanentAttackBonus === undefined
        ? {}
        : { permanentAttackBonus: drop.permanentAttackBonus }),
      ...(drop.stormCoveredSinceTick === undefined
        ? {}
        : { stormCoveredSinceTick: drop.stormCoveredSinceTick }),
    }));
}

function shopSnapshots(state: MutableSimulationState): ShopSnapshot[] {
  return [...state.shops.values()]
    .sort((left, right) => left.shopId.localeCompare(right.shopId))
    .map((shop) => ({
      shopId: shop.shopId,
      kind: shop.kind,
      position: vec2Mm(shop.position.x, shop.position.z),
      anchorId: shop.anchorId,
      macroId: shop.macroId,
      openAtTick: shop.openAtTick,
      closeAtTick: shop.closeAtTick,
      version: shop.version,
      status: shop.status,
      nextRelocationAttemptTick: shop.nextRelocationAttemptTick,
      inventory: shop.inventory.map((listing) => ({ ...listing })),
    }));
}

function windWallSnapshots(state: MutableSimulationState): WindWallSnapshot[] {
  return [...state.windWalls.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((wall) => ({
      entityId: wall.entityId,
      ownerEntityId: wall.ownerEntityId,
      activeAbilityId: wall.activeAbilityId,
      center: vec2Mm(wall.center.x, wall.center.z),
      direction: vec2Mm(wall.direction.x, wall.direction.z),
      lengthMm: wall.lengthMm,
      remainingTicks: wall.remainingTicks,
    }));
}

function projectileSnapshots(state: MutableSimulationState): ProjectileSnapshot[] {
  return [...state.projectiles.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((projectile) => ({
      entityId: projectile.entityId,
      kind: projectile.kind,
      ownerEntityId: projectile.ownerEntityId,
      targetEntityId: projectile.targetEntityId,
      position: vec2Mm(projectile.position.x, projectile.position.z),
      speedMmPerSecond: projectile.speedMmPerSecond,
      collisionRadiusMm: projectile.collisionRadiusMm,
      sourceElement: projectile.sourceElement,
      baseDamage: projectile.baseDamage,
      outgoingDamageBasisPoints: projectile.outgoingDamageBasisPoints,
      ...(projectile.activeAbilityId === undefined
        ? {}
        : { activeAbilityId: projectile.activeAbilityId }),
      createdAtTick: projectile.createdAtTick,
      remainingTravelMm: projectile.remainingTravelMm,
      movementRemainder: projectile.movementRemainder,
    }));
}

function activeProjectileSnapshots(state: MutableSimulationState): ActiveProjectileSnapshot[] {
  return [...state.activeProjectiles.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((projectile) => ({
      ...projectile,
      position: vec2Mm(projectile.position.x, projectile.position.z),
      direction: vec2Mm(projectile.direction.x, projectile.direction.z),
    }));
}

function activeZoneSnapshots(state: MutableSimulationState): ActiveZoneSnapshot[] {
  return [...state.activeZones.values()]
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))
    .map((zone) => ({
      ...zone,
      center: vec2Mm(zone.center.x, zone.center.z),
      direction: vec2Mm(zone.direction.x, zone.direction.z),
    }));
}

function activeTargetEffectSnapshots(state: MutableSimulationState): ActiveTargetEffectSnapshot[] {
  return [...state.activeTargetEffects.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((effect) => ({ ...effect }));
}

function airdropSnapshots(state: MutableSimulationState): AirdropSnapshot[] {
  return [...state.airdrops.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .map((airdrop) => ({
      ...airdrop,
      position: airdrop.position ? vec2Mm(airdrop.position.x, airdrop.position.z) : null,
    }));
}

function airdropChannelSnapshots(state: MutableSimulationState): AirdropChannelSnapshot[] {
  return [...state.airdropChannels.values()]
    .sort(
      (left, right) =>
        left.sequence - right.sequence ||
        Number(left.playerEntityId) - Number(right.playerEntityId),
    )
    .map((channel) => ({
      ...channel,
      originPosition: vec2Mm(channel.originPosition.x, channel.originPosition.z),
    }));
}

interface SnapshotParts {
  readonly hashInput: Record<string, unknown>;
  readonly match: WorldSnapshot['match'];
  readonly stormZone: WorldSnapshot['stormZone'];
  readonly staticSolids: WorldSnapshot['staticSolids'];
  readonly players: PlayerSnapshot[];
  readonly monsters: MonsterSnapshot[];
  readonly monsterRespawns: MonsterRespawnSnapshot[];
  readonly coreBossRuntimes: WorldSnapshot['coreBossRuntimes'];
  readonly coreBossHazards: WorldSnapshot['coreBossHazards'];
  readonly coreBossRevealAnchors: WorldSnapshot['coreBossRevealAnchors'];
  readonly coreBossThreat: WorldSnapshot['coreBossThreat'];
  readonly pendingActiveReplacements: PendingActiveReplacementSnapshot[];
  readonly pendingEquipmentPickups: PendingEquipmentPickupSnapshot[];
  readonly lootDrops: LootSnapshot[];
  readonly summons: SummonSnapshot[];
  readonly afterimages: AfterimageSnapshot[];
  readonly bountyMarks: BountyMarkSnapshot[];
  readonly activeLootReveals: ActiveLootRevealSnapshot[];
  readonly equipmentReveals: EquipmentRevealSnapshot[];
  readonly passiveTargetStates: PassiveTargetSnapshot[];
  readonly shops: ShopSnapshot[];
  readonly windWalls: WindWallSnapshot[];
  readonly projectiles: ProjectileSnapshot[];
  readonly activeProjectiles: ActiveProjectileSnapshot[];
  readonly activeZones: ActiveZoneSnapshot[];
  readonly activeTargetEffects: ActiveTargetEffectSnapshot[];
  readonly playerHistoryFrames: WorldSnapshot['playerHistoryFrames'];
  readonly airdrops: AirdropSnapshot[];
  readonly airdropChannels: AirdropChannelSnapshot[];
}

function buildSnapshotParts(state: MutableSimulationState): SnapshotParts {
  const match = {
    status: state.match.status,
    startedAtTick: state.match.startedAtTick,
    finishedAtTick: state.match.finishedAtTick,
    outcome: state.match.outcome,
    winnerEntityId: state.match.winnerEntityId,
    winnerEntityIds: [...state.match.winnerEntityIds],
    placements: [...state.match.placements],
    placementGroups: state.match.placementGroups.map((group) => [...group]),
    voidAbortReason: state.match.voidAbortReason,
    mmrEligible: state.match.mmrEligible,
    cultivationAwards: state.match.cultivationAwards.map((award) => ({ ...award })),
    diagnosticReplayRequired: state.match.diagnosticReplayRequired,
  };
  const stormZone = {
    selectedCourtId: state.stormZone.selectedCourtId,
    courtAnnouncementTick: state.stormZone.courtAnnouncementTick,
    warningTick: state.stormZone.warningTick,
    center: vec2Mm(state.stormZone.center.x, state.stormZone.center.z),
    radiusMm: state.stormZone.radiusMm,
    courtAnnounced: state.stormZone.courtAnnounced,
    apocalypseWarning: state.stormZone.apocalypseWarning,
    apocalypseStarted: state.stormZone.apocalypseStarted,
  };
  const staticSolids = state.staticSolids.map((solid) => ({ ...solid }));
  const players = sortedPlayers(state).map((player) => playerSnapshot(state, player));
  const monsters = monsterSnapshots(state);
  const monsterRespawns = monsterRespawnSnapshots(state);
  const coreBossRuntimes = coreBossRuntimeSnapshots(state);
  const coreBossHazards = coreBossHazardSnapshots(state);
  const coreBossRevealAnchors = coreBossRevealAnchorSnapshots(state);
  const coreBossThreat = coreBossThreatSnapshots(state);
  const pendingActiveReplacements = pendingActiveReplacementSnapshots(state);
  const pendingEquipmentPickups = pendingEquipmentPickupSnapshots(state);
  const lootDrops = lootSnapshots(state);
  const summons = summonSnapshots(state);
  const afterimages = afterimageSnapshots(state);
  const bountyMarks = bountyMarkSnapshots(state);
  const activeLootReveals = activeLootRevealSnapshots(state);
  const equipmentReveals = equipmentRevealSnapshots(state);
  const passiveTargetStates = passiveTargetSnapshots(state);
  const shops = shopSnapshots(state);
  const windWalls = windWallSnapshots(state);
  const projectiles = projectileSnapshots(state);
  const activeProjectiles = activeProjectileSnapshots(state);
  const activeZones = activeZoneSnapshots(state);
  const activeTargetEffects = activeTargetEffectSnapshots(state);
  const airdrops = airdropSnapshots(state);
  const airdropChannels = airdropChannelSnapshots(state);
  const playerHistoryFrames = state.playerHistoryFrames
    .map((frame) => ({
      ...frame,
      position: vec2Mm(frame.position.x, frame.position.z),
    }))
    .sort(
      (left, right) => Number(left.entityId) - Number(right.entityId) || left.tick - right.tick,
    );
  const hashInput = {
    tick: state.tick,
    rootSeed: state.rootSeed,
    arenaRadiusMm: state.arenaRadiusMm,
    stormZone,
    mapGeometryHash: state.mapGeometryHash,
    match,
    eliminationOrder: [...state.eliminationOrder],
    staticSolids,
    random: {
      spawn: state.random.spawn.snapshot(),
      combat: state.random.combat.snapshot(),
      storm: state.random.storm.snapshot(),
      stormLayout: state.random.stormLayout.snapshot(),
      shop: state.random.shop.snapshot(),
      blackMountain: state.random.blackMountain.snapshot(),
      airdrop: state.random.airdrop.snapshot(),
    },
    consumedB20PlayerIds: [...state.consumedB20PlayerIds].sort(),
    initialSpawnIndices: [...state.initialSpawnIndices].sort((left, right) => left - right),
    nextEntityId: state.nextEntityId,
    nextEquipmentInstanceId: state.nextEquipmentInstanceId,
    nextShieldSequence: state.nextShieldSequence,
    terminalShopAssignments: [...state.terminalShopAssignments.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    goldenCudgelDropped: state.goldenCudgelDropped,
    nextAirdropChannelSequence: state.nextAirdropChannelSequence,
    pveEnabled: state.pveEnabled,
    pvePopulation: state.pvePopulation,
    players,
    monsters,
    monsterRespawns,
    coreBossRuntimes,
    coreBossHazards,
    coreBossRevealAnchors,
    coreBossThreat,
    pendingActiveReplacements,
    pendingEquipmentPickups,
    lootDrops,
    summons,
    afterimages,
    bountyMarks,
    activeLootReveals,
    equipmentReveals,
    passiveTargetStates,
    shops,
    windWalls,
    projectiles,
    activeProjectiles,
    activeZones,
    activeTargetEffects,
    playerHistoryFrames,
    airdrops,
    airdropChannels,
  };
  return {
    hashInput,
    match,
    stormZone,
    staticSolids,
    players,
    monsters,
    monsterRespawns,
    coreBossRuntimes,
    coreBossHazards,
    coreBossRevealAnchors,
    coreBossThreat,
    pendingActiveReplacements,
    pendingEquipmentPickups,
    lootDrops,
    summons,
    afterimages,
    bountyMarks,
    activeLootReveals,
    equipmentReveals,
    passiveTargetStates,
    shops,
    windWalls,
    projectiles,
    activeProjectiles,
    activeZones,
    activeTargetEffects,
    playerHistoryFrames,
    airdrops,
    airdropChannels,
  };
}

/**
 * Debug-only helper for the C#/TS parity tooling
 * (tools/migration/dump-sim-hash-input.ts); returns the exact object
 * hashed by stableHash32 for the authoritative state hash.
 */
export function createStateHashInput(state: MutableSimulationState): Record<string, unknown> {
  return buildSnapshotParts(state).hashInput;
}

export function createWorldSnapshot(
  state: MutableSimulationState,
  deferStateHash = false,
): WorldSnapshot {
  const parts = buildSnapshotParts(state);
  let stateHash: string | undefined;
  const snapshot: WorldSnapshot = {
    tick: state.tick,
    rootSeed: state.rootSeed,
    get stateHash() {
      stateHash ??= stableHash32(parts.hashInput);
      return stateHash;
    },
    match: parts.match,
    stormZone: parts.stormZone,
    mapGeometryHash: state.mapGeometryHash,
    staticSolids: parts.staticSolids,
    players: parts.players,
    monsters: parts.monsters,
    monsterRespawns: parts.monsterRespawns,
    coreBossRuntimes: parts.coreBossRuntimes,
    coreBossHazards: parts.coreBossHazards,
    coreBossRevealAnchors: parts.coreBossRevealAnchors,
    coreBossThreat: parts.coreBossThreat,
    pendingActiveReplacements: parts.pendingActiveReplacements,
    pendingEquipmentPickups: parts.pendingEquipmentPickups,
    lootDrops: parts.lootDrops,
    summons: parts.summons,
    afterimages: parts.afterimages,
    bountyMarks: parts.bountyMarks,
    activeLootReveals: parts.activeLootReveals,
    equipmentReveals: parts.equipmentReveals,
    passiveTargetStates: parts.passiveTargetStates,
    shops: parts.shops,
    windWalls: parts.windWalls,
    projectiles: parts.projectiles,
    activeProjectiles: parts.activeProjectiles,
    activeZones: parts.activeZones,
    activeTargetEffects: parts.activeTargetEffects,
    playerHistoryFrames: parts.playerHistoryFrames,
    airdrops: parts.airdrops,
    airdropChannels: parts.airdropChannels,
  };
  if (!deferStateHash) {
    void snapshot.stateHash;
  }
  return snapshot;
}

function observerCanSeePoint(
  state: MutableSimulationState,
  observer: ReturnType<typeof sortedPlayers>[number],
  position: { readonly x: number; readonly z: number },
): boolean {
  const rangeMm = equipmentVisionRangeMm(observer);
  return (
    distanceSquaredMm(observer.position, position) <= rangeMm * rangeMm &&
    hasDirectLineOfSight(state, observer.position, position, 0)
  );
}

/**
 * Builds a network/client view without changing the authoritative state hash.
 * Hidden entities never enter the observer payload; full snapshots remain
 * available to the server, replay, tests, and bot planners with explicit
 * observer filtering.
 */
export function createObserverWorldSnapshot(
  state: MutableSimulationState,
  observerEntityId: EntityId,
  baseSnapshot: WorldSnapshot = createWorldSnapshot(state),
): WorldSnapshot {
  const observer = state.players.get(observerEntityId);
  if (!observer) {
    throw new Error(`unknown observer entity ${observerEntityId}`);
  }
  const snapshot = baseSnapshot;
  const visiblePlayerIds = new Set<EntityId>([observerEntityId]);
  const visibleMonsterIds = new Set<EntityId>();
  const visibleSummonIds = new Set<EntityId>();
  const visibleZoneIds = new Set<EntityId>();

  for (const player of state.players.values()) {
    if (player.entityId === observerEntityId || canSeeActiveTarget(state, observer, player)) {
      visiblePlayerIds.add(player.entityId);
    }
  }
  for (const monster of state.monsters.values()) {
    if (canSeeActiveTarget(state, observer, monster)) {
      visibleMonsterIds.add(monster.entityId);
    }
  }
  for (const summon of state.summons.values()) {
    if (summon.ownerEntityId === observerEntityId || canSeeActiveTarget(state, observer, summon)) {
      visibleSummonIds.add(summon.entityId);
    }
  }
  for (const zone of state.activeZones.values()) {
    if (zone.ownerEntityId === observerEntityId || canSeeActiveTarget(state, observer, zone)) {
      visibleZoneIds.add(zone.entityId);
    }
  }

  const visibleActorIds = new Set<EntityId>([
    ...visiblePlayerIds,
    ...visibleMonsterIds,
    ...visibleSummonIds,
    ...visibleZoneIds,
  ]);
  const visibleCoreBossIds = new Set(
    snapshot.monsters
      .filter((monster) => monster.kind === 'core-boss' && visibleMonsterIds.has(monster.entityId))
      .map((monster) => monster.entityId),
  );
  const visibleCoreHazardIds = new Set(
    snapshot.coreBossHazards
      .filter(
        (hazard) =>
          visibleCoreBossIds.has(hazard.bossEntityId) ||
          observerCanSeePoint(state, observer, hazard.center),
      )
      .map((hazard) => hazard.entityId),
  );
  const revealedLootIds = new Set(
    [...state.activeLootReveals.values()]
      .filter(
        (reveal) => reveal.sourceEntityId === observerEntityId && reveal.expiresAtTick > state.tick,
      )
      .map((reveal) => reveal.lootEntityId),
  );
  const visibleLootIds = new Set(
    [...state.lootDrops.values()]
      .filter(
        (drop) =>
          revealedLootIds.has(drop.entityId) || observerCanSeePoint(state, observer, drop.position),
      )
      .map((drop) => drop.entityId),
  );
  const projectileIsVisible = (projectile: {
    readonly ownerEntityId: EntityId;
    readonly position: { x: number; z: number };
  }): boolean =>
    projectile.ownerEntityId === observerEntityId ||
    visibleActorIds.has(projectile.ownerEntityId) ||
    observerCanSeePoint(state, observer, projectile.position);

  return {
    ...snapshot,
    players: snapshot.players.filter((player) => visiblePlayerIds.has(player.entityId)),
    monsters: snapshot.monsters.filter((monster) => visibleMonsterIds.has(monster.entityId)),
    monsterRespawns: [],
    coreBossRuntimes: snapshot.coreBossRuntimes.filter((runtime) =>
      visibleCoreBossIds.has(runtime.bossEntityId),
    ),
    coreBossHazards: snapshot.coreBossHazards.filter((hazard) =>
      visibleCoreHazardIds.has(hazard.entityId),
    ),
    coreBossRevealAnchors: snapshot.coreBossRevealAnchors.filter((anchor) =>
      observerCanSeePoint(state, observer, anchor.position),
    ),
    coreBossThreat: snapshot.coreBossThreat.filter(
      (entry) => entry.entityId === observerEntityId || visibleCoreBossIds.has(entry.entityId),
    ),
    pendingActiveReplacements: snapshot.pendingActiveReplacements.filter(
      (pending) => pending.playerEntityId === observerEntityId,
    ),
    pendingEquipmentPickups: snapshot.pendingEquipmentPickups.filter(
      (pending) => pending.playerEntityId === observerEntityId,
    ),
    lootDrops: snapshot.lootDrops.filter((drop) => visibleLootIds.has(drop.entityId)),
    summons: snapshot.summons.filter((summon) => visibleSummonIds.has(summon.entityId)),
    afterimages: snapshot.afterimages.filter(
      (afterimage) =>
        afterimage.ownerEntityId === observerEntityId ||
        visiblePlayerIds.has(afterimage.ownerEntityId) ||
        observerCanSeePoint(state, observer, afterimage.position),
    ),
    bountyMarks: snapshot.bountyMarks.filter(
      (mark) =>
        mark.sourceEntityId === observerEntityId ||
        mark.targetEntityId === observerEntityId ||
        mark.revealToAll,
    ),
    activeLootReveals: snapshot.activeLootReveals.filter(
      (reveal) => reveal.sourceEntityId === observerEntityId,
    ),
    equipmentReveals: snapshot.equipmentReveals.filter(
      (reveal) => reveal.observerEntityId === observerEntityId,
    ),
    passiveTargetStates: snapshot.passiveTargetStates.filter(
      (targetState) =>
        targetState.sourceEntityId === observerEntityId ||
        targetState.targetEntityId === observerEntityId ||
        (visibleActorIds.has(targetState.sourceEntityId) &&
          visibleActorIds.has(targetState.targetEntityId)),
    ),
    windWalls: snapshot.windWalls.filter(
      (wall) =>
        wall.ownerEntityId === observerEntityId ||
        visiblePlayerIds.has(wall.ownerEntityId) ||
        observerCanSeePoint(state, observer, wall.center),
    ),
    projectiles: snapshot.projectiles.filter(projectileIsVisible),
    activeProjectiles: snapshot.activeProjectiles.filter(projectileIsVisible),
    activeZones: snapshot.activeZones.filter((zone) => visibleZoneIds.has(zone.entityId)),
    activeTargetEffects: snapshot.activeTargetEffects.filter(
      (effect) =>
        effect.sourceEntityId === observerEntityId ||
        effect.targetEntityId === observerEntityId ||
        (visibleActorIds.has(effect.sourceEntityId) && visibleActorIds.has(effect.targetEntityId)),
    ),
    playerHistoryFrames: snapshot.playerHistoryFrames.filter(
      (frame) => frame.entityId === observerEntityId,
    ),
  };
}

export function filterEventsForObserver(
  state: MutableSimulationState,
  observerEntityId: EntityId,
  events: readonly SimEvent[],
  baseSnapshot: WorldSnapshot = createWorldSnapshot(state),
): SimEvent[] {
  const observerSnapshot = createObserverWorldSnapshot(state, observerEntityId, baseSnapshot);
  const observer = state.players.get(observerEntityId);
  if (!observer) {
    throw new Error(`unknown observer entity ${observerEntityId}`);
  }
  const visibleActors = new Set<EntityId>([
    ...observerSnapshot.players.map((player) => player.entityId),
    ...observerSnapshot.monsters.map((monster) => monster.entityId),
    ...observerSnapshot.summons.map((summon) => summon.entityId),
    ...observerSnapshot.activeZones.map((zone) => zone.entityId),
  ]);
  const visibleLoot = new Set(observerSnapshot.lootDrops.map((drop) => drop.entityId));
  const isActorVisible = (entityId: EntityId | null | undefined): boolean =>
    entityId === observerEntityId ||
    (entityId !== null && entityId !== undefined && visibleActors.has(entityId));
  const isLootVisible = (entityId: EntityId): boolean => visibleLoot.has(entityId);

  return events.filter((event) => {
    switch (event.type) {
      case 'match-started':
      case 'match-ended':
      case 'shop-opened':
      case 'airdrop-warning':
      case 'airdrop-landed':
      case 'airdrop-opened':
      case 'airdrop-expired':
        return true;
      case 'player-added':
        return isActorVisible(event.entityId);
      case 'basic-attack':
        return isActorVisible(event.sourceEntityId) || isActorVisible(event.targetEntityId);
      case 'monster-spawned':
        return visibleActors.has(event.entityId);
      case 'loot-dropped':
        return isLootVisible(event.entityId) || event.sourceEntityId === observerEntityId;
      case 'loot-collected':
        return event.collectorEntityId === observerEntityId || isLootVisible(event.entityId);
      case 'loot-expired':
        return isLootVisible(event.entityId);
      case 'active-replacement-required':
      case 'active-replacement-cancelled':
      case 'active-replaced':
        return event.entityId === observerEntityId || isActorVisible(event.entityId);
      case 'monster-damaged':
      case 'monster-killed':
        return isActorVisible(event.targetEntityId) || event.sourceEntityId === observerEntityId;
      case 'core-boss-cast':
        return (
          isActorVisible(event.bossEntityId) || observerCanSeePoint(state, observer, event.center)
        );
      case 'core-boss-migrated':
      case 'core-boss-reveal-anchor':
        return (
          isActorVisible(event.bossEntityId) || observerCanSeePoint(state, observer, event.position)
        );
      case 'damage':
      case 'critical-hit':
      case 'active-world-damaged':
      case 'active-heal':
      case 'active-status-applied':
      case 'active-status-ended':
      case 'projectile-blocked':
        return (
          isActorVisible(event.targetEntityId) ||
          ('sourceEntityId' in event && event.sourceEntityId === observerEntityId)
        );
      case 'passive-shield-created':
      case 'passive-upgraded':
      case 'passive-learned':
      case 'active-cast':
      case 'active-unavailable':
      case 'active-target-missing':
      case 'active-cast-blocked':
      case 'blink':
      case 'lethal-protection':
      case 'true-death':
      case 'respawn':
      case 'revive-protection-ended':
      case 'eliminated':
      case 'equipment-equipped':
      case 'equipment-unequipped':
      case 'equipment-discarded':
      case 'shop-purchase':
      case 'shop-sale':
      case 'hero-swap-channel':
      case 'gamble-resolved':
        return event.entityId === observerEntityId || isActorVisible(event.entityId);
      case 'airdrop-channel':
        return true;
      case 'passive-proc':
      case 'equipment-proc':
        return (
          event.sourceEntityId === observerEntityId ||
          isActorVisible(event.sourceEntityId) ||
          isActorVisible(event.targetEntityId)
        );
      case 'summon-spawned':
      case 'summon-expired':
        return (
          event.ownerEntityId === observerEntityId ||
          isActorVisible(event.ownerEntityId) ||
          isActorVisible(event.entityId)
        );
      case 'active-world-spawned':
      case 'active-world-expired':
        return (
          event.ownerEntityId === observerEntityId ||
          isActorVisible(event.ownerEntityId) ||
          isActorVisible(event.entityId)
        );
      case 'hero-kill-reward':
        return (
          event.sourceEntityId === observerEntityId ||
          event.targetEntityId === observerEntityId ||
          (isActorVisible(event.sourceEntityId) && isActorVisible(event.targetEntityId))
        );
    }
    return false;
  });
}
