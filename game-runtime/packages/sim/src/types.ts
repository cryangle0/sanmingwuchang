import type {
  EquippedEquipmentInstance,
  FiveElement,
  PassiveLevel,
  PassiveLoadoutEntry,
} from '@jwgb/content';
import type {
  ActiveId,
  EntityId,
  EquipmentId,
  HeroId,
  PassiveId,
  PlayerId,
  PlayerIntent,
  SeededRng,
  Vec2Mm,
} from '@jwgb/core';

export type LifeState = 'alive' | 'soul-flight' | 'revive-protection' | 'eliminated';
export type DamageForm = 'basic' | 'skill' | 'dot' | 'percent' | 'reflect' | 'true' | 'storm';
export type DamageCause = 'basic' | 'active' | 'passive' | 'monster' | 'storm' | 'debug';

export type MonsterKind =
  | 'ground-melee'
  | 'ground-ranged'
  | 'flying'
  | 'pig'
  | 'elite-tank'
  | 'elite-ranged'
  | 'dragon-king'
  | 'core-boss';

export type MonsterRing = 'outer' | 'middle' | 'inner' | 'den' | 'arena' | 'court';
export type SummonKind =
  | 'wolf-spirit'
  | 'fire-spirit'
  | 'stone-statue'
  | 'decoy'
  | 'stone-arhat'
  | 'bean-soldier'
  | 'core-mirror';

export type CoreBossAbilityId =
  | 'ring-shockwave'
  | 'meteor'
  | 'earthbreak'
  | 'firelane'
  | 'poisonpool'
  | 'windcharge'
  | 'thunderchain'
  | 'mirrorshadow';

export interface CoreBossTargetMark {
  readonly targetEntityId: EntityId | null;
  position: Vec2Mm;
}

/**
 * Authoritative warning/active geometry for a core-boss cast. A single shape
 * model keeps replay, observer payloads, rendering, and Unity parity on the
 * same integer-millimetre data.
 */
export interface CoreBossHazard {
  readonly entityId: EntityId;
  readonly bossEntityId: EntityId;
  readonly abilityId: CoreBossAbilityId;
  readonly createdAtTick: number;
  readonly activatesAtTick: number;
  readonly expiresAtTick: number;
  center: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly radiusMm: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly damage: number;
  readonly damagePerSecond: number;
  readonly hardControlTicks: number;
  readonly displacementMm: number;
  readonly gapIndex: number;
  resolved: boolean;
  nextPulseTick: number;
  readonly pulseIntervalTicks: number;
  readonly targetMarks: CoreBossTargetMark[];
  readonly hitEntityIds: EntityId[];
}

export interface CoreBossRuntimeState {
  readonly bossEntityId: EntityId;
  courtId: string | null;
  nextRingCastTick: number;
  nextMeteorCastTick: number;
  nextSignatureCastTick: number;
  signatureIndex: number;
}

export interface CoreBossRevealAnchor {
  readonly entityId: EntityId;
  readonly bossEntityId: EntityId;
  readonly position: Vec2Mm;
  readonly expiresAtTick: number;
}

export type ActiveZoneKind =
  | 'fire-wall'
  | 'damage-slow'
  | 'spreading-poison'
  | 'delayed-strike'
  | 'delayed-target-strike'
  | 'area-pull'
  | 'decoy-bomb'
  | 'silence'
  | 'lifesteal-aura'
  | 'healing'
  | 'ring-wall'
  | 'displacement-lock'
  | 'ice-wall'
  | 'smoke'
  | 'trap';

export type ActiveTargetEffectKind =
  | 'venom'
  | 'damage-over-time'
  | 'damage-mark'
  | 'reveal'
  | 'petrify'
  | 'slow'
  | 'stun'
  | 'silence'
  | 'root'
  | 'freeze'
  | 'polymorph'
  | 'fear'
  | 'transform'
  | 'knockup'
  | 'displacement-lock'
  | 'combat-buff'
  | 'armed-critical'
  | 'whirlwind'
  | 'invulnerability'
  | 'lifesteal'
  | 'damage-reduction'
  | 'stealth';
export type ActiveStatusKind =
  | 'venom'
  | 'damage-over-time'
  | 'petrify'
  | 'slow'
  | 'stun'
  | 'silence'
  | 'root'
  | 'freeze'
  | 'polymorph'
  | 'fear'
  | 'transform'
  | 'knockup'
  | 'damage-mark'
  | 'reveal'
  | 'displacement-lock'
  | 'combat-buff'
  | 'armed-critical'
  | 'whirlwind'
  | 'invulnerability'
  | 'lifesteal'
  | 'damage-reduction'
  | 'stealth';

export type ShopKind = 'land-god' | 'shoemaker' | 'taibai' | 'heishan';
export type ShopConsumableId = 'clairvoyance-talisman' | 'demon-revealing-mirror';
export type GambleKind = 'passive' | 'equipment' | 'active' | 'gold';
export type GambleOutcome = 'big-win' | 'flat' | 'loss';
export type GambleGoldMode = 'double' | 'purple';
export type AirdropPhase = 'pending' | 'warning' | 'available' | 'opened' | 'expired';
export type LootDropKind =
  | 'currency'
  | 'skill-book'
  | 'equipment'
  | 'death-equipment'
  | 'active'
  | 'chest'
  | 'consumable';

export interface ShopListing {
  readonly listingId: string;
  readonly kind: 'equipment' | 'gem' | 'consumable';
  readonly equipmentId: EquipmentId | null;
  readonly price: number;
  readonly consumableId?: ShopConsumableId | null;
}

export interface ShopEntity {
  readonly shopId: string;
  readonly kind: ShopKind;
  position: Vec2Mm;
  anchorId: string | null;
  macroId: string | null;
  openAtTick: number;
  closeAtTick: number;
  version: number;
  status: 'open' | 'relocating';
  nextRelocationAttemptTick: number;
  inventory: ShopListing[];
}

export interface MonsterEntity {
  readonly entityId: EntityId;
  readonly kind: MonsterKind;
  readonly ring: MonsterRing;
  readonly element: FiveElement | null;
  position: Vec2Mm;
  homePosition: Vec2Mm;
  courtId: string | null;
  facing: Vec2Mm;
  hp: number;
  readonly maxHp: number;
  readonly attackPower: number;
  readonly moveSpeedMmPerSecond: number;
  readonly attackRangeMm: number;
  readonly attackPeriodTicks: number;
  attackCooldownTicks: number;
  readonly collisionRadiusMm: number;
  readonly aggroRadiusMm: number;
  readonly leashRadiusMm: number;
  targetEntityId: EntityId | null;
  readonly spawnTick: number;
  invulnerableTicks: number;
  hardControlTicks: number;
  slowTicks: number;
  slowBasisPoints: number;
  silenceTicks: number;
  silenceCooldownPenaltyTicks: number;
  blindTicks: number;
  blindMissPercent: number;
  blindPreventsCritical: boolean;
  polymorphTicks: number;
  polymorphSpeedBonusPercent: number;
  displacementLockTicks: number;
}

