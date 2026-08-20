using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    /// <summary>
    /// Presentation-facing PVE ghosts for the map-mode authoritative
    /// match. Only the fields the client renders are replicated; monster
    /// positions update at the reduced PVE send rate.
    /// </summary>
    public struct MatchMonsterGhostState : IComponentData
    {
        [GhostField]
        public int SnapshotTick;

        [GhostField]
        public int EntityId;

        [GhostField]
        public FixedString32Bytes Kind;

        [GhostField]
        public FixedString32Bytes Element;

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
    }

    public struct MatchLootGhostState : IComponentData
    {
        [GhostField]
        public int SnapshotTick;

        [GhostField]
        public int EntityId;

        [GhostField]
        public int PositionX;

        [GhostField]
        public int PositionZ;

        [GhostField]
        public int Gold;

        [GhostField]
        public int Experience;

        [GhostField]
        public int Gems;

        [GhostField]
        public FixedString64Bytes EquipmentId;

        [GhostField]
        public FixedString64Bytes BookPassiveId;

        [GhostField]
        public int CreatedAtTick;

        [GhostField]
        public long ExpiresAtTick;

        [GhostField]
        public FixedString32Bytes Kind;

        [GhostField]
        public FixedString64Bytes ActiveId;

        [GhostField]
        public bool HasEquipmentInstanceId;

        [GhostField]
        public int EquipmentInstanceId;

        [GhostField]
        public bool HasAcquiredAtTick;

        [GhostField]
        public int AcquiredAtTick;

        [GhostField]
        public int PermanentAttackBonus;

        [GhostField]
        public bool HasStormCoveredSinceTick;

        [GhostField]
        public int StormCoveredSinceTick;
    }

    public struct MatchShopGhostState : IComponentData
    {
        [GhostField]
        public int SnapshotTick;

        [GhostField]
        public FixedString64Bytes ShopId;

        [GhostField]
        public FixedString32Bytes Kind;

        [GhostField]
        public int PositionX;

        [GhostField]
        public int PositionZ;

        [GhostField]
        public int OpenAtTick;

        [GhostField]
        public int CloseAtTick;

        [GhostField]
        public FixedString64Bytes AnchorId;

        [GhostField]
        public FixedString64Bytes MacroId;

        [GhostField]
        public int Version;

        [GhostField]
        public FixedString32Bytes Status;

        [GhostField]
        public int NextRelocationAttemptTick;
    }

    public struct MatchShopListingGhost : IBufferElementData
    {
        [GhostField]
        public FixedString64Bytes ListingId;

        [GhostField]
        public FixedString32Bytes Kind;

        [GhostField]
        public FixedString64Bytes EquipmentId;

        [GhostField]
        public FixedString64Bytes ConsumableId;

        [GhostField]
        public int Price;
    }

    public struct MatchAirdropGhostState : IComponentData
    {
        [GhostField]
        public int SnapshotTick;

        [GhostField]
        public FixedString64Bytes AirdropId;

        [GhostField]
        public int Sequence;

        [GhostField]
        public int ScheduledElapsedTick;

        [GhostField]
        public FixedString32Bytes Phase;

        [GhostField]
        public bool HasPosition;

        [GhostField]
        public int PositionX;

        [GhostField]
        public int PositionZ;

        [GhostField]
        public bool HasAnnouncedAtTick;

        [GhostField]
        public int AnnouncedAtTick;

        [GhostField]
        public bool HasLandedAtTick;

        [GhostField]
        public int LandedAtTick;

        [GhostField]
        public bool HasExpiresAtTick;

        [GhostField]
        public int ExpiresAtTick;

        [GhostField]
        public bool HasOpenedAtTick;

        [GhostField]
        public int OpenedAtTick;

        [GhostField]
        public bool HasOpenedByEntityId;

        [GhostField]
        public int OpenedByEntityId;

        [GhostField]
        public FixedString64Bytes EquipmentId;

        [GhostField]
        public bool HasLootEntityId;

        [GhostField]
        public int LootEntityId;
    }

    public struct MatchAirdropChannelGhostState : IComponentData
    {
        [GhostField]
        public int SnapshotTick;

        [GhostField]
        public int Sequence;

        [GhostField]
        public int PlayerEntityId;

        [GhostField]
        public FixedString64Bytes AirdropId;

        [GhostField]
        public int StartedAtTick;

        [GhostField]
        public int CompletesAtTick;

        [GhostField]
        public int OriginPositionX;

        [GhostField]
        public int OriginPositionZ;
    }
}
