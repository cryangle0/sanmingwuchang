import type {
  ActiveId,
  EntityId,
  EquipmentId,
  EquipmentInstanceId,
  HeroId,
  PassiveId,
  PlayerId,
  PlayerIntent,
  Vec2Mm,
} from '@jwgb/core';

export type WireMonsterKind =
  | 'ground-melee'
  | 'ground-ranged'
  | 'flying'
  | 'pig'
  | 'elite-tank'
  | 'elite-ranged'
  | 'dragon-king'
  | 'core-boss';
export type WireMonsterRing = 'outer' | 'middle' | 'inner' | 'den' | 'arena' | 'court';
export type WireAirdropPhase = 'pending' | 'warning' | 'available' | 'opened' | 'expired';
export type WireActiveStatusKind =
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

export const PROTOCOL_VERSION = 15;
export type WireFiveElement = 'metal' | 'wood' | 'water' | 'fire' | 'earth';
export type WireCoreBossAbilityId =
  | 'ring-shockwave'
  | 'meteor'
  | 'earthbreak'
  | 'firelane'
  | 'poisonpool'
  | 'windcharge'
  | 'thunderchain'
  | 'mirrorshadow';

export interface WirePassiveLoadoutEntry {
  readonly passiveId: PassiveId;
  readonly level: 1 | 2 | 3 | 4 | 5;
}

export interface WireEquipmentInstance {
  readonly instanceId: EquipmentInstanceId;
  readonly equipmentId: EquipmentId;
  readonly acquiredAtTick: number;
  readonly permanentAttackBonus: number;
}

export interface WireShieldSnapshot {
  readonly source:
    | {
        readonly kind: 'active';
        readonly activeId: ActiveId;
      }
    | {
        readonly kind: 'passive';
        readonly passiveId: PassiveId;
      };
  readonly expiresAtTick: number;
  readonly creationSequence: number;
  readonly absorbs: readonly [
    'basic' | 'skill' | 'dot' | 'percent' | 'reflect' | 'true' | 'storm',
  ][number][];
  readonly breakEffect: {
    readonly sourceEntityId: EntityId;
    readonly sourceElement: WireFiveElement;
    readonly damage: number;
    readonly radiusMm: number;
  } | null;
  readonly remainingAmount: number;
}

export interface WirePlayerSnapshot {
  readonly entityId: EntityId;
  readonly playerId: PlayerId;
  readonly heroId: HeroId;
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
  readonly lifeState: 'alive' | 'soul-flight' | 'revive-protection' | 'eliminated';
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
  readonly taibaiChannelTicks: number;
  readonly taibaiTargetHeroId: HeroId | null;
  readonly taibaiCooldownTicks: number;
  readonly heishanGambleCount: number;
  readonly consumableVisionTicks: number;
  readonly consumableRevealTicks: number;
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
  readonly activeAbilityId: ActiveId;
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
  readonly passives: readonly WirePassiveLoadoutEntry[];
  readonly equipment: readonly WireEquipmentInstance[];
  readonly inventoryEquipment: readonly WireEquipmentInstance[];
  readonly gold: number;
  readonly experience: number;
  readonly level: number;
  readonly gems: number;
  readonly shields: readonly WireShieldSnapshot[];
}

export interface WireWindWallSnapshot {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly activeAbilityId: ActiveId;
  readonly center: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly lengthMm: number;
  readonly remainingTicks: number;
}

export interface WireProjectileSnapshot {
  readonly entityId: EntityId;
  readonly kind: 'basic' | 'cold-arrow';
  readonly ownerEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly position: Vec2Mm;
  readonly speedMmPerSecond: number;
  readonly collisionRadiusMm: number;
  readonly sourceElement: WireFiveElement;
  readonly baseDamage: number;
  readonly outgoingDamageBasisPoints: number;
  readonly activeAbilityId?: ActiveId;
  readonly createdAtTick: number;
  readonly remainingTravelMm: number;
  readonly movementRemainder: number;
}