export interface LootDrop {
  readonly entityId: EntityId;
  readonly position: Vec2Mm;
  readonly gold: number;
  readonly experience: number;
  readonly gems: number;
  readonly equipmentId: EquipmentId | null;
  readonly bookPassiveId: PassiveId | null;
  readonly createdAtTick: number;
  readonly expiresAtTick: number;
  /**
   * Legacy fixtures may omit the fields below. All authoritative runtime
   * producers populate them so pickup and expiry are deterministic.
   */
  readonly kind?: LootDropKind;
  readonly activeId?: ActiveId | null;
  readonly equipmentInstanceId?: EquippedEquipmentInstance['instanceId'] | null;
  readonly acquiredAtTick?: number | null;
  readonly permanentAttackBonus?: number;
  readonly stormCoveredSinceTick?: number | null;
}

export interface SummonEntity {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly kind: SummonKind;
  readonly activeAbilityId?: ActiveId;
  position: Vec2Mm;
  hp: number;
  readonly maxHp: number;
  readonly attackPower: number;
  readonly targetable: boolean;
  readonly expiresAtTick: number;
  attackCooldownTicks: number;
  touchCooldownTicks: number;
  destroyedByHostileDamage: boolean;
}

export interface AfterimageEntity {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly position: Vec2Mm;
  readonly slowPercent: number;
  readonly slowDurationTicks: number;
  readonly explosionDamage: number;
  readonly explosionRadiusMm: number;
  readonly expiresAtTick: number;
}

export interface BountyMark {
  readonly sourceEntityId: EntityId;
  readonly targetEntityId: EntityId;
  rewardGold: number;
  readonly rewardRecipientEntityId: EntityId | null;
  readonly revealToAll: boolean;
  expiresAtTick: number;
}

export interface ActiveLootReveal {
  readonly key: string;
  readonly sourceEntityId: EntityId;
  readonly lootEntityId: EntityId;
  expiresAtTick: number;
}

export interface PendingActiveReplacement {
  readonly playerEntityId: EntityId;
  readonly lootEntityId: EntityId;
  readonly activeId: ActiveId;
  readonly requestedAtTick: number;
}

export interface PendingEquipmentPickup {
  readonly playerEntityId: EntityId;
  readonly lootEntityId: EntityId;
  readonly equipmentId: EquipmentId;
  readonly equipmentInstanceId: EquippedEquipmentInstance['instanceId'] | null;
  readonly requestedAtTick: number;
}

export interface EquipmentReveal {
  readonly key: string;
  readonly observerEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly position: Vec2Mm;
  expiresAtTick: number;
}

export interface AirdropEntity {
  readonly id: string;
  readonly sequence: 1 | 2 | 3;
  readonly scheduledElapsedTick: number;
  phase: AirdropPhase;
  position: Vec2Mm | null;
  announcedAtTick: number | null;
  landedAtTick: number | null;
  expiresAtTick: number | null;
  openedAtTick: number | null;
  openedByEntityId: EntityId | null;
  equipmentId: EquipmentId | null;
  lootEntityId: EntityId | null;
}

export interface AirdropChannel {
  readonly sequence: number;
  readonly playerEntityId: EntityId;
  readonly airdropId: string;
  readonly startedAtTick: number;
  readonly completesAtTick: number;
  readonly originPosition: Vec2Mm;
}

export type ShieldSource =
  | {
      readonly kind: 'active';
      readonly activeId: ActiveId;
    }
  | {
      readonly kind: 'passive';
      readonly passiveId: PassiveId;
    };

export interface ShieldBreakEffect {
  readonly sourceEntityId: EntityId;
  readonly sourceElement: FiveElement;
  readonly damage: number;
  readonly radiusMm: number;
}

export interface ShieldInstance {
  readonly source: ShieldSource;
  readonly expiresAtTick: number;
  readonly creationSequence: number;
  readonly absorbs: readonly DamageForm[];
  readonly breakEffect: ShieldBreakEffect | null;
  remainingAmount: number;
}

export interface WindWallEntity {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly activeAbilityId: ActiveId;
  readonly center: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly lengthMm: number;
  remainingTicks: number;
}

export interface ProjectileEntity {
  readonly entityId: EntityId;
  readonly kind: 'basic' | 'cold-arrow';
  readonly ownerEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly speedMmPerSecond: number;
  readonly collisionRadiusMm: number;
  readonly sourceElement: FiveElement;
  readonly baseDamage: number;
  readonly outgoingDamageBasisPoints: number;
  readonly activeAbilityId?: ActiveId;
  readonly createdAtTick: number;
  position: Vec2Mm;
  remainingTravelMm: number;
  movementRemainder: number;
}

export interface ActiveProjectileEntity {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly activeId: ActiveId;
  readonly kind: 'line-damage' | 'root' | 'hook' | 'polymorph';
  position: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly speedMmPerSecond: number;
  readonly collisionRadiusMm: number;
  readonly fixedDamage: number;
  readonly attackCoefficientBasisPoints: number;
  readonly rootTicks: number;
  readonly displacementMm: number;
  readonly effectDurationTicks: number;
  readonly effectSpeedBonusPercent: number;
  readonly triggerHardControlTicks: number;
  readonly damagePerDistanceBasisPoints: number;
  readonly maximumDistanceBonusPercent: number;
  readonly targetEntityId: EntityId | null;
  readonly createdAtTick: number;
  remainingTravelMm: number;
  distanceTravelledMm: number;
  movementRemainder: number;
}

export interface ActiveZoneEntity {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly activeId: ActiveId;
  readonly kind: ActiveZoneKind;
  readonly targetEntityId: EntityId | null;
  center: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly radiusMm: number;
  readonly lengthMm: number;
  readonly createdAtTick: number;
  readonly activatesAtTick: number;
  expiresAtTick: number;
  nextPulseTick: number;
  readonly pulseIntervalTicks: number;
  readonly fixedDamage: number;
  readonly attackCoefficientBasisPoints: number;
  readonly slowPercent: number;
  readonly slowDurationTicks: number;
  readonly hardControlTicks: number;
  readonly displacementMm: number;
  readonly healAmount: number;
  readonly lifestealPercent: number;
  readonly burnDamagePerSecond: number;
  readonly burnDurationTicks: number;
  readonly detonationFixedDamage: number;
  readonly detonationAttackCoefficientBasisPoints: number;
  readonly triggerHardControlTicks: number;
  readonly triggerRevealTicks: number;
  readonly triggerRadiusMm: number;
  hp: number;
  readonly maxHp: number;
  readonly targetable: boolean;
  readonly followsOwner: boolean;
  readonly followTargetEntityId: EntityId | null;
  readonly generation: number;
}

export interface ActiveTargetEffectState {
  readonly key: string;
  readonly sourceEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly activeId: ActiveId;
  readonly kind: ActiveTargetEffectKind;
  stacks: number;
  readonly maximumStacks: number;
  readonly fixedDamage: number;
  readonly attackCoefficientBasisPoints: number;
  readonly percentDamage: number;
  readonly targetDamageBonusPercent: number;
  readonly revealToSource: boolean;
  readonly expiresAtTick: number;
  nextPulseTick: number;
  readonly pulseIntervalTicks: number;
}

