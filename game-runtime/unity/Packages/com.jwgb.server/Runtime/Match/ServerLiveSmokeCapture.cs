using System;
using System.IO;
using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Server
{
    [DisallowMultipleComponent]
    public sealed class ServerLiveSmokeCapture : MonoBehaviour
    {
        private const float MinimumTimeoutSeconds = 20f;

        private AuthoritativeMatchRuntime runtime;
        private string reportPath;
        private int captureTick;
        private int rootSeed;
        private int configuredCompetitors;
        private float timeoutAt;
        private bool completed;

        public void Initialize(
            AuthoritativeMatchRuntime matchRuntime,
            string outputPath,
            int targetTick,
            int seed,
            int competitorCount)
        {
            runtime = matchRuntime;
            reportPath = outputPath;
            captureTick = targetTick;
            rootSeed = seed;
            configuredCompetitors = competitorCount;
        }

        private void Start()
        {
            var expectedSeconds =
                (float)captureTick /
                SimulationConstants.TicksPerSecond;
            timeoutAt =
                Time.realtimeSinceStartup +
                Mathf.Max(
                    MinimumTimeoutSeconds,
                    expectedSeconds + 15f);
        }

        private void Update()
        {
            if (completed)
            {
                return;
            }
            if (runtime == null)
            {
                Fail("Server smoke capture has no authoritative runtime.");
                return;
            }

            if (MatchNetworkRuntimeState.GhostRegistrationComplete &&
                MatchNetworkRuntimeState.ReplicatedGhostSnapshotTick >=
                    captureTick &&
                (
                    ServerRuntimeOptions.RematchSmokeFinishTick <= 0 ||
                    runtime.MatchSequence > 0
                ) &&
                MatchNetworkRuntimeState.TryGetReplicationSnapshot(
                    out var snapshot) &&
                snapshot.Tick ==
                    MatchNetworkRuntimeState.ReplicatedGhostSnapshotTick &&
                (
                    ServerRuntimeOptions.RematchSmokeFinishTick <= 0 ||
                    snapshot.Match.Status == MatchStatus.Running
                ))
            {
                completed = true;
                WriteReport(snapshot);
                Application.Quit(0);
                return;
            }
            if (Time.realtimeSinceStartup >= timeoutAt)
            {
                Fail(
                    $"Authoritative server did not reach tick {captureTick}.");
            }
        }

        private void WriteReport(WorldSnapshot snapshot)
        {
            var fullPath = Path.GetFullPath(reportPath);
            var directory = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                throw new InvalidOperationException(
                    $"Output path has no parent directory: {reportPath}");
            }
            Directory.CreateDirectory(directory);

            var remainingCompetitors = 0;
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                if (snapshot.Players[index].LifeState != LifeState.Eliminated)
                {
                    remainingCompetitors += 1;
                }
            }

            var report = new ServerLiveSmokeReport
            {
                schema = runtime.MatchSequence > 0
                    ? "jwgb.unity.server-rematch-smoke.v1"
                    : "jwgb.unity.server-live-smoke.v3",
                unityVersion = Application.unityVersion,
                mode = MatchNetworkRuntimeState.ServerListening
                    ? "authoritative-simulation-netcode-runtime-ghosts"
                    : "authoritative-simulation-network-not-listening",
                networkListening =
                    MatchNetworkRuntimeState.ServerListening,
                networkPort =
                    NetworkRuntimeOptions.Configuration.Port,
                peakConnectedClients =
                    MatchNetworkRuntimeState.PeakConnectedClientCount,
                receivedJoinRpcCount =
                    MatchNetworkRuntimeState.ReceivedJoinRpcCount,
                issuedReconnectTicketCount =
                    MatchNetworkRuntimeState
                        .IssuedReconnectTicketCount,
                resumedJoinRpcCount =
                    MatchNetworkRuntimeState.ResumedJoinRpcCount,
                activeReconnectReservationCount =
                    MatchNetworkRuntimeState
                        .ActiveReconnectReservationCount,
                acceptedInputRpcCount =
                    MatchNetworkRuntimeState.AcceptedInputRpcCount,
                appliedExternalInputCount =
                    runtime.AppliedExternalInputCount,
                lastAppliedExternalInputSequence =
                    runtime.LastAppliedExternalInputSequence,
                sentStateRpcCount =
                    MatchNetworkRuntimeState.SentStateRpcCount,
                sentEventRpcCount =
                    MatchNetworkRuntimeState.SentEventRpcCount,
                sentReplayEventRpcCount =
                    MatchNetworkRuntimeState
                        .SentReplayEventRpcCount,
                bufferedEventCount =
                    MatchNetworkRuntimeState.BufferedServerEventCount,
                matchSequence = runtime.MatchSequence,
                ghostRegistrationComplete =
                    MatchNetworkRuntimeState.GhostRegistrationComplete,
                replicatedGhostSnapshotTick =
                    MatchNetworkRuntimeState.ReplicatedGhostSnapshotTick,
                replicatedWorldGhostCount =
                    MatchNetworkRuntimeState.ReplicatedWorldGhostCount,
                replicatedPlayerGhostCount =
                    MatchNetworkRuntimeState.ReplicatedPlayerGhostCount,
                replicatedProjectileGhostCount =
                    MatchNetworkRuntimeState.ReplicatedProjectileGhostCount,
                replicatedWindWallGhostCount =
                    MatchNetworkRuntimeState.ReplicatedWindWallGhostCount,
                replicatedMonsterGhostCount =
                    MatchNetworkRuntimeState.ReplicatedMonsterGhostCount,
                replicatedLootGhostCount =
                    MatchNetworkRuntimeState.ReplicatedLootGhostCount,
                replicatedShopGhostCount =
                    MatchNetworkRuntimeState.ReplicatedShopGhostCount,
                peakReplicatedGhostCount =
                    MatchNetworkRuntimeState.PeakReplicatedGhostCount,
                rootSeed = rootSeed,
                configuredCompetitors = configuredCompetitors,
                mapEnabled = !string.IsNullOrEmpty(
                    snapshot.MapGeometryHash),
                mapGeometryHash =
                    snapshot.MapGeometryHash ?? string.Empty,
                pveEnabled = snapshot.PveEnabled,
                tick = snapshot.Tick,
                playerCount = snapshot.Players.Length,
                remainingCompetitors = remainingCompetitors,
                projectileCount = snapshot.Projectiles.Length,
                windWallCount = snapshot.WindWalls.Length,
                monsterCount = snapshot.Monsters.Length,
                lootDropCount = snapshot.LootDrops.Length,
                shopCount = snapshot.Shops.Length,
                stormRadiusMm = snapshot.StormZone?.RadiusMm ?? 0,
                matchStatus = snapshot.Match.Status
                    .ToString()
                    .ToLowerInvariant(),
                stateHash = snapshot.StateHash
            };
            File.WriteAllText(
                fullPath,
                JsonUtility.ToJson(report, prettyPrint: true));
        }

        private void Fail(string message)
        {
            completed = true;
            Debug.LogError(message);
            Application.Quit(2);
        }
    }
}