export interface WireMonsterSnapshot {
  readonly entityId: EntityId;
  readonly kind: WireMonsterKind;
  readonly ring: WireMonsterRing;
  readonly element: WireFiveElement | null;
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

export interface WireMonsterRespawnSnapshot {
  readonly kind: WireMonsterKind;
  readonly ring: WireMonsterRing;
  readonly element: WireFiveElement | null;
  readonly homePosition: Vec2Mm;
  readonly courtId: string | null;
  readonly respawnAtTick: number;
}

export interface WireCoreBossTargetMark {
  readonly targetEntityId: EntityId | null;
  readonly position: Vec2Mm;
}

export interface WireCoreBossRuntimeSnapshot {
  readonly bossEntityId: EntityId;
  readonly courtId: string | null;
  readonly nextRingCastTick: number;
  readonly nextMeteorCastTick: number;
  readonly nextSignatureCastTick: number;
  readonly signatureIndex: number;
}

export interface WireCoreBossHazardSnapshot {
  readonly entityId: EntityId;
  readonly bossEntityId: EntityId;
  readonly abilityId: WireCoreBossAbilityId;
  readonly createdAtTick: number;
  readonly activatesAtTick: number;
  readonly expiresAtTick: number;
  readonly center: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly radiusMm: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly damage: number;
  readonly damagePerSecond: number;
  readonly hardControlTicks: number;
  readonly displacementMm: number;
  readonly gapIndex: number;
  readonly resolved: boolean;
  readonly nextPulseTick: number;
  readonly pulseIntervalTicks: number;
  readonly targetMarks: readonly WireCoreBossTargetMark[];
  readonly hitEntityIds: readonly EntityId[];
}

export interface WireCoreBossRevealAnchorSnapshot {
  readonly entityId: EntityId;
  readonly bossEntityId: EntityId;
  readonly position: Vec2Mm;
  readonly expiresAtTick: number;
}

export interface WireCoreBossThreatSnapshot {
  readonly entityId: EntityId;
  readonly threat: number;
}

export interface WirePendingActiveReplacementSnapshot {
  readonly playerEntityId: EntityId;
  readonly lootEntityId: EntityId;
  readonly activeId: ActiveId;
  readonly requestedAtTick: number;
}

export interface WirePendingEquipmentPickupSnapshot {
  readonly playerEntityId: EntityId;
  readonly lootEntityId: EntityId;
  readonly equipmentId: EquipmentId;
  readonly equipmentInstanceId: EquipmentInstanceId | null;
  readonly requestedAtTick: number;
}

export interface WireSummonSnapshot {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly activeAbilityId?: ActiveId;
  readonly kind:
    | 'wolf-spirit'
    | 'fire-spirit'
    | 'stone-statue'
    | 'decoy'
    | 'stone-arhat'
    | 'bean-soldier'
    | 'core-mirror';
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

export interface WireActiveProjectileSnapshot {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly activeId: ActiveId;
  readonly kind: 'line-damage' | 'root' | 'hook' | 'polymorph';
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

export interface WireActiveZoneSnapshot {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly activeId: ActiveId;
  readonly kind:
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
  readonly targetEntityId: EntityId | null;
  readonly center: Vec2Mm;
  readonly direction: Vec2Mm;
  readonly radiusMm: number;
  readonly lengthMm: number;
  readonly createdAtTick: number;
  readonly activatesAtTick: number;
  readonly expiresAtTick: number;
  readonly nextPulseTick: number;
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
  readonly hp: number;
  readonly maxHp: number;
  readonly targetable: boolean;
  readonly followsOwner: boolean;
  readonly followTargetEntityId: EntityId | null;
  readonly generation: number;
}

export interface WireActiveTargetEffectSnapshot {
  readonly key: string;
  readonly sourceEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly activeId: ActiveId;
  readonly kind: WireActiveStatusKind;
  readonly stacks: number;
  readonly maximumStacks: number;
  readonly fixedDamage: number;
  readonly attackCoefficientBasisPoints: number;
  readonly percentDamage: number;
  readonly targetDamageBonusPercent: number;
  readonly revealToSource: boolean;
  readonly expiresAtTick: number;
  readonly nextPulseTick: number;
  readonly pulseIntervalTicks: number;
}

export interface WireAfterimageSnapshot {
  readonly entityId: EntityId;
  readonly ownerEntityId: EntityId;
  readonly position: Vec2Mm;
  readonly slowPercent: number;
  readonly slowDurationTicks: number;
  readonly explosionDamage: number;
  readonly explosionRadiusMm: number;
  readonly expiresAtTick: number;
}

export interface WireBountyMarkSnapshot {
  readonly sourceEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly rewardGold: number;
  readonly revealToAll: boolean;
  readonly expiresAtTick: number;
}

export interface WirePassiveTargetSnapshot {
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
  readonly revealExpiresAtTick: number;
  readonly pickpocketCooldownTicks: number;
  readonly stunCooldownTicks: number;
  readonly counterCooldownTicks: number;
  readonly lastBasicHitTick: number;
  readonly comboShoesStacks: number;
  readonly comboShoesExpiresAtTick: number;
}

export interface WireShopListing {
  readonly listingId: string;
  readonly kind: 'equipment' | 'gem' | 'consumable';
  readonly equipmentId: EquipmentId | null;
  readonly price: number;
  readonly consumableId?: 'clairvoyance-talisman' | 'demon-revealing-mirror' | null;
}

export interface WireShopSnapshot {
  readonly shopId: string;
  readonly kind: 'land-god' | 'shoemaker' | 'taibai' | 'heishan';
  readonly position: Vec2Mm;
  readonly anchorId: string | null;
  readonly macroId: string | null;
  readonly openAtTick: number;
  readonly closeAtTick: number;
  readonly version: number;
  readonly status: 'open' | 'relocating';
  readonly nextRelocationAttemptTick: number;
  readonly inventory: readonly WireShopListing[];
}

export interface WireAirdropSnapshot {
  readonly id: string;
  readonly sequence: 1 | 2 | 3;
  readonly scheduledElapsedTick: number;
  readonly phase: WireAirdropPhase;
  readonly position: Vec2Mm | null;
  readonly announcedAtTick: number | null;
  readonly landedAtTick: number | null;
  readonly expiresAtTick: number | null;
  readonly openedAtTick: number | null;
  readonly openedByEntityId: EntityId | null;
  readonly equipmentId: EquipmentId | null;
  readonly lootEntityId: EntityId | null;
}

export interface WireAirdropChannelSnapshot {
  readonly sequence: number;
  readonly playerEntityId: EntityId;
  readonly airdropId: string;
  readonly startedAtTick: number;
  readonly completesAtTick: number;
  readonly originPosition: Vec2Mm;
}

export interface WireLootSnapshot {
  readonly entityId: EntityId;
  readonly position: Vec2Mm;
  readonly gold: number;
  readonly experience: number;
  readonly gems: number;
  readonly equipmentId: EquipmentId | null;
  readonly bookPassiveId: PassiveId | null;
  readonly createdAtTick: number;
  readonly expiresAtTick: number;
  readonly kind?:
    | 'currency'
    | 'skill-book'
    | 'equipment'
    | 'death-equipment'
    | 'active'
    | 'chest'
    | 'consumable';
  readonly activeId?: ActiveId | null;
  readonly equipmentInstanceId?: EquipmentInstanceId | null;
  readonly acquiredAtTick?: number | null;
  readonly permanentAttackBonus?: number;
  readonly stormCoveredSinceTick?: number | null;
}

export interface WireStaticSolidRect {
  readonly solidId: string;
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumZ: number;
  readonly maximumZ: number;
}

export interface WireWorldSnapshot {
  readonly tick: number;
  readonly rootSeed: number;
  readonly stateHash: string;
  readonly stormZone: {
    readonly selectedCourtId: string | null;
    readonly courtAnnouncementTick: number;
    readonly warningTick: number;
    readonly center: Vec2Mm;
    readonly radiusMm: number;
    readonly courtAnnounced: boolean;
    readonly apocalypseWarning: boolean;
    readonly apocalypseStarted: boolean;
  };
  readonly match: {
    readonly status: 'waiting' | 'running' | 'finished';
    readonly startedAtTick: number | null;
    readonly finishedAtTick: number | null;
    readonly outcome: 'winner' | 'tied-first' | 'draw' | 'void-abort' | null;
    readonly winnerEntityId: EntityId | null;
    readonly winnerEntityIds: readonly EntityId[];
    readonly placements: readonly EntityId[];
    readonly placementGroups: readonly (readonly EntityId[])[];
    readonly voidAbortReason: 'VOID_ABORT' | null;
    readonly mmrEligible: boolean;
    readonly cultivationAwards: readonly {
      readonly entityId: EntityId;
      readonly amount: number;
    }[];
    readonly diagnosticReplayRequired: boolean;
  };
  readonly staticSolids: readonly WireStaticSolidRect[];
  readonly players: readonly WirePlayerSnapshot[];
  readonly monsters: readonly WireMonsterSnapshot[];
  readonly monsterRespawns: readonly WireMonsterRespawnSnapshot[];
  readonly coreBossRuntimes: readonly WireCoreBossRuntimeSnapshot[];
  readonly coreBossHazards: readonly WireCoreBossHazardSnapshot[];
  readonly coreBossRevealAnchors: readonly WireCoreBossRevealAnchorSnapshot[];
  readonly coreBossThreat: readonly WireCoreBossThreatSnapshot[];
  readonly pendingActiveReplacements: readonly WirePendingActiveReplacementSnapshot[];
  readonly pendingEquipmentPickups: readonly WirePendingEquipmentPickupSnapshot[];
  readonly lootDrops: readonly WireLootSnapshot[];
  readonly summons: readonly WireSummonSnapshot[];
  readonly afterimages: readonly WireAfterimageSnapshot[];
  readonly bountyMarks: readonly WireBountyMarkSnapshot[];
  readonly passiveTargetStates: readonly WirePassiveTargetSnapshot[];
  readonly shops: readonly WireShopSnapshot[];
  readonly airdrops: readonly WireAirdropSnapshot[];
  readonly airdropChannels: readonly WireAirdropChannelSnapshot[];
  readonly windWalls: readonly WireWindWallSnapshot[];
  readonly projectiles: readonly WireProjectileSnapshot[];
  readonly activeProjectiles: readonly WireActiveProjectileSnapshot[];
  readonly activeZones: readonly WireActiveZoneSnapshot[];
  readonly activeTargetEffects: readonly WireActiveTargetEffectSnapshot[];
}

export type ClientMessage =
  | {
      readonly type: 'matchmaking-enqueue';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly rulesetVersion: string;
      readonly playerId: PlayerId;
    }
  | {
      readonly type: 'matchmaking-cancel';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
    }
  | {
      readonly type: 'matchmaking-reroll';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly matchId: string;
    }
  | {
      readonly type: 'matchmaking-select';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly matchId: string;
      readonly heroId: HeroId;
    }
  | {
      readonly type: 'join';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly rulesetVersion: string;
      readonly playerId: PlayerId;
      readonly heroId: HeroId;
      readonly matchTicket?: string;
    }
  | {
      readonly type: 'resume';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly rulesetVersion: string;
      readonly playerId: PlayerId;
      readonly recoveryToken: string;
    }
  | {
      readonly type: 'snapshot-ack';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly snapshotTick: number;
      readonly stateHash: string;
    }
  | {
      readonly type: 'airdrop-open';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly airdropId: string;
    }
  | {
      readonly type: 'input';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly sequence: number;
      readonly moveX: number;
      readonly moveZ: number;
      readonly aimX: number;
      readonly aimZ: number;
      readonly attack: boolean;
      readonly targetEntityId: EntityId | null;
      readonly secondaryTargetEntityId?: EntityId | null;
      readonly castActive: boolean;
      readonly alternateActive?: boolean;
      readonly interact: boolean;
    }
  | {
      readonly type: 'ping';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly clientTime: number;
    }
  | {
      readonly type: 'shop-purchase';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly shopId: string;
      readonly listingId: string;
      readonly expectedVersion: number;
      readonly destination: 'equipped' | 'inventory';
    }
  | {
      readonly type: 'shop-sale';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly shopId: string;
      readonly instanceId: EquipmentInstanceId;
      readonly expectedVersion: number;
    }
  | {
      readonly type: 'hero-swap';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly shopId: string;
      readonly expectedVersion: number;
      readonly targetHeroId: HeroId;
    }
  | {
      readonly type: 'gamble-passive';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly shopId: string;
      readonly expectedVersion: number;
      readonly passiveId: PassiveId;
    }
  | {
      readonly type: 'gamble-equipment';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly shopId: string;
      readonly expectedVersion: number;
      readonly instanceId: EquipmentInstanceId;
    }
  | {
      readonly type: 'gamble-active';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly shopId: string;
      readonly expectedVersion: number;
    }
  | {
      readonly type: 'gamble-gold';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly shopId: string;
      readonly expectedVersion: number;
      readonly wagerGold: number;
      readonly mode: 'double' | 'purple';
    }
  | {
      readonly type: 'spend-gem';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly passiveId: PassiveId;
    }
  | {
      readonly type: 'skill-book-replace';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly lootEntityId: EntityId;
      readonly replacePassiveId: PassiveId;
    }
  | {
      readonly type: 'active-loot-replace';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly lootEntityId: EntityId;
      readonly confirm: boolean;
    }
  | {
      readonly type: 'equipment-loot-pickup';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly lootEntityId: EntityId;
      readonly destination: 'inventory' | 'equipped' | 'cancel';
      readonly replacementInstanceId: EquipmentInstanceId | null;
    }
  | {
      readonly type: 'equipment-equip';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly instanceId: EquipmentInstanceId;
      readonly replacementInstanceId: EquipmentInstanceId | null;
    }
  | {
      readonly type: 'equipment-unequip';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly instanceId: EquipmentInstanceId;
    }
  | {
      readonly type: 'equipment-discard';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly instanceId: EquipmentInstanceId;
    };

export type ServerMessage =
  | {
      readonly type: 'matchmaking-queued';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly queueId: string;
      readonly queuePosition: number;
      readonly serverTime: number;
    }
  | {
      readonly type: 'matchmaking-selection';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly matchId: string;
      readonly offers: readonly HeroId[];
      readonly recommendedHeroId: HeroId | null;
      readonly selectionRemainingMs: number;
      readonly matchGold: number;
      readonly rerollCount: number;
      readonly selectedHeroId: HeroId | null;
    }
  | {
      readonly type: 'matchmaking-assigned';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly matchId: string;
      readonly heroId: HeroId;
      readonly matchTicket: string;
      readonly ticketExpiresAtMs: number;
      readonly roomId: string;
    }
  | {
      readonly type: 'matchmaking-cancelled';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly reason: 'client' | 'expired' | 'server';
    }
  | {
      readonly type: 'joined';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly rulesetVersion: string;
      readonly entityId: EntityId;
      readonly serverTick: number;
      readonly acknowledgedInputSequence: number;
      readonly recoveryToken: string;
      readonly resumeGracePeriodMs: number;
      readonly resumed: boolean;
    }
  | {
      readonly type: 'snapshot';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly snapshot: WireWorldSnapshot;
      readonly acknowledgedInputSequence: number;
    }
  | {
      readonly type: 'events';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly events: readonly unknown[];
    }
  | {
      readonly type: 'pong';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly clientTime: number;
      readonly serverTime: number;
    }
  | {
      readonly type: 'transaction-result';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly transactionId: string;
      readonly operation:
        | 'shop-purchase'
        | 'shop-sale'
        | 'hero-swap'
        | 'gamble-passive'
        | 'gamble-equipment'
        | 'gamble-active'
        | 'gamble-gold'
        | 'spend-gem'
        | 'skill-book-replace'
        | 'active-loot-replace'
        | 'equipment-loot-pickup'
        | 'equipment-equip'
        | 'equipment-unequip'
        | 'equipment-discard'
        | 'airdrop-open';
      readonly accepted: boolean;
      readonly code: string;
      readonly message: string;
      readonly snapshot: WireWorldSnapshot;
      readonly acknowledgedInputSequence: number;
    }
  | {
      readonly type: 'error';
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly code: string;
      readonly message: string;
    };