export interface PlayerHistoryFrame {
  readonly entityId: EntityId;
  readonly tick: number;
  readonly position: Vec2Mm;
  readonly hp: number;
}

export interface StaticSolidRect {
  readonly solidId: string;
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumZ: number;
  readonly maximumZ: number;
}

export interface PlayerEntity {
  readonly entityId: EntityId;
  readonly playerId: PlayerId;
  heroId: HeroId;
  basicAttackKind: 'melee' | 'ranged-projectile';
  element: FiveElement;
  activeAbilityId: ActiveId;
  position: Vec2Mm;
  facing: Vec2Mm;
  hp: number;
  maxHp: number;
  attackPower: number;
  moveSpeedMmPerSecond: number;
  attackRangeMm: number;
  attacksPerSecondMilli: number;
  attackPeriodTicks: number;
  attackCooldownTicks: number;
  activeCooldownTicks: number;
  activeBuffTicks: number;
  armedCriticalTicks: number;
  armedMissingHpDamagePercent: number;
  armedActiveId: ActiveId | null;
  activeLifestealTicks: number;
  activeLifestealPercent: number;
  activeDamageReductionTicks: number;
  activeDamageReductionBasisPoints: number;
  activeSpeedBonusTicks: number;
  activeSpeedBonusPercent: number;
  worldInteractionLockTicks: number;
  polymorphTicks: number;
  polymorphSpeedBonusPercent: number;
  stealthTicks: number;
  dormantBootsSpeedTicks: number;
  dormantBootsCooldownTicks: number;
  dormantBootsStealthEpisodeActive: boolean;
  dormantBootsTriggeredThisEpisode: boolean;
  displacementLockTicks: number;
  treasureSenseTicks: number;
  activeBountyStreak: number;
  hardControlTicks: number;
  slowTicks: number;
  slowBasisPoints: number;
  silenceTicks: number;
  silenceCooldownPenaltyTicks: number;
  blindTicks: number;
  blindMissPercent: number;
  blindPreventsCritical: boolean;
  b15SpeedBoostTicks: number;
  b15SpeedBonusPercent: number;
  b25NextBasicBonusPercent: number;
  b25AttackSpeedBoostTicks: number;
  b25AttackSpeedBonusPercent: number;
  b27SpeedBoostTicks: number;
  b27SpeedBonusPercent: number;
  b36Stacks: number;
  b36MovingTicks: number;
  b38NextHealTick: number;
  b21FirstHitReady: boolean;
  b30NextAfterimageTick: number;
  b40KillCount: number;
  b40BonusMaxHp: number;
  b42SpeedBoostTicks: number;
  b42SpeedBonusPercent: number;
  lastCombatTick: number;
  whirlwindTicks: number;
  whirlwindNextPulseTick: number;
  b19RetriggerLockTicks: number;
  b20ReviveBuffTicks: number;
  invulnerableTicks: number;
  iceCoffinTicks: number;
  nightCloakStillTicks: number;
  nightCloakStealthed: boolean;
  flightActive: boolean;
  taibaiChannelTicks: number;
  taibaiTargetHeroId: HeroId | null;
  taibaiCooldownTicks: number;
  heishanGambleCount: number;
  consumableVisionTicks: number;
  consumableRevealTicks: number;
  readonly passives: PassiveLoadoutEntry[];
  readonly equipment: EquippedEquipmentInstance[];
  readonly inventoryEquipment: EquippedEquipmentInstance[];
  gold: number;
  experience: number;
  level: number;
  gems: number;
  pvpCombatTicks: number;
  readonly shields: ShieldInstance[];
  livesRemaining: number;
  trueDeaths: number;
  lifeState: LifeState;
  respawnTarget: Vec2Mm | null;
  respawnFlightDeadlineTick: number;
  respawnRetryUntilTick: number;
  respawnAttemptCount: number;
  reviveProtectionTicks: number;
  moveRemainderX: number;
  moveRemainderZ: number;
  intent: PlayerIntent;
}

export interface RandomStreams {
  readonly spawn: SeededRng;
  readonly combat: SeededRng;
  readonly storm: SeededRng;
  readonly stormLayout: SeededRng;
  readonly shop: SeededRng;
  readonly blackMountain: SeededRng;
  readonly airdrop: SeededRng;
}

export interface StormZoneState {
  readonly selectedCourtId: string | null;
  readonly courtAnnouncementTick: number;
  readonly warningTick: number;
  center: Vec2Mm;
  radiusMm: number;
  courtAnnounced: boolean;
  apocalypseWarning: boolean;
  apocalypseStarted: boolean;
}

export interface PassiveTargetState {
  readonly sourceEntityId: EntityId;
  readonly targetEntityId: EntityId;
  burnStacks: number;
  poisonStacks: number;
  poisonExpiresAtTick: number;
  poisonNextTick: number;
  fireBurnDamagePerSecond: number;
  fireBurnExpiresAtTick: number;
  fireBurnNextTick: number;
  fireBurnSourceEntityId: EntityId | null;
  equipmentBurnDamagePerSecond: number;
  equipmentBurnExpiresAtTick: number;
  equipmentBurnNextTick: number;
  equipmentBurnSourceEntityId: EntityId | null;
  revealExpiresAtTick: number;
  pickpocketCooldownTicks: number;
  stunCooldownTicks: number;
  counterCooldownTicks: number;
  lastBasicHitTick: number;
  comboShoesStacks: number;
  comboShoesExpiresAtTick: number;
}

