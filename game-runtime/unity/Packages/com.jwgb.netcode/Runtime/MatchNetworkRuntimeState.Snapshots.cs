using System;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Netcode
{
    public static partial class MatchNetworkRuntimeState
    {
        public static void ConfigureServerRoster(
            PlayerSnapshot[] players)
        {
            ConfigureServerRosterArrays(
                players,
                preserveConnectedSlots: false);
            ServerMatchSequence = 0;
            ResetServerEventMatch(0);
            expiredReconnectEntityIds.Clear();
            serverRematchVotes.Clear();
        }

        private static void ConfigureServerRosterArrays(
            PlayerSnapshot[] players,
            bool preserveConnectedSlots)
        {
            if (players == null)
            {
                throw new ArgumentNullException(nameof(players));
            }

            competitorEntityIds = new int[players.Length];
            heroBySlot = new string[players.Length];
            for (var index = 0; index < players.Length; index += 1)
            {
                var player = players[index] ??
                    throw new ArgumentException(
                        "Server roster contains a null player.",
                        nameof(players));
                competitorEntityIds[index] = player.EntityId;
                heroBySlot[index] = player.HeroId ??
                    throw new ArgumentException(
                        "Server roster contains a player without a hero.",
                        nameof(players));
            }
            assignedSlots = new bool[competitorEntityIds.Length];
            if (!preserveConnectedSlots)
            {
                processedInputByEntity.Clear();
            }
            for (var index = 0;
                index < competitorEntityIds.Length;
                index += 1)
            {
                var entityId = competitorEntityIds[index];
                if (preserveConnectedSlots)
                {
                    assignedSlots[index] =
                        entityByNetworkId.ContainsValue(entityId);
                    if (!processedInputByEntity.ContainsKey(entityId))
                    {
                        processedInputByEntity.Add(entityId, 0);
                    }
                }
                else
                {
                    processedInputByEntity.Add(entityId, 0);
                }
            }
            if (!preserveConnectedSlots)
            {
                return;
            }
            foreach (var entityId in entityByNetworkId.Values)
            {
                if (Array.IndexOf(
                        competitorEntityIds,
                        entityId) < 0)
                {
                    throw new InvalidOperationException(
                        $"Rematch roster is missing connected entity {entityId}.");
                }
            }
        }

        public static void PublishServerSnapshot(
            WorldSnapshot snapshot,
            int matchSequence = 0)
        {
            if (matchSequence < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(matchSequence));
            }
            if (ServerMatchSequence != matchSequence)
            {
                ResetServerEventMatch(matchSequence);
            }
            latestServerSnapshot = snapshot;
            ServerMatchSequence = matchSequence;
            PruneServerEventWindow(snapshot.Tick);
            ExpireReconnectReservations(snapshot.Tick);
        }

        public static bool TryGetServerSnapshot(
            out WorldSnapshot snapshot)
        {
            snapshot = latestServerSnapshot;
            return snapshot != null;
        }

        public static void PublishServerPlayerRuntime(
            PlayerRuntimeSnapshot[] snapshots)
        {
            playerRuntimeByEntity.Clear();
            if (snapshots == null)
            {
                return;
            }
            for (var index = 0; index < snapshots.Length; index += 1)
            {
                playerRuntimeByEntity[snapshots[index].EntityId] =
                    snapshots[index];
            }
        }

        public static bool TryGetServerPlayerRuntime(
            int entityId,
            out PlayerRuntimeSnapshot snapshot)
        {
            return playerRuntimeByEntity.TryGetValue(
                entityId,
                out snapshot);
        }

        public static int GetLastProcessedInputSequence(int entityId)
        {
            return processedInputByEntity.TryGetValue(
                entityId,
                out var sequence)
                    ? sequence
                    : 0;
        }

        public static void RecordProcessedInput(
            int entityId,
            int sequence)
        {
            processedInputByEntity[entityId] = Math.Max(
                GetLastProcessedInputSequence(entityId),
                sequence);
        }

        public static void PublishReplicationSnapshot(
            WorldSnapshot snapshot)
        {
            latestReplicationSnapshot = snapshot;
        }

        public static bool TryGetReplicationSnapshot(
            out WorldSnapshot snapshot)
        {
            snapshot = latestReplicationSnapshot;
            return snapshot != null;
        }

        public static void RecordGhostRegistration()
        {
            GhostRegistrationComplete = true;
        }

        public static void RecordReplicatedGhosts(
            int worldCount,
            int playerCount,
            int projectileCount,
            int windWallCount,
            int monsterCount,
            int lootCount,
            int shopCount,
            int snapshotTick)
        {
            ReplicatedWorldGhostCount = worldCount;
            ReplicatedPlayerGhostCount = playerCount;
            ReplicatedProjectileGhostCount = projectileCount;
            ReplicatedWindWallGhostCount = windWallCount;
            ReplicatedMonsterGhostCount = monsterCount;
            ReplicatedLootGhostCount = lootCount;
            ReplicatedShopGhostCount = shopCount;
            ReplicatedGhostSnapshotTick = snapshotTick;
            PeakReplicatedGhostCount = Math.Max(
                PeakReplicatedGhostCount,
                worldCount +
                playerCount +
                projectileCount +
                windWallCount +
                monsterCount +
                lootCount +
                shopCount);
        }
    }
}
