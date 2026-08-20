using Jwgb.Sim.Deterministic;
using Unity.Entities;

namespace Jwgb.Netcode
{
    public partial class MatchGhostSnapshotSystem
    {
        private void SyncPendingTransactions(WorldSnapshot snapshot)
        {
            var activeReplacements =
                EntityManager.GetBuffer<
                    MatchPendingActiveReplacementGhost>(worldState);
            activeReplacements.Clear();
            for (var index = 0;
                index < snapshot.PendingActiveReplacements.Length;
                index += 1)
            {
                var pending =
                    snapshot.PendingActiveReplacements[index];
                activeReplacements.Add(
                    new MatchPendingActiveReplacementGhost
                    {
                        PlayerEntityId = pending.PlayerEntityId,
                        LootEntityId = pending.LootEntityId,
                        ActiveId = ToFixed64(pending.ActiveId),
                        RequestedAtTick = pending.RequestedAtTick
                    });
            }

            var equipmentPickups =
                EntityManager.GetBuffer<
                    MatchPendingEquipmentPickupGhost>(worldState);
            equipmentPickups.Clear();
            for (var index = 0;
                index < snapshot.PendingEquipmentPickups.Length;
                index += 1)
            {
                var pending = snapshot.PendingEquipmentPickups[index];
                equipmentPickups.Add(
                    new MatchPendingEquipmentPickupGhost
                    {
                        PlayerEntityId = pending.PlayerEntityId,
                        LootEntityId = pending.LootEntityId,
                        EquipmentId = ToFixed64(
                            pending.EquipmentId),
                        HasEquipmentInstanceId =
                            pending.EquipmentInstanceId.HasValue,
                        EquipmentInstanceId =
                            pending.EquipmentInstanceId ?? 0,
                        RequestedAtTick = pending.RequestedAtTick
                    });
            }
        }
    }
}