export interface MutableSimulationState {
  tick: number;
  readonly rootSeed: number;
  readonly arenaRadiusMm: number;
  readonly players: Map<EntityId, PlayerEntity>;
  readonly windWalls: Map<EntityId, WindWallEntity>;
  readonly projectiles: Map<EntityId, ProjectileEntity>;
  readonly activeProjectiles: Map<EntityId, ActiveProjectileEntity>;
  readonly activeZones: Map<EntityId, ActiveZoneEntity>;
  readonly activeTargetEffects: Map<string, ActiveTargetEffectState>;
  readonly playerHistoryFrames: PlayerHistoryFrame[];
  readonly monsters: Map<EntityId, MonsterEntity>;
  readonly lootDrops: Map<EntityId, LootDrop>;
  readonly summons: Map<EntityId, SummonEntity>;
  readonly afterimages: Map<EntityId, AfterimageEntity>;
  readonly bountyMarks: BountyMark[];
  readonly activeLootReveals: Map<string, ActiveLootReveal>;
  readonly equipmentReveals: Map<string, EquipmentReveal>;
  readonly airdrops: Map<string, AirdropEntity>;
  readonly airdropChannels: Map<EntityId, AirdropChannel>;
  readonly shops: Map<string, ShopEntity>;
  readonly terminalShopAssignments: Map<string, number>;
  readonly monsterRespawns: MonsterRespawn[];
  readonly coreBossRuntimes: Map<EntityId, CoreBossRuntimeState>;
  readonly coreBossHazards: Map<EntityId, CoreBossHazard>;
  readonly coreBossRevealAnchors: Map<EntityId, CoreBossRevealAnchor>;
  readonly coreBossThreat: Map<EntityId, number>;
  readonly pendingActiveReplacements: Map<EntityId, PendingActiveReplacement>;
  readonly pendingEquipmentPickups: Map<EntityId, PendingEquipmentPickup>;
  readonly pveEnabled: boolean;
  readonly pvePopulation: 'demo' | 'full';
  readonly staticSolids: StaticSolidRect[];
  /** Non-null when the authoritative 840m map is enabled for this match. */
  mapField: import('./geometry/map-collision-field').MapCollisionField | null;
  readonly mapGeometryHash: string | null;
  readonly entityIdByPlayerId: Map<PlayerId, EntityId>;
  readonly random: RandomStreams;
  readonly stormZone: StormZoneState;
  readonly initialSpawnIndices: Set<number>;
  readonly consumedB20PlayerIds: Set<PlayerId>;
  readonly passiveTargetStates: Map<string, PassiveTargetState>;
  readonly eliminationOrder: EntityId[];
  readonly eliminationTicks: Map<EntityId, number>;
  readonly match: MatchState;
  nextEntityId: number;
  nextEquipmentInstanceId: number;
  nextShieldSequence: number;
  nextAirdropChannelSequence: number;
  goldenCudgelDropped: boolean;
}

export interface MonsterRespawn {
  readonly kind: MonsterKind;
  readonly ring: MonsterRing;
  readonly element: FiveElement | null;
  readonly homePosition: Vec2Mm;
  readonly courtId: string | null;
  readonly respawnAtTick: number;
}

export type MatchStatus = 'waiting' | 'running' | 'finished';
export type MatchOutcome = 'winner' | 'tied-first' | 'draw' | 'void-abort';

export interface CultivationAward {
  readonly entityId: EntityId;
  readonly amount: number;
}

export interface MatchState {
  status: MatchStatus;
  startedAtTick: number | null;
  finishedAtTick: number | null;
  outcome: MatchOutcome | null;
  winnerEntityId: EntityId | null;
  winnerEntityIds: EntityId[];
  placements: EntityId[];
  placementGroups: EntityId[][];
  voidAbortReason: 'VOID_ABORT' | null;
  mmrEligible: boolean;
  cultivationAwards: CultivationAward[];
  diagnosticReplayRequired: boolean;
}

export interface MatchSnapshot {
  readonly status: MatchStatus;
  readonly startedAtTick: number | null;
  readonly finishedAtTick: number | null;
  readonly outcome: MatchOutcome | null;
  readonly winnerEntityId: EntityId | null;
  readonly winnerEntityIds: readonly EntityId[];
  readonly placements: readonly EntityId[];
  readonly placementGroups: readonly (readonly EntityId[])[];
  readonly voidAbortReason: 'VOID_ABORT' | null;
  readonly mmrEligible: boolean;
  readonly cultivationAwards: readonly CultivationAward[];
  readonly diagnosticReplayRequired: boolean;
}

export interface PlayerSnapshot {
  readonly entityId: EntityId;
  readonly playerId: PlayerId;
  readonly heroId: HeroId;
  readonly activeAbilityId: ActiveId;
  readonly position: Vec2Mm;
  readonly facing: Vec2Mm;
  readonly hp: number;
  readonly maxHp: number;
  readonly attackPower: number;
  readonly moveSpeedMmPerSecond: number;
  readonly attackRangeMm: number;
  readonly attacksPerSecondMilli: number;
  readonly livesRemaining: number;
  readonly trueDeaths: number;
  readonly lifeState: LifeState;
  readonly attackCooldownTicks: number;
  readonly activeCooldownTicks: number;
  readonly activeBuffTicks: number;
  readonly armedCriticalTicks: number;
  readonly armedMissingHpDamagePercent: number;
  readonly armedActiveId: ActiveId | null;
  readonly activeLifestealTicks: number;
  readonly activeLifestealPercent: number;
  readonly activeDamageReductionTicks: number;
  readonly activeDamageReductionBasisPoints: number;
  readonly activeSpeedBonusTicks: number;
  readonly activeSpeedBonusPercent: number;
  readonly worldInteractionLockTicks: number;
  readonly polymorphTicks: number;
  readonly polymorphSpeedBonusPercent: number;
  readonly stealthTicks: number;
  readonly dormantBootsSpeedTicks: number;
  readonly dormantBootsCooldownTicks: number;
  readonly dormantBootsStealthEpisodeActive: boolean;
  readonly dormantBootsTriggeredThisEpisode: boolean;
  readonly displacementLockTicks: number;
  readonly treasureSenseTicks: number;
  readonly activeBountyStreak: number;
  readonly hardControlTicks: number;
  readonly slowTicks: number;
  readonly slowBasisPoints: number;
  readonly silenceTicks: number;
  readonly silenceCooldownPenaltyTicks: number;
  readonly blindTicks: number;
  readonly blindMissPercent: number;
  readonly blindPreventsCritical: boolean;
  readonly b15SpeedBoostTicks: number;
  readonly b15SpeedBonusPercent: number;
  readonly b21FirstHitReady: boolean;
  readonly b25NextBasicBonusPercent: number;
  readonly b25AttackSpeedBoostTicks: number;
  readonly b25AttackSpeedBonusPercent: number;
  readonly b27SpeedBoostTicks: number;
  readonly b27SpeedBonusPercent: number;
  readonly b30NextAfterimageTick: number;
  readonly b36Stacks: number;
  readonly b36MovingTicks: number;
  readonly b38NextHealTick: number;
  readonly b40KillCount: number;
  readonly b40BonusMaxHp: number;
  readonly b42SpeedBoostTicks: number;
  readonly b42SpeedBonusPercent: number;
  readonly lastCombatTick: number;
  readonly pvpCombatTicks: number;
  readonly totalShield: number;
  readonly whirlwindTicks: number;
  readonly whirlwindNextPulseTick: number;
  readonly b19RetriggerLockTicks: number;
  readonly b20ReviveBuffTicks: number;
  readonly invulnerableTicks: number;
  readonly iceCoffinTicks: number;
  readonly nightCloakStillTicks: number;
  readonly nightCloakStealthed: boolean;
  readonly flightActive: boolean;
  readonly taibaiChannelTicks: number;
  readonly taibaiTargetHeroId: HeroId | null;
  readonly taibaiCooldownTicks: number;
  readonly heishanGambleCount: number;
  readonly consumableVisionTicks: number;
  readonly consumableRevealTicks: number;
  readonly attackPeriodTicks: number;
  readonly respawnTarget: Vec2Mm | null;
  readonly respawnFlightDeadlineTick: number;
  readonly respawnRetryUntilTick: number;
  readonly respawnAttemptCount: number;
  readonly reviveProtectionTicks: number;
  readonly moveRemainderX: number;
  readonly moveRemainderZ: number;
  readonly intent: PlayerIntent;
  readonly b20ChargeAvailable: boolean;
  readonly hasNineTurnPill: boolean;
  readonly passives: readonly PassiveLoadoutEntry[];
  readonly equipment: readonly EquippedEquipmentInstance[];
  readonly inventoryEquipment: readonly EquippedEquipmentInstance[];
  readonly gold: number;
  readonly experience: number;
  readonly level: number;
  readonly gems: number;
  readonly shields: readonly ShieldSnapshot[];
}

