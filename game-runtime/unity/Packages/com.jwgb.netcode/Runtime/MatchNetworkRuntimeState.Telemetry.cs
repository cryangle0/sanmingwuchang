using System;
using System.Collections.Generic;
using Unity.Collections;

namespace Jwgb.Netcode
{
    public static partial class MatchNetworkRuntimeState
    {
        public static void RecordServerTransport(
            bool listening,
            int connectedClientCount)
        {
            ServerListening = listening;
            PeakConnectedClientCount = Math.Max(
                PeakConnectedClientCount,
                connectedClientCount);
        }

        public static void RecordStateRpcsSent(int count)
        {
            SentStateRpcCount += count;
        }

        public static void RecordClientConnected(int networkId)
        {
            ClientNetworkId = networkId;
        }

        public static void RecordClientAccepted(
            int entityId,
            int matchSequence,
            int lastTransactionId,
            int lastEventCursor,
            FixedString64Bytes reconnectTicket,
            FixedString32Bytes assignedHeroId,
            bool resumedSession)
        {
            ClientEntityId = entityId;
            ClientMatchSequence = matchSequence;
            RestoreClientTransactionSequence(lastTransactionId);
            InitializeClientEventCursor(
                matchSequence,
                lastEventCursor);
            ClientReconnectTicket = reconnectTicket.ToString();
            ClientAssignedHeroId = assignedHeroId.ToString();
            ClientResumedSession = resumedSession;
        }

        public static void RecordClientAccepted(
            int entityId,
            int matchSequence,
            int lastTransactionId,
            FixedString64Bytes reconnectTicket,
            FixedString32Bytes assignedHeroId,
            bool resumedSession)
        {
            RecordClientAccepted(
                entityId,
                matchSequence,
                lastTransactionId,
                lastEventCursor: 0,
                reconnectTicket,
                assignedHeroId,
                resumedSession);
        }

        public static void RecordRemoteInterpolationFrame(
            int remoteViewCount,
            int heldViewCount,
            int maximumStepMm)
        {
            ClientRemoteInterpolationFrameCount += 1;
            ClientRemoteInterpolationHoldViewCount +=
                Math.Max(0, heldViewCount);
            ClientPeakRemoteInterpolatedViewCount = Math.Max(
                ClientPeakRemoteInterpolatedViewCount,
                remoteViewCount);
            ClientMaxRemoteInterpolationStepMm = Math.Max(
                ClientMaxRemoteInterpolationStepMm,
                maximumStepMm);
        }

        public static void SetClientInput(NetworkInputSample input)
        {
            clientInput = input;
            clientCastQueued |= input.CastActive;
            clientInteractQueued |= input.Interact;
        }

        public static NetworkInputSample TakeClientInput()
        {
            var result = new NetworkInputSample(
                clientInput.MoveX,
                clientInput.MoveZ,
                clientInput.AimX,
                clientInput.AimZ,
                clientInput.Attack,
                clientCastQueued,
                clientInteractQueued);
            clientCastQueued = false;
            clientInteractQueued = false;
            return result;
        }

        public static void RecordInputRpcSent(MatchInputRpc input)
        {
            SentInputRpcCount += 1;
            clientSentInputs.Add(new PredictedNetworkInput(input));
            if (clientSentInputs.Count > 512)
            {
                clientSentInputs.RemoveRange(
                    0,
                    clientSentInputs.Count - 512);
            }
        }

        public static void CopyUnacknowledgedClientInputs(
            int acknowledgedSequence,
            List<PredictedNetworkInput> destination)
        {
            destination.Clear();
            var removeCount = 0;
            while (removeCount < clientSentInputs.Count &&
                clientSentInputs[removeCount].Sequence <=
                    acknowledgedSequence)
            {
                removeCount += 1;
            }
            if (removeCount > 0)
            {
                clientSentInputs.RemoveRange(0, removeCount);
            }
            destination.AddRange(clientSentInputs);
        }

        public static void RecordClientState(MatchStateRpc state)
        {
            LatestClientState = state;
            ClientMatchSequence = state.MatchSequence;
            ReceivedStateRpcCount += 1;
        }

        public static void RecordClientGhostSnapshot(
            int worldCount,
            int playerCount,
            int projectileCount,
            int windWallCount,
            int monsterCount,
            int lootCount,
            int shopCount,
            bool mapEnabled,
            string mapGeometryHash,
            bool pveEnabled,
            int stormRadiusMm,
            int snapshotTick,
            MatchStateRpc state)
        {
            ClientWorldGhostCount = worldCount;
            ClientPlayerGhostCount = playerCount;
            ClientProjectileGhostCount = projectileCount;
            ClientWindWallGhostCount = windWallCount;
            ClientMonsterGhostCount = monsterCount;
            ClientLootGhostCount = lootCount;
            ClientShopGhostCount = shopCount;
            ClientMapEnabled = mapEnabled;
            ClientMapGeometryHash = mapGeometryHash;
            ClientPveEnabled = pveEnabled;
            ClientStormRadiusMm = stormRadiusMm;
            ClientGhostSnapshotTick = snapshotTick;
            ClientMatchSequence = state.MatchSequence;
            ClientCompleteSnapshotCount += 1;
            LatestClientGhostState = state;
        }

        public static void RecordClientPrediction(
            ClientPredictionTelemetry telemetry)
        {
            LatestClientPredictionTelemetry = telemetry;
            ClientPredictedInputCount = telemetry.PredictedInputCount;
            ClientPredictionReplayCount =
                telemetry.PredictionReplayCount;
            ClientPredictionFrameCount = telemetry.FrameCount;
            ClientPredictionCorrectionCount =
                telemetry.CorrectionCount;
            ClientPredictionHardSnapCount = telemetry.HardSnapCount;
            ClientPredictionReconciliationHardCorrectionCount =
                telemetry.ReconciliationHardCorrectionCount;
            ClientMaxPredictionErrorMm = telemetry.MaxErrorMm;
            ClientMaxPredictionVisualStepMm =
                telemetry.MaxVisualStepMm;
            ClientPredictedPositionX = telemetry.PredictedPosition.X;
            ClientPredictedPositionZ = telemetry.PredictedPosition.Z;
            ClientAuthoritativePositionX =
                telemetry.AuthoritativePosition.X;
            ClientAuthoritativePositionZ =
                telemetry.AuthoritativePosition.Z;
        }
    }
}
