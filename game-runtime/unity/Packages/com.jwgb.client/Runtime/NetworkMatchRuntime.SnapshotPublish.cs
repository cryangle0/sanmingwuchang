using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    public sealed partial class NetworkMatchRuntime
    {
        private void PublishSnapshot(
            MatchWorldGhostState worldState,
            ulong fingerprint,
            PlayerSnapshot localPlayer,
            MatchPlayerGhostState localPlayerState)
        {
            SortSnapshots();
            lastSnapshotFingerprint = fingerprint;
            lastMatchSequence = worldState.MatchSequence;
            lastSnapshotTick = worldState.SnapshotTick;
            Snapshot = CreateSnapshot(worldState);
            RecordGhostSnapshot(worldState);
            ReconcileLocalPlayer(localPlayer, localPlayerState);
            SnapshotChanged?.Invoke(Snapshot);
        }

        private void SortSnapshots()
        {
            playerSnapshots.Sort(ComparePlayers);
            projectileSnapshots.Sort(CompareProjectiles);
            windWallSnapshots.Sort(CompareWindWalls);
            monsterSnapshots.Sort(CompareMonsters);
            lootSnapshots.Sort(CompareLoot);
            shopSnapshots.Sort(CompareShops);
            airdropSnapshots.Sort(CompareAirdrops);
            airdropChannelSnapshots.Sort(
                CompareAirdropChannels);
        }

        private WorldSnapshot CreateSnapshot(
            MatchWorldGhostState worldState)
        {
            return new WorldSnapshot
            {
                Tick = worldState.SnapshotTick,
                RootSeed = worldState.RootSeed,
                StateHash = worldState.StateHash.ToString("x8"),
                MapGeometryHash = worldState.MapEnabled
                    ? worldState.MapGeometryHash.ToString()
                    : null,
                PveEnabled = worldState.PveEnabled,
                StormZone =
                    NetworkPveGhostReaders.CreateStormZone(
                        worldState),
                Match = new MatchSnapshot
                {
                    Status = (MatchStatus)worldState.MatchStatus,
                    StartedAtTick = worldState.HasStartedAtTick
                        ? worldState.StartedAtTick
                        : null,
                    FinishedAtTick = worldState.HasFinishedAtTick
                        ? worldState.FinishedAtTick
                        : null,
                    WinnerEntityId = worldState.HasWinner
                        ? worldState.WinnerEntityId
                        : null
                },
                Players = playerSnapshots.ToArray(),
                Projectiles = projectileSnapshots.ToArray(),
                WindWalls = windWallSnapshots.ToArray(),
                Monsters = monsterSnapshots.ToArray(),
                LootDrops = lootSnapshots.ToArray(),
                Shops = shopSnapshots.ToArray(),
                Airdrops = airdropSnapshots.ToArray(),
                AirdropChannels =
                    airdropChannelSnapshots.ToArray(),
                PendingActiveReplacements =
                    pendingActiveReplacementSnapshots.ToArray(),
                PendingEquipmentPickups =
                    pendingEquipmentPickupSnapshots.ToArray()
            };
        }

        private void RecordGhostSnapshot(
            MatchWorldGhostState worldState)
        {
            MatchNetworkRuntimeState.RecordClientGhostSnapshot(
                1,
                Snapshot.Players.Length,
                Snapshot.Projectiles.Length,
                Snapshot.WindWalls.Length,
                Snapshot.Monsters.Length,
                Snapshot.LootDrops.Length,
                Snapshot.Shops.Length,
                worldState.MapEnabled,
                worldState.MapGeometryHash.ToString(),
                worldState.PveEnabled,
                worldState.StormRadiusMm,
                Snapshot.Tick,
                new MatchStateRpc
                {
                    MatchSequence = worldState.MatchSequence,
                    Tick = worldState.SnapshotTick,
                    PlayerCount = worldState.PlayerCount,
                    RemainingCompetitors =
                        worldState.RemainingCompetitors,
                    ProjectileCount =
                        worldState.ProjectileCount,
                    WindWallCount = worldState.WindWallCount,
                    MatchStatus = worldState.MatchStatus,
                    HasStartedAtTick =
                        worldState.HasStartedAtTick,
                    StartedAtTick = worldState.StartedAtTick,
                    HasFinishedAtTick =
                        worldState.HasFinishedAtTick,
                    FinishedAtTick = worldState.FinishedAtTick,
                    HasWinner = worldState.HasWinner,
                    WinnerEntityId = worldState.WinnerEntityId,
                    StateHash = worldState.StateHash
                });
        }

        private void ReconcileLocalPlayer(
            PlayerSnapshot localPlayer,
            MatchPlayerGhostState localPlayerState)
        {
            if (localPlayer == null ||
                localPlayerState.SnapshotTick <=
                    lastLocalPredictionSnapshotTick)
            {
                return;
            }

            lastLocalPredictionSnapshotTick =
                localPlayerState.SnapshotTick;
            MatchNetworkRuntimeState.CopyUnacknowledgedClientInputs(
                localPlayerState.LastProcessedInputSequence,
                pendingInputs);
            localPrediction.ApplyAuthoritative(
                localPlayerState.SnapshotTick,
                localPlayer,
                localPlayerState.HardControlTicks,
                localPlayerState.HasRespawnTarget
                    ? new Int2Mm(
                        localPlayerState.RespawnTargetX,
                        localPlayerState.RespawnTargetZ)
                    : null,
                localPlayerState.ReviveProtectionTicks,
                localPlayerState.MoveRemainderX,
                localPlayerState.MoveRemainderZ,
                localPlayerState.LastProcessedInputSequence,
                pendingInputs);
            RecordPrediction();
        }
    }
}