export interface MonsterSnapshot {
  readonly entityId: EntityId;
  readonly kind: MonsterKind;
  readonly ring: MonsterRing;
  readonly element: FiveElement | null;
  readonly position: Vec2Mm;
  readonly homePosition: Vec2Mm;
  readonly courtId: string | null;
  readonly facing: Vec2Mm;
  readonly hp: number;
  readonly maxHp: number;
  readonly attackPower: number;
  readonly moveSpeedMmPerSecond: number;
  readonly attackRangeMm: number;
  readonly attackCooldownTicks: number;
  readonly collisionRadiusMm: number;
  readonly targetEntityId: EntityId | null;
  readonly spawnTick: number;
  readonly invulnerableTicks: number;
  readonly hardControlTicks: number;
  readonly slowTicks: number;
  readonly slowBasisPoints: number;
  readonly silenceTicks: number;
  readonly silenceCooldownPenaltyTicks: number;
  readonly blindTicks: number;
  readonly blindMissPercent: number;
  readonly blindPreventsCritical: boolean;
  readonly polymorphTicks: number;
  readonly polymorphSpeedBonusPercent: number;
  readonly displacementLockTicks: number;
  readonly attackPeriodTicks: number;
  readonly aggroRadiusMm: number;
  readonly leashRadiusMm: number;
}

export interface SummonSnapshot {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly kind: SummonKind;
  readonly activeAbilityId?: ActiveId;
  readonly position: Vec2Mm;
  readonly hp: number;
  readonly maxHp: number;
  readonly attackPower: number;
  readonly targetable: boolean;
  readonly expiresAtTick: number;
  readonly attackCooldownTicks: number;
  readonly touchCooldownTicks: number;
  readonly destroyedByHostileDamage: boolean;
}

export interface AfterimageSnapshot {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly position: Vec2Mm;
  readonly slowPercent: number;
  readonly slowDurationTicks: number;
  readonly explosionDamage: number;
  readonly explosionRadiusMm: number;
  readonly expiresAtTick: number;
}

export interface BountyMarkSnapshot {
  readonly sourceEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly rewardGold: number;
  readonly rewardRecipientEntityId: EntityId | null;
  readonly revealToAll: boolean;
  readonly expiresAtTick: number;
}

export type ActiveLootRevealSnapshot = Readonly<ActiveLootReveal>;
export type EquipmentRevealSnapshot = Readonly<EquipmentReveal>;
export type PendingActiveReplacementSnapshot = Readonly<PendingActiveReplacement>;
export type PendingEquipmentPickupSnapshot = Readonly<PendingEquipmentPickup>;

export interface PassiveTargetSnapshot {
  readonly sourceEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly burnStacks: number;
  readonly poisonStacks: number;
  readonly poisonExpiresAtTick: number;
  readonly poisonNextTick: number;
  readonly fireBurnDamagePerSecond: number;
  readonly fireBurnExpiresAtTick: number;
  readonly fireBurnNextTick: number;
  readonly fireBurnSourceEntityId: EntityId | null;
  readonly equipmentBurnDamagePerSecond: number;
  readonly equipmentBurnExpiresAtTick: number;
  readonly equipmentBurnNextTick: number;
  readonly equipmentBurnSourceEntityId: EntityId | null;
  readonly revealExpiresAtTick: number;
  readonly pickpocketCooldownTicks: number;
  readonly stunCooldownTicks: number;
  readonly counterCooldownTicks: number;
  readonly lastBasicHitTick: number;
  readonly comboShoesStacks: number;
  readonly comboShoesExpiresAtTick: number;
}

export interface MonsterRespawnSnapshot {
  readonly kind: MonsterKind;
  readonly ring: MonsterRing;
  readonly element: FiveElement | null;
  readonly homePosition: Vec2Mm;
  readonly courtId: string | null;
  readonly respawnAtTick: number;
}

export type CoreBossRuntimeSnapshot = Readonly<CoreBossRuntimeState>;

export interface CoreBossHazardSnapshot
  extends Omit<Readonly<CoreBossHazard>, 'center' | 'direction' | 'targetMarks' | 'hitEntityIds'> {
  readonly center: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly targetMarks: readonly Readonly<CoreBossTargetMark>[];
  readonly hitEntityIds: readonly EntityId[];
}

export type CoreBossRevealAnchorSnapshot = Readonly<CoreBossRevealAnchor>;

export interface CoreBossThreatSnapshot {
  readonly entityId: EntityId;
  readonly threat: number;
}

export interface ShopSnapshot {
  readonly shopId: string;
  readonly kind: ShopKind;
  readonly position: Vec2Mm;
  readonly anchorId: string | null;
  readonly macroId: string | null;
  readonly openAtTick: number;
  readonly closeAtTick: number;
  readonly version: number;
  readonly status: 'open' | 'relocating';
  readonly nextRelocationAttemptTick: number;
  readonly inventory: readonly ShopListing[];
}

export interface LootSnapshot {
  readonly entityId: EntityId;
  readonly position: Vec2Mm;
  readonly gold: number;
  readonly experience: number;
  readonly gems: number;
  readonly equipmentId: EquipmentId | null;
  readonly bookPassiveId: PassiveId | null;
  readonly createdAtTick: number;
  readonly expiresAtTick: number;
  readonly kind?: LootDropKind;
  readonly activeId?: ActiveId | null;
  readonly equipmentInstanceId?: EquippedEquipmentInstance['instanceId'] | null;
  readonly acquiredAtTick?: number | null;
  readonly permanentAttackBonus?: number;
  readonly stormCoveredSinceTick?: number | null;
}

export interface ShieldSnapshot {
  readonly source: ShieldSource;
  readonly expiresAtTick: number;
  readonly creationSequence: number;
  readonly absorbs: readonly DamageForm[];
  readonly breakEffect: ShieldBreakEffect | null;
  readonly remainingAmount: number;
}

export interface WindWallSnapshot {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly activeAbilityId: ActiveId;
  readonly center: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly lengthMm: number;
  readonly remainingTicks: number;
}

export interface ProjectileSnapshot {
  readonly entityId: EntityId;
  readonly kind: 'basic' | 'cold-arrow';
  readonly ownerEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly position: Vec2Mm;
  readonly speedMmPerSecond: number;
  readonly collisionRadiusMm: number;
  readonly sourceElement: FiveElement;
  readonly baseDamage: number;
  readonly outgoingDamageBasisPoints: number;
  readonly activeAbilityId?: ActiveId;
  readonly createdAtTick: number;
  readonly remainingTravelMm: number;
  readonly movementRemainder: number;
}

