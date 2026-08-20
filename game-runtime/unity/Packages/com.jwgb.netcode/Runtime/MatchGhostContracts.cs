using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    public struct MatchWorldGhostState : IComponentData
    {
        [GhostField]
        public int MatchSequence;

        [GhostField]
        public int SnapshotTick;

        [GhostField]
        public uint RootSeed;

        [GhostField]
        public int PlayerCount;

        [GhostField]
        public int RemainingCompetitors;

        [GhostField]
        public int ProjectileCount;

        [GhostField]
        public int WindWallCount;

        [GhostField]
        public byte MatchStatus;

        [GhostField]
        public bool HasStartedAtTick;

        [GhostField]
        public int StartedAtTick;

        [GhostField]
        public bool HasFinishedAtTick;

        [GhostField]
        public int FinishedAtTick;

        [GhostField]
        public bool HasWinner;

        [GhostField]
        public int WinnerEntityId;

        [GhostField]
        public uint StateHash;

        [GhostField]
        public bool MapEnabled;

        [GhostField]
        public FixedString32Bytes MapGeometryHash;

        [GhostField]
        public bool PveEnabled;

        [GhostField]
        public int MonsterCount;

        [GhostField]
        public int LootCount;

        [GhostField]
        public int ShopCount;

        [GhostField]
        public int AirdropCount;

        [GhostField]
        public int AirdropChannelCount;

        [GhostField]
        public bool HasStormZone;

        [GhostField]
        public int StormCenterX;

        [GhostField]
        public int StormCenterZ;

        [GhostField]
        public int StormRadiusMm;

        [GhostField]
        public bool StormApocalypseWarning;

        [GhostField]
        public bool StormApocalypseStarted;
    }

    public struct MatchPlayerGhostState : IComponentData
    {
        [GhostField]
        public int SnapshotTick;

        [GhostField]
        public int EntityId;

        [GhostField]
        public FixedString64Bytes PlayerId;

        [GhostField]
        public FixedString64Bytes HeroId;

        [GhostField]
        public FixedString64Bytes ActiveAbilityId;

        [GhostField]
        public int PositionX;

        [GhostField]
        public int PositionZ;

        [GhostField]
        public int FacingX;

        [GhostField]
        public int FacingZ;

        [GhostField]
        public int Hp;

        [GhostField]
        public int MaxHp;

        [GhostField]
        public int AttackPower;

        [GhostField]
        public int MoveSpeedMmPerSecond;

        [GhostField]
        public int AttackRangeMm;

        [GhostField]
        public int AttacksPerSecondMilli;

        [GhostField]
        public int LivesRemaining;

        [GhostField]
        public int TrueDeaths;

        [GhostField]
        public byte LifeState;

        [GhostField]
        public int AttackCooldownTicks;

        [GhostField]
        public int ActiveCooldownTicks;

        [GhostField]
        public int ActiveBuffTicks;

        [GhostField]
        public int Gold;

        [GhostField]
        public int Experience;

        [GhostField]
        public int Level;

        [GhostField]
        public int Gems;

        [GhostField]
        public int WorldInteractionLockTicks;

        [GhostField]
        public int PvpCombatTicks;

        [GhostField]
        public int TaibaiChannelTicks;

        [GhostField]
        public FixedString64Bytes TaibaiTargetHeroId;

        [GhostField]
        public int TaibaiCooldownTicks;

        [GhostField]
        public int HeishanGambleCount;

        [GhostField]
        public int TotalShield;

        [GhostField]
        public int WhirlwindTicks;

        [GhostField]
        public int B19RetriggerLockTicks;

        [GhostField]
        public int B20ReviveBuffTicks;

        [GhostField]
        public int InvulnerableTicks;

        [GhostField]
        public int IceCoffinTicks;

        [GhostField]
        public int HardControlTicks;

        [GhostField]
        public bool HasRespawnTarget;

        [GhostField]
        public int RespawnTargetX;

        [GhostField]
        public int RespawnTargetZ;

        [GhostField]
        public int ReviveProtectionTicks;

        [GhostField]
        public int MoveRemainderX;

        [GhostField]
        public int MoveRemainderZ;

        [GhostField]
        public int LastProcessedInputSequence;

        [GhostField]
        public bool B20ChargeAvailable;

        [GhostField]
        public bool HasNineTurnPill;
    }

    public struct MatchPlayerPassiveGhost : IBufferElementData
    {
        [GhostField]
        public FixedString64Bytes PassiveId;

        [GhostField]
        public int Level;
    }

    public struct MatchPlayerEquipmentGhost : IBufferElementData
    {
        [GhostField]
        public int InstanceId;

        [GhostField]
        public FixedString64Bytes EquipmentId;

        [GhostField]
        public int AcquiredAtTick;

        [GhostField]
        public int PermanentAttackBonus;

        [GhostField]
        public bool IsInventory;
    }

    public struct MatchPendingActiveReplacementGhost :
        IBufferElementData
    {
        [GhostField]
        public int PlayerEntityId;

        [GhostField]
        public int LootEntityId;

        [GhostField]
        public FixedString64Bytes ActiveId;

        [GhostField]
        public int RequestedAtTick;
    }

    public struct MatchPendingEquipmentPickupGhost :
        IBufferElementData
    {
        [GhostField]
        public int PlayerEntityId;

        [GhostField]
        public int LootEntityId;

        [GhostField]
        public FixedString64Bytes EquipmentId;

        [GhostField]
        public bool HasEquipmentInstanceId;

        [GhostField]
        public int EquipmentInstanceId;

        [GhostField]
        public int RequestedAtTick;
    }

    public struct MatchPlayerShieldGhost : IBufferElementData
    {
        [GhostField]
        public FixedString64Bytes SourceKind;

        [GhostField]
        public FixedString64Bytes SourceId;

        [GhostField]
        public int ExpiresAtTick;

        [GhostField]
        public int CreationSequence;

        [GhostField]
        public FixedString128Bytes Absorbs;

        [GhostField]
        public bool HasBreakEffect;

        [GhostField]
        public int BreakSourceEntityId;

        [GhostField]
        public FixedString64Bytes BreakSourceElement;

        [GhostField]
        public int BreakDamage;

        [GhostField]
        public int BreakRadiusMm;

        [GhostField]
        public int RemainingAmount;
    }

    public struct MatchProjectileGhostState : IComponentData
    {
        [GhostField]
        public int SnapshotTick;

        [GhostField]
        public int EntityId;

        [GhostField]
        public int OwnerEntityId;

        [GhostField]
        public int TargetEntityId;

        [GhostField]
        public int PositionX;

        [GhostField]
        public int PositionZ;

        [GhostField]
        public int SpeedMmPerSecond;

        [GhostField]
        public int CollisionRadiusMm;

        [GhostField]
        public FixedString64Bytes SourceElement;

        [GhostField]
        public int BaseDamage;

        [GhostField]
        public int OutgoingDamageBasisPoints;

        [GhostField]
        public int CreatedAtTick;

        [GhostField]
        public int RemainingTravelMm;

        [GhostField]
        public int MovementRemainder;
    }

    public struct MatchWindWallGhostState : IComponentData
    {
        [GhostField]
        public int SnapshotTick;

        [GhostField]
        public int EntityId;

        [GhostField]
        public int OwnerEntityId;

        [GhostField]
        public int CenterX;

        [GhostField]
        public int CenterZ;

        [GhostField]
        public int DirectionX;

        [GhostField]
        public int DirectionZ;

        [GhostField]
        public int LengthMm;

        [GhostField]
        public int RemainingTicks;
    }

    public struct MatchGhostPrefabSet : IComponentData
    {
        public Entity World;
        public Entity Player;
        public Entity Projectile;
        public Entity WindWall;
        public Entity Monster;
        public Entity Loot;
        public Entity Shop;
        public Entity Airdrop;
        public Entity AirdropChannel;
    }
}
