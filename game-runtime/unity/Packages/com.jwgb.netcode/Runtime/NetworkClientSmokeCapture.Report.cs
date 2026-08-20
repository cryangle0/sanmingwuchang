using System;
using System.IO;
using UnityEngine;

namespace Jwgb.Netcode
{
    public sealed partial class NetworkClientSmokeCapture
    {
        private void WriteReport()
        {
            var path = NetworkRuntimeOptions.Configuration
                .ClientSmokeReportPath;
            var fullPath = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                throw new InvalidOperationException(
                    $"Output path has no parent directory: {path}");
            }
            Directory.CreateDirectory(directory);

            var state = MatchNetworkRuntimeState.LatestClientGhostState;
            var prediction = MatchNetworkRuntimeState
                .LatestClientPredictionTelemetry;
            var report = new NetworkClientSmokeReport
            {
                schema = rematchMode
                    ? "jwgb.unity.netcode-rematch-client-smoke.v1"
                    : "jwgb.unity.netcode-client-smoke.v9",
                unityVersion = Application.unityVersion,
                mode = rematchMode
                    ? "netcode-authoritative-rematch"
                    : "netcode-rpc-and-runtime-ghost-snapshot",
                networkId = MatchNetworkRuntimeState.ClientNetworkId,
                localEntityId = MatchNetworkRuntimeState.ClientEntityId,
                reconnectTicket =
                    MatchNetworkRuntimeState.ClientReconnectTicket,
                requestedHeroId =
                    NetworkClientJoinOptions.RequestedHeroId,
                assignedHeroId =
                    MatchNetworkRuntimeState.ClientAssignedHeroId,
                resumedSession =
                    MatchNetworkRuntimeState.ClientResumedSession,
                rematchRequested = rematchRequested,
                rematchObserved = rematchObserved,
                initialEntityId = initialEntityId,
                initialAssignedHeroId = initialAssignedHeroId,
                firstMatchFinishedTick = firstMatchFinishedTick,
                rematchTick = rematchTick,
                matchStatus = ((Jwgb.Sim.Deterministic.MatchStatus)
                        state.MatchStatus)
                    .ToString()
                    .ToLowerInvariant(),
                authoritativeTick = state.Tick,
                playerCount = state.PlayerCount,
                remainingCompetitors = state.RemainingCompetitors,
                projectileCount = state.ProjectileCount,
                windWallCount = state.WindWallCount,
                stateHash = state.StateHash.ToString("x8"),
                ghostSnapshotTick =
                    MatchNetworkRuntimeState.ClientGhostSnapshotTick,
                worldGhostCount =
                    MatchNetworkRuntimeState.ClientWorldGhostCount,
                playerGhostCount =
                    MatchNetworkRuntimeState.ClientPlayerGhostCount,
                projectileGhostCount =
                    MatchNetworkRuntimeState.ClientProjectileGhostCount,
                windWallGhostCount =
                    MatchNetworkRuntimeState.ClientWindWallGhostCount,
                monsterGhostCount =
                    MatchNetworkRuntimeState.ClientMonsterGhostCount,
                lootGhostCount =
                    MatchNetworkRuntimeState.ClientLootGhostCount,
                shopGhostCount =
                    MatchNetworkRuntimeState.ClientShopGhostCount,
                mapEnabled =
                    MatchNetworkRuntimeState.ClientMapEnabled,
                mapGeometryHash =
                    MatchNetworkRuntimeState.ClientMapGeometryHash,
                pveEnabled =
                    MatchNetworkRuntimeState.ClientPveEnabled,
                monsterCount =
                    MatchNetworkRuntimeState.ClientMonsterGhostCount,
                stormRadiusMm =
                    MatchNetworkRuntimeState.ClientStormRadiusMm,
                completeGhostSnapshotCount =
                    MatchNetworkRuntimeState.ClientCompleteSnapshotCount,
                predictedInputCount =
                    MatchNetworkRuntimeState.ClientPredictedInputCount,
                predictionReplayCount =
                    MatchNetworkRuntimeState.ClientPredictionReplayCount,
                predictionFrameCount =
                    MatchNetworkRuntimeState.ClientPredictionFrameCount,
                predictionCorrectionCount =
                    MatchNetworkRuntimeState
                        .ClientPredictionCorrectionCount,
                predictionHardSnapCount =
                    MatchNetworkRuntimeState
                        .ClientPredictionHardSnapCount,
                predictionReconciliationHardCorrectionCount =
                    MatchNetworkRuntimeState
                        .ClientPredictionReconciliationHardCorrectionCount,
                maxPredictionErrorMm =
                    MatchNetworkRuntimeState
                        .ClientMaxPredictionErrorMm,
                maxPredictionVisualStepMm =
                    MatchNetworkRuntimeState
                        .ClientMaxPredictionVisualStepMm,
                latestAcknowledgedInputSequence =
                    prediction.LatestAcknowledgedSequence,
                latestSentInputSequence =
                    prediction.LatestSentSequence,
                unacknowledgedInputCount =
                    prediction.UnacknowledgedInputCount,
                maxPredictionErrorAtAuthoritativeTick =
                    prediction.MaxErrorAtAuthoritativeTick,
                maxPredictionErrorAcknowledgedSequence =
                    prediction.MaxErrorAcknowledgedSequence,
                maxPredictionErrorPendingInputCount =
                    prediction.MaxErrorPendingInputCount,
                maxPredictionErrorAuthoritativeTickDelta =
                    prediction.MaxErrorAuthoritativeTickDelta,
                maxPredictionErrorAuthoritativeStepMm =
                    prediction.MaxErrorAuthoritativeStepMm,
                maxPredictionErrorPreviousPredictedX =
                    prediction.MaxErrorPreviousPredictedPosition.X,
                maxPredictionErrorPreviousPredictedZ =
                    prediction.MaxErrorPreviousPredictedPosition.Z,
                maxPredictionErrorReconciledX =
                    prediction.MaxErrorReconciledPosition.X,
                maxPredictionErrorReconciledZ =
                    prediction.MaxErrorReconciledPosition.Z,
                maxPredictionErrorAuthoritativeX =
                    prediction.MaxErrorAuthoritativePosition.X,
                maxPredictionErrorAuthoritativeZ =
                    prediction.MaxErrorAuthoritativePosition.Z,
                maxPredictionErrorPreviousLifeState =
                    prediction.MaxErrorPreviousLifeState,
                maxPredictionErrorLifeState =
                    prediction.MaxErrorLifeState,
                maxPredictionErrorHp = prediction.MaxErrorHp,
                maxPredictionErrorHardControlTicks =
                    prediction.MaxErrorHardControlTicks,
                maxPredictionErrorIceCoffinTicks =
                    prediction.MaxErrorIceCoffinTicks,
                maxPredictionErrorWhirlwindTicks =
                    prediction.MaxErrorWhirlwindTicks,
                maxPredictionErrorReviveProtectionTicks =
                    prediction.MaxErrorReviveProtectionTicks,
                maxPredictionErrorActiveAbilityId =
                    prediction.MaxErrorActiveAbilityId,
                maxPredictionErrorClassification =
                    prediction.MaxErrorClassification,
                predictedLocalX =
                    MatchNetworkRuntimeState.ClientPredictedPositionX,
                predictedLocalZ =
                    MatchNetworkRuntimeState.ClientPredictedPositionZ,
                authoritativeLocalX =
                    MatchNetworkRuntimeState
                        .ClientAuthoritativePositionX,
                authoritativeLocalZ =
                    MatchNetworkRuntimeState
                        .ClientAuthoritativePositionZ,
                remoteInterpolationFrameCount =
                    MatchNetworkRuntimeState
                        .ClientRemoteInterpolationFrameCount,
                remoteInterpolationHoldViewCount =
                    MatchNetworkRuntimeState
                        .ClientRemoteInterpolationHoldViewCount,
                peakRemoteInterpolatedViewCount =
                    MatchNetworkRuntimeState
                        .ClientPeakRemoteInterpolatedViewCount,
                maxRemoteInterpolationStepMm =
                    MatchNetworkRuntimeState
                        .ClientMaxRemoteInterpolationStepMm,
                sentInputRpcCount =
                    MatchNetworkRuntimeState.SentInputRpcCount,
                receivedStateRpcCount =
                    MatchNetworkRuntimeState.ReceivedStateRpcCount,
                eventMatchSequence =
                    MatchNetworkRuntimeState
                        .ClientEventMatchSequence,
                lastEventCursor =
                    MatchNetworkRuntimeState.ClientLastEventCursor,
                receivedEventRpcCount =
                    MatchNetworkRuntimeState.ReceivedEventRpcCount,
                receivedReplayEventRpcCount =
                    MatchNetworkRuntimeState
                        .ReceivedReplayEventRpcCount,
                ignoredEventRpcCount =
                    MatchNetworkRuntimeState.IgnoredEventRpcCount
            };
            File.WriteAllText(
                fullPath,
                JsonUtility.ToJson(report, prettyPrint: true));
        }
    }
}