export interface ActiveProjectileSnapshot {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly activeId: ActiveId;
  readonly kind: ActiveProjectileEntity['kind'];
  readonly position: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly speedMmPerSecond: number;
  readonly collisionRadiusMm: number;
  readonly fixedDamage: number;
  readonly attackCoefficientBasisPoints: number;
  readonly rootTicks: number;
  readonly displacementMm: number;
  readonly effectDurationTicks: number;
  readonly effectSpeedBonusPercent: number;
  readonly triggerHardControlTicks: number;
  readonly damagePerDistanceBasisPoints: number;
  readonly maximumDistanceBonusPercent: number;
  readonly targetEntityId: EntityId | null;
  readonly createdAtTick: number;
  readonly remainingTravelMm: number;
  readonly distanceTravelledMm: number;
  readonly movementRemainder: number;
}

export type ActiveZoneSnapshot = Readonly<ActiveZoneEntity>;

export type ActiveTargetEffectSnapshot = Readonly<ActiveTargetEffectState>;

export type PlayerHistorySnapshot = Readonly<PlayerHistoryFrame>;

export interface WorldSnapshot {
  readonly tick: number;
  readonly rootSeed: number;
  readonly stateHash: string;
  readonly match: MatchSnapshot;
  readonly stormZone: StormZoneSnapshot;
  readonly mapGeometryHash: string | null;
  readonly staticSolids: readonly StaticSolidRect[];
  readonly players: readonly PlayerSnapshot[];
  readonly monsters: readonly MonsterSnapshot[];
  readonly monsterRespawns: readonly MonsterRespawnSnapshot[];
  readonly coreBossRuntimes: readonly CoreBossRuntimeSnapshot[];
  readonly coreBossHazards: readonly CoreBossHazardSnapshot[];
  readonly coreBossRevealAnchors: readonly CoreBossRevealAnchorSnapshot[];
  readonly coreBossThreat: readonly CoreBossThreatSnapshot[];
  readonly pendingActiveReplacements: readonly PendingActiveReplacementSnapshot[];
  readonly pendingEquipmentPickups: readonly PendingEquipmentPickupSnapshot[];
  readonly lootDrops: readonly LootSnapshot[];
  readonly summons: readonly SummonSnapshot[];
  readonly afterimages: readonly AfterimageSnapshot[];
  readonly bountyMarks: readonly BountyMarkSnapshot[];
  readonly activeLootReveals: readonly ActiveLootRevealSnapshot[];
  readonly equipmentReveals: readonly EquipmentRevealSnapshot[];
  readonly passiveTargetStates: readonly PassiveTargetSnapshot[];
  readonly shops: readonly ShopSnapshot[];
  readonly windWalls: readonly WindWallSnapshot[];
  readonly projectiles: readonly ProjectileSnapshot[];
  readonly activeProjectiles: readonly ActiveProjectileSnapshot[];
  readonly activeZones: readonly ActiveZoneSnapshot[];
  readonly activeTargetEffects: readonly ActiveTargetEffectSnapshot[];
  readonly playerHistoryFrames: readonly PlayerHistorySnapshot[];
  readonly airdrops: readonly AirdropSnapshot[];
  readonly airdropChannels: readonly AirdropChannelSnapshot[];
}

export type AirdropSnapshot = Readonly<AirdropEntity>;
export type AirdropChannelSnapshot = Readonly<AirdropChannel>;

export interface StormZoneSnapshot {
  readonly selectedCourtId: string | null;
  readonly courtAnnouncementTick: number;
  readonly warningTick: number;
  readonly center: Vec2Mm;
  readonly radiusMm: number;
  readonly courtAnnounced: boolean;
  readonly apocalypseWarning: boolean;
  readonly apocalypseStarted: boolean;
}

