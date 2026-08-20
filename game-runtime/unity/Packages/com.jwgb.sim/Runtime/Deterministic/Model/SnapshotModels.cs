using System;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public sealed class MatchSnapshot
    {
        public MatchStatus Status { get; set; }

        public int? StartedAtTick { get; set; }

        public int? FinishedAtTick { get; set; }

        public int? WinnerEntityId { get; set; }

        public int[] Placements { get; set; } = Array.Empty<int>();
    }

    /// <summary>
    /// Mirror of the TypeScript WorldSnapshot.stormZone shape from
    /// packages/sim/src/snapshot.ts. Read-only presentation data; it is
    /// not part of the state hash composition.
    /// </summary>
    public sealed class StormZoneSnapshot
    {
        public string SelectedCourtId { get; set; }

        public int CourtAnnouncementTick { get; set; }

        public int WarningTick { get; set; }

        public Int2Mm Center { get; set; }

        public int RadiusMm { get; set; }

        public bool CourtAnnounced { get; set; }

        public bool ApocalypseWarning { get; set; }

        public bool ApocalypseStarted { get; set; }
    }

    public sealed class PlayerSnapshot
    {
        public int EntityId { get; set; }
        public string PlayerId { get; set; }
        public string HeroId { get; set; }
        public string ActiveAbilityId { get; set; }
        public Int2Mm Position { get; set; }
        public Int2Mm Facing { get; set; }
        public int Hp { get; set; }
        public int MaxHp { get; set; }
        public int AttackPower { get; set; }
        public int MoveSpeedMmPerSecond { get; set; }
        public int AttackRangeMm { get; set; }
        public int AttacksPerSecondMilli { get; set; }
        public int LivesRemaining { get; set; }
        public int TrueDeaths { get; set; }
        public LifeState LifeState { get; set; }
        public int AttackCooldownTicks { get; set; }
        public int ActiveCooldownTicks { get; set; }
        public int ActiveBuffTicks { get; set; }
        public int HardControlTicks { get; set; }
        public int SlowTicks { get; set; }
        public int SlowBasisPoints { get; set; }
        public int SilenceTicks { get; set; }
        public int SilenceCooldownPenaltyTicks { get; set; }
        public int BlindTicks { get; set; }
        public int BlindMissPercent { get; set; }
        public int B15SpeedBoostTicks { get; set; }
        public int B15SpeedBonusPercent { get; set; }
        public bool B21FirstHitReady { get; set; }
        public int B25NextBasicBonusPercent { get; set; }
        public int B25AttackSpeedBoostTicks { get; set; }
        public int B25AttackSpeedBonusPercent { get; set; }
        public int B27SpeedBoostTicks { get; set; }
        public int B27SpeedBonusPercent { get; set; }
        public int B30NextAfterimageTick { get; set; }
        public int B36Stacks { get; set; }
        public int B36MovingTicks { get; set; }
        public int B38NextHealTick { get; set; }
        public int B40KillCount { get; set; }
        public int B40BonusMaxHp { get; set; }
        public int B42SpeedBoostTicks { get; set; }
        public int B42SpeedBonusPercent { get; set; }
        public int LastCombatTick { get; set; }
        public int PvpCombatTicks { get; set; }
        public int TotalShield { get; set; }
        public int WhirlwindTicks { get; set; }
        public int WhirlwindNextPulseTick { get; set; }
        public int B19RetriggerLockTicks { get; set; }
        public int B20ReviveBuffTicks { get; set; }
        public int InvulnerableTicks { get; set; }
        public int IceCoffinTicks { get; set; }
        public int AttackPeriodTicks { get; set; }
        public Int2Mm? RespawnTarget { get; set; }
        public int ReviveProtectionTicks { get; set; }
        public int MoveRemainderX { get; set; }
        public int MoveRemainderZ { get; set; }
        public PlayerIntent Intent { get; set; }
        public int Gold { get; set; }
        public int Experience { get; set; }
        public int Level { get; set; }
        public int Gems { get; set; }
        public int WorldInteractionLockTicks { get; set; }
        public int TaibaiChannelTicks { get; set; }
        public string TaibaiTargetHeroId { get; set; }
        public int TaibaiCooldownTicks { get; set; }
        public int HeishanGambleCount { get; set; }
        public bool B20ChargeAvailable { get; set; }
        public bool HasNineTurnPill { get; set; }
        public PassiveLoadoutEntry[] Passives { get; set; } =
            Array.Empty<PassiveLoadoutEntry>();
        public EquippedEquipmentInstance[] Equipment { get; set; } =
            Array.Empty<EquippedEquipmentInstance>();
        public EquippedEquipmentInstance[] InventoryEquipment { get; set; } =
            Array.Empty<EquippedEquipmentInstance>();
        public ShieldSnapshot[] Shields { get; set; } =
            Array.Empty<ShieldSnapshot>();
    }

    public sealed class ShieldSnapshot
    {
        public string SourceKind { get; set; }
        public string SourceId { get; set; }
        public int ExpiresAtTick { get; set; }
        public int CreationSequence { get; set; }
        public string[] Absorbs { get; set; } = Array.Empty<string>();
        public ShieldBreakEffectSnapshot BreakEffect { get; set; }
        public int RemainingAmount { get; set; }
    }

    public sealed class ShieldBreakEffectSnapshot
    {
        public int SourceEntityId { get; set; }
        public string SourceElement { get; set; }
        public int Damage { get; set; }
        public int RadiusMm { get; set; }
    }

    public sealed class ShopListingSnapshot
    {
        public string ListingId { get; set; }
        public string Kind { get; set; }
        public string EquipmentId { get; set; }
        public string ConsumableId { get; set; }
        public int Price { get; set; }
    }

    public sealed class ShopSnapshot
    {
        public string ShopId { get; set; }
        public string Kind { get; set; }
        public Int2Mm Position { get; set; }
        public string AnchorId { get; set; }
        public string MacroId { get; set; }
        public int OpenAtTick { get; set; }
        public int CloseAtTick { get; set; }
        public int Version { get; set; }
        public string Status { get; set; }
        public int NextRelocationAttemptTick { get; set; }
        public ShopListingSnapshot[] Inventory { get; set; } =
            Array.Empty<ShopListingSnapshot>();
    }

    public sealed class WindWallSnapshot
    {
        public int EntityId { get; set; }
        public int OwnerEntityId { get; set; }
        public Int2Mm Center { get; set; }
        public Int2Mm Direction { get; set; }
        public int LengthMm { get; set; }
        public int RemainingTicks { get; set; }
    }

    public sealed class ProjectileSnapshot
    {
        public int EntityId { get; set; }
        public string Kind { get; set; }
        public int OwnerEntityId { get; set; }
        public int TargetEntityId { get; set; }
        public Int2Mm Position { get; set; }
        public int SpeedMmPerSecond { get; set; }
        public int CollisionRadiusMm { get; set; }
        public string SourceElement { get; set; }
        public int BaseDamage { get; set; }
        public int OutgoingDamageBasisPoints { get; set; }
        public int CreatedAtTick { get; set; }
        public int RemainingTravelMm { get; set; }
        public int MovementRemainder { get; set; }
    }

    public sealed class WorldSnapshot
    {
        public int Tick { get; set; }

        public uint RootSeed { get; set; }

        public string StateHash { get; set; }

        public int ArenaRadiusMm { get; set; }

        public string MapGeometryHash { get; set; }

        public bool PveEnabled { get; set; }

        public string PvePopulation { get; set; }

        public MatchSnapshot Match { get; set; }

        public StormZoneSnapshot StormZone { get; set; }

        public StaticSolidRect[] StaticSolids { get; set; } =
            Array.Empty<StaticSolidRect>();

        public PlayerSnapshot[] Players { get; set; } =
            Array.Empty<PlayerSnapshot>();

        public ShopSnapshot[] Shops { get; set; } =
            Array.Empty<ShopSnapshot>();

        public PendingActiveReplacementSnapshot[]
            PendingActiveReplacements { get; set; } =
                Array.Empty<PendingActiveReplacementSnapshot>();

        public PendingEquipmentPickupSnapshot[]
            PendingEquipmentPickups { get; set; } =
                Array.Empty<PendingEquipmentPickupSnapshot>();

        public WindWallSnapshot[] WindWalls { get; set; } =
            Array.Empty<WindWallSnapshot>();

        public ProjectileSnapshot[] Projectiles { get; set; } =
            Array.Empty<ProjectileSnapshot>();

        public MonsterSnapshot[] Monsters { get; set; } =
            Array.Empty<MonsterSnapshot>();

        public LootSnapshot[] LootDrops { get; set; } =
            Array.Empty<LootSnapshot>();

        public MonsterRespawnSnapshot[] MonsterRespawns { get; set; } =
            Array.Empty<MonsterRespawnSnapshot>();

        public SummonSnapshot[] Summons { get; set; } =
            Array.Empty<SummonSnapshot>();

        public AfterimageSnapshot[] Afterimages { get; set; } =
            Array.Empty<AfterimageSnapshot>();

        public BountyMarkSnapshot[] BountyMarks { get; set; } =
            Array.Empty<BountyMarkSnapshot>();

        public PassiveTargetSnapshot[] PassiveTargetStates { get; set; } =
            Array.Empty<PassiveTargetSnapshot>();

        public AirdropSnapshot[] Airdrops { get; set; } =
            Array.Empty<AirdropSnapshot>();

        public AirdropChannelSnapshot[] AirdropChannels { get; set; } =
            Array.Empty<AirdropChannelSnapshot>();
    }
}
