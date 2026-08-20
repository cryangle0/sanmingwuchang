using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    internal static class NetworkGhostSnapshotReaders
    {
        public static EquippedEquipmentInstance CreateEquipment(
            MatchPlayerEquipmentGhost value)
        {
            return new EquippedEquipmentInstance(
                value.InstanceId,
                value.EquipmentId.ToString(),
                value.AcquiredAtTick,
                value.PermanentAttackBonus);
        }

        public static PendingActiveReplacementSnapshot
            CreateActiveReplacement(
                MatchPendingActiveReplacementGhost value)
        {
            return new PendingActiveReplacementSnapshot
            {
                PlayerEntityId = value.PlayerEntityId,
                LootEntityId = value.LootEntityId,
                ActiveId = value.ActiveId.ToString(),
                RequestedAtTick = value.RequestedAtTick
            };
        }

        public static PendingEquipmentPickupSnapshot
            CreateEquipmentPickup(
                MatchPendingEquipmentPickupGhost value)
        {
            return new PendingEquipmentPickupSnapshot
            {
                PlayerEntityId = value.PlayerEntityId,
                LootEntityId = value.LootEntityId,
                EquipmentId = value.EquipmentId.ToString(),
                EquipmentInstanceId =
                    value.HasEquipmentInstanceId
                        ? value.EquipmentInstanceId
                        : null,
                RequestedAtTick = value.RequestedAtTick
            };
        }
    }
}