export type SimEvent =
  | {
      readonly type: 'player-added';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly playerId: PlayerId;
      readonly heroId: HeroId;
    }
  | {
      readonly type: 'basic-attack';
      readonly tick: number;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId;
    }
  | {
      readonly type: 'monster-spawned';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly kind: MonsterKind;
    }
  | {
      readonly type: 'monster-damaged';
      readonly tick: number;
      readonly sourceEntityId: EntityId | null;
      readonly targetEntityId: EntityId;
      readonly activeAbilityId?: ActiveId;
      readonly amount: number;
      readonly remainingHp: number;
    }
  | {
      readonly type: 'monster-killed';
      readonly tick: number;
      readonly sourceEntityId: EntityId | null;
      readonly targetEntityId: EntityId;
      readonly kind: MonsterKind;
    }
  | {
      readonly type: 'core-boss-cast';
      readonly tick: number;
      readonly bossEntityId: EntityId;
      readonly hazardEntityId: EntityId;
      readonly abilityId: CoreBossAbilityId;
      readonly phase: 'warning' | 'resolved';
      readonly center: Vec2Mm;
      readonly activatesAtTick: number;
    }
  | {
      readonly type: 'core-boss-migrated';
      readonly tick: number;
      readonly bossEntityId: EntityId;
      readonly fromCourtId: string | null;
      readonly toCourtId: string | null;
      readonly position: Vec2Mm;
      readonly hp: number;
      readonly maxHp: number;
    }
  | {
      readonly type: 'core-boss-reveal-anchor';
      readonly tick: number;
      readonly bossEntityId: EntityId;
      readonly anchorEntityId: EntityId;
      readonly position: Vec2Mm;
      readonly expiresAtTick: number;
    }
  | {
      readonly type: 'loot-dropped';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly sourceEntityId: EntityId;
      readonly gold: number;
      readonly experience: number;
      readonly gems: number;
      readonly equipmentId: EquipmentId | null;
      readonly bookPassiveId: PassiveId | null;
      readonly activeId?: ActiveId | null;
      readonly lootKind?: LootDropKind;
    }
  | {
      readonly type: 'loot-collected';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly collectorEntityId: EntityId;
      readonly gold: number;
      readonly experience: number;
      readonly gems: number;
      readonly equipmentId: EquipmentId | null;
      readonly bookPassiveId: PassiveId | null;
      readonly activeId?: ActiveId | null;
      readonly lootKind?: LootDropKind;
    }
  | {
      readonly type: 'loot-expired';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly lootKind: LootDropKind | undefined;
      readonly reason: 'natural-expiry' | 'storm';
    }
  | {
      readonly type: 'active-replacement-required';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly lootEntityId: EntityId;
      readonly activeId: ActiveId;
      readonly currentActiveId: ActiveId;
    }
  | {
      readonly type: 'active-replacement-cancelled';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly lootEntityId: EntityId;
      readonly reason:
        | 'declined'
        | 'player-unavailable'
        | 'loot-unavailable'
        | 'out-of-range'
        | 'line-of-sight'
        | 'active-changed';
    }
  | {
      readonly type: 'equipment-pickup-replacement-required';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly lootEntityId: EntityId;
      readonly equipmentId: EquipmentId;
      readonly equipmentInstanceId: EquippedEquipmentInstance['instanceId'] | null;
      readonly handCapacity: number;
      readonly equippedCapacity: number;
    }
  | {
      readonly type: 'equipment-pickup-replacement-cancelled';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly lootEntityId: EntityId;
      readonly reason:
        | 'declined'
        | 'player-unavailable'
        | 'loot-unavailable'
        | 'out-of-range'
        | 'line-of-sight'
        | 'equipment-changed';
    }
  | {
      readonly type: 'active-replaced';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly lootEntityId: EntityId;
      readonly previousActiveId: ActiveId;
      readonly activeId: ActiveId;
      readonly cooldownTicks: number;
    }
  | {
      readonly type: 'equipment-equipped' | 'equipment-unequipped' | 'equipment-discarded';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly instanceId: EquippedEquipmentInstance['instanceId'];
      readonly equipmentId: EquipmentId;
      readonly replacementInstanceId?: EquippedEquipmentInstance['instanceId'] | null;
    }
  | {
      readonly type: 'hero-kill-reward';
      readonly tick: number;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId;
      readonly gold: number;
      readonly experience: number;
      readonly eliminated: boolean;
    }
  | {
      readonly type: 'passive-upgraded';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly passiveId: PassiveId;
      readonly level: PassiveLevel;
      readonly source: 'gem' | 'skill-book';
    }
  | {
      readonly type: 'passive-learned';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly passiveId: PassiveId;
      readonly source: 'skill-book';
    }
  | {
      readonly type: 'damage';
      readonly tick: number;
      readonly sourceEntityId: EntityId | null;
      readonly targetEntityId: EntityId;
      readonly activeAbilityId?: ActiveId;
      readonly cause: DamageCause;
      readonly form: DamageForm;
      readonly isCritical: boolean;
      readonly amount: number;
      readonly shieldDamage: number;
      readonly hpDamage: number;
      readonly shieldBypassHpDamage: number;
      readonly remainingHp: number;
      readonly remainingShield: number;
    }
  | {
      readonly type: 'critical-hit';
      readonly tick: number;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId;
      readonly passiveId: PassiveId;
      readonly criticalDamagePercent: number;
      readonly shieldBypassPercent: number;
    }
  | {
      readonly type: 'passive-shield-created';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly sourceEntityId: EntityId;
      readonly passiveId: PassiveId;
      readonly amount: number;
      readonly durationTicks: number;
    }
  | {
      readonly type: 'passive-proc';
      readonly tick: number;
      readonly passiveId: PassiveId;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId | null;
      readonly detail: string;
      readonly amount: number;
      readonly durationTicks: number;
      readonly activeAbilityId?: ActiveId;
    }
  | {
      readonly type: 'equipment-proc';
      readonly tick: number;
      readonly equipmentId: EquipmentId;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId | null;
      readonly detail: string;
      readonly amount: number;
      readonly durationTicks: number;
    }
  | {
      readonly type: 'summon-spawned';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly ownerEntityId: EntityId;
      readonly summonKind: SummonKind;
      readonly activeAbilityId?: ActiveId;
    }
  | {
      readonly type: 'summon-expired';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly ownerEntityId: EntityId;
      readonly summonKind: SummonKind;
      readonly activeAbilityId?: ActiveId;
    }
  | {
      readonly type: 'active-cast';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly heroId: HeroId;
      readonly activeAbilityId: ActiveId;
      readonly activeName: string;
    }
  | {
      readonly type: 'active-world-spawned' | 'active-world-expired';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly ownerEntityId: EntityId;
      readonly activeAbilityId: ActiveId;
      readonly activeWorldKind: ActiveZoneKind | ActiveProjectileEntity['kind'] | 'wind-wall';
    }
  | {
      readonly type: 'active-world-damaged';
      readonly tick: number;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId;
      readonly activeAbilityId: ActiveId;
      readonly amount: number;
      readonly remainingHp: number;
    }
  | {
      readonly type: 'active-heal';
      readonly tick: number;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId;
      readonly activeAbilityId: ActiveId;
      readonly amount: number;
      readonly remainingHp: number;
    }
  | {
      readonly type: 'active-status-applied';
      readonly tick: number;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId;
      readonly activeAbilityId: ActiveId;
      readonly status: ActiveStatusKind;
      readonly durationTicks: number;
    }
  | {
      readonly type: 'active-status-ended';
      readonly tick: number;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId;
      readonly activeAbilityId: ActiveId;
      readonly status: ActiveStatusKind;
    }
  | {
      readonly type: 'active-unavailable';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly heroId: HeroId;
      readonly activeAbilityId: ActiveId;
      readonly activeName: string;
    }
  | {
      readonly type: 'active-target-missing';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly heroId: HeroId;
      readonly activeAbilityId: ActiveId;
      readonly activeName: string;
    }
  | {
      readonly type: 'active-cast-blocked';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly heroId: HeroId;
      readonly activeAbilityId: ActiveId;
      readonly activeName: string;
      readonly reason: 'displacement-locked' | 'polymorphed';
    }
  | {
      readonly type: 'shop-opened';
      readonly tick: number;
      readonly shopId: string;
      readonly kind: ShopKind;
      readonly version: number;
    }
  | {
      readonly type: 'shop-relocating';
      readonly tick: number;
      readonly shopId: string;
      readonly kind: ShopKind;
      readonly version: number;
      readonly retryAtTick: number;
    }
  | {
      readonly type: 'shop-closed';
      readonly tick: number;
      readonly shopId: string;
      readonly kind: ShopKind;
      readonly version: number;
      readonly reason: 'schedule-ended' | 'unsafe-position' | 'safe-radius-zero';
    }
  | {
      readonly type: 'shop-purchase';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly shopId: string;
      readonly listingId: string;
      readonly equipmentId: EquipmentId | null;
      readonly goldSpent: number;
      readonly listingKind?: ShopListing['kind'];
    }
  | {
      readonly type: 'shop-sale';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly shopId: string;
      readonly instanceId: EquippedEquipmentInstance['instanceId'];
      readonly equipmentId: EquipmentId;
      readonly goldReceived: number;
    }
  | {
      readonly type: 'hero-swap-channel';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly targetHeroId: HeroId;
      readonly phase: 'started' | 'completed' | 'cancelled';
      readonly goldSpent: number;
      readonly reason?: 'damaged' | 'left-tether' | 'shop-unavailable' | 'player-unavailable';
    }
  | {
      readonly type: 'gamble-resolved';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly gambleKind: GambleKind;
      readonly outcome: GambleOutcome;
      readonly goldMode: GambleGoldMode | null;
      readonly wagerGold: number;
      readonly rewardGold: number;
      readonly equipmentId: EquipmentId | null;
      readonly passiveId: PassiveId | null;
      readonly activeId: ActiveId | null;
    }
  | {
      readonly type: 'airdrop-warning';
      readonly tick: number;
      readonly airdropId: string;
      readonly scheduledAtTick: number;
      readonly position: Vec2Mm;
    }
  | {
      readonly type: 'airdrop-landed';
      readonly tick: number;
      readonly airdropId: string;
      readonly position: Vec2Mm;
      readonly expiresAtTick: number;
    }
  | {
      readonly type: 'airdrop-channel';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly airdropId: string;
      readonly phase: 'started' | 'cancelled' | 'completed';
      readonly reason?:
        | 'moved'
        | 'damaged'
        | 'forced-displacement'
        | 'hard-control'
        | 'true-death'
        | 'expired'
        | 'opened-by-other';
    }
  | {
      readonly type: 'airdrop-opened';
      readonly tick: number;
      readonly airdropId: string;
      readonly entityId: EntityId;
      readonly equipmentId: EquipmentId;
      readonly lootEntityId: EntityId;
      readonly rewardGold: number;
    }
  | {
      readonly type: 'airdrop-expired';
      readonly tick: number;
      readonly airdropId: string;
    }
  | {
      readonly type: 'projectile-blocked';
      readonly tick: number;
      readonly projectileEntityId: EntityId;
      readonly sourceEntityId: EntityId;
      readonly targetEntityId: EntityId;
      readonly wallEntityId: EntityId | null;
      readonly blockingSolidId: string | null;
      readonly projectileKind: 'basic' | 'cold-arrow';
    }
  | {
      readonly type: 'blink';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly previousPosition: Vec2Mm;
      readonly newPosition: Vec2Mm;
      readonly requestedDistanceMm: number;
      readonly actualDistanceMm: number;
      readonly blockingSolidId: string | null;
    }
  | {
      readonly type: 'lethal-protection';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly protection: 'b19-feign-death';
      readonly hpRestored: number;
      readonly previousPosition: Vec2Mm;
      readonly newPosition: Vec2Mm;
      readonly didBlink: boolean;
    }
  | {
      readonly type: 'lethal-protection';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly protection: 'b20-passive-revive';
      readonly hpRestored: number;
      readonly buffTicks: number;
    }
  | {
      readonly type: 'lethal-protection';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly protection: 'g1-nine-turn-pill';
      readonly hpRestored: number;
      readonly consumedEquipmentInstanceId: EquippedEquipmentInstance['instanceId'];
      readonly invulnerableTicks: number;
    }
  | {
      readonly type: 'true-death';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly trueDeaths: number;
      readonly livesRemaining: number;
    }
  | {
      readonly type: 'respawn';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly position: Vec2Mm;
    }
  | {
      readonly type: 'revive-protection-ended';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly reason: 'timeout' | 'intent';
    }
  | {
      readonly type: 'eliminated';
      readonly tick: number;
      readonly entityId: EntityId;
      readonly placementBasis: 'third-true-death';
    }
  | {
      readonly type: 'match-started';
      readonly tick: number;
      readonly competitorCount: number;
    }
  | {
      readonly type: 'final-court-announced';
      readonly tick: number;
      readonly courtId: string;
      readonly center: Vec2Mm;
    }
  | {
      readonly type: 'apocalypse-warning' | 'apocalypse-started';
      readonly tick: number;
      readonly courtId: string | null;
      readonly center: Vec2Mm;
    }
  | {
      readonly type: 'match-ended';
      readonly tick: number;
      readonly outcome: MatchOutcome;
      readonly winnerEntityId: EntityId | null;
      readonly winnerEntityIds: readonly EntityId[];
      readonly placements: readonly EntityId[];
      readonly placementGroups: readonly (readonly EntityId[])[];
      readonly voidAbortReason: 'VOID_ABORT' | null;
      readonly mmrEligible: boolean;
      readonly cultivationAwards: readonly CultivationAward[];
      readonly diagnosticReplayRequired: boolean;
    };

