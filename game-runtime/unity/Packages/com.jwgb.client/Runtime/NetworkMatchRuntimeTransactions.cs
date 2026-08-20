using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    public sealed partial class NetworkMatchRuntime
    {
        private void ReadPendingTransactions(
            Unity.Entities.Entity worldEntity)
        {
            pendingActiveReplacementSnapshots.Clear();
            var activeReplacements =
                clientWorld.EntityManager.GetBuffer<
                    MatchPendingActiveReplacementGhost>(worldEntity);
            for (var index = 0;
                index < activeReplacements.Length;
                index += 1)
            {
                var value = activeReplacements[index];
                pendingActiveReplacementSnapshots.Add(
                    NetworkGhostSnapshotReaders
                        .CreateActiveReplacement(value));
            }

            pendingEquipmentPickupSnapshots.Clear();
            var equipmentPickups =
                clientWorld.EntityManager.GetBuffer<
                    MatchPendingEquipmentPickupGhost>(worldEntity);
            for (var index = 0;
                index < equipmentPickups.Length;
                index += 1)
            {
                var value = equipmentPickups[index];
                pendingEquipmentPickupSnapshots.Add(
                    NetworkGhostSnapshotReaders
                        .CreateEquipmentPickup(value));
            }
        }
    }
}