export interface AddPlayerOptions {
  readonly playerId: PlayerId;
  readonly heroId: HeroId;
  readonly position?: Vec2Mm;
  readonly activeAbilityId?: ActiveId;
  readonly passives?: readonly PassiveLoadoutEntry[];
  readonly equipmentIds?: readonly EquipmentId[];
}

export interface PveSimulationOptions {
  readonly enabled: boolean;
  readonly population?: 'demo' | 'full';
}

export interface MapSimulationOptions {
  readonly enabled: boolean;
}

export type ActiveReplacementTransactionCode =
  | 'accepted'
  | 'match-finished'
  | 'player-not-alive'
  | 'active-replacement-not-found'
  | 'active-loot-not-found'
  | 'active-loot-too-far'
  | 'active-loot-line-of-sight'
  | 'active-already-equipped'
  | 'active-changed'
  | 'active-replacement-declined';

export interface ActiveReplacementTransactionResult {
  readonly accepted: boolean;
  readonly code: ActiveReplacementTransactionCode;
}

export type EquipmentLootPickupDestination = 'inventory' | 'equipped' | 'cancel';

export type EquipmentLootPickupTransactionCode =
  | 'accepted'
  | 'match-finished'
  | 'player-not-alive'
  | 'equipment-loot-not-found'
  | 'equipment-loot-too-far'
  | 'equipment-loot-line-of-sight'
  | 'equipment-pickup-not-found'
  | 'equipment-pickup-declined'
  | 'equipment-changed'
  | 'hand-full'
  | 'equipped-full'
  | 'duplicate-equipped'
  | 'replacement-required'
  | 'invalid-replacement';

export interface EquipmentLootPickupTransactionResult {
  readonly accepted: boolean;
  readonly code: EquipmentLootPickupTransactionCode;
}

export interface DamageRequest {
  readonly sourceEntityId: EntityId | null;
  readonly targetEntityId: EntityId;
  readonly amount: number;
  readonly cause: DamageCause;
  readonly form: DamageForm;
  readonly activeAbilityId?: ActiveId;
  readonly outgoingDamageBasisPointsOverride?: number;
  readonly isCritical?: boolean;
  readonly shieldBypassBasisPoints?: number;
  readonly periodic?: boolean;
  readonly ignoreExecute?: boolean;
  readonly ignoreSourceBonuses?: boolean;
}

export interface ReplayRosterEntry {
  readonly entityId: EntityId;
  readonly joinedAtTick: number;
  readonly playerId: PlayerId;
  readonly heroId: HeroId;
  readonly activeAbilityId: ActiveId;
  readonly position?: Vec2Mm;
  readonly passives: readonly PassiveLoadoutEntry[];
  readonly equipmentIds: readonly EquipmentId[];
}

export interface ReplayInputEntry {
  readonly atTick: number;
  readonly entityId: EntityId;
  readonly intent: PlayerIntent;
}

export interface SimulationReplay {
  readonly rootSeed: number;
  readonly staticSolids: readonly StaticSolidRect[];
  readonly pve?: PveSimulationOptions;
  readonly map?: MapSimulationOptions;
  readonly roster: readonly ReplayRosterEntry[];
  readonly inputs: readonly ReplayInputEntry[];
  readonly finalTick: number;
  readonly expectedStateHash: string;
}
