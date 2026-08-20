using System;
using System.Collections.Generic;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Netcode
{
    public static partial class MatchNetworkRuntimeState
    {
        private readonly struct ReconnectReservation
        {
            public ReconnectReservation(
                int entityId,
                int expiresAtTick)
            {
                EntityId = entityId;
                ExpiresAtTick = expiresAtTick;
            }

            public int EntityId { get; }

            public int ExpiresAtTick { get; }
        }

        private static readonly Dictionary<int, int> entityByNetworkId =
            new Dictionary<int, int>();
        private static readonly Dictionary<int, int> lastInputByNetworkId =
            new Dictionary<int, int>();
        private static readonly Dictionary<int, string>
            ticketByNetworkId = new Dictionary<int, string>();
        private static readonly Dictionary<int, int>
            processedInputByEntity = new Dictionary<int, int>();
        private static readonly Dictionary<int, PlayerRuntimeSnapshot>
            playerRuntimeByEntity =
                new Dictionary<int, PlayerRuntimeSnapshot>();
        private static readonly Dictionary<string, ReconnectReservation>
            reconnectReservations =
                new Dictionary<string, ReconnectReservation>(
                    StringComparer.Ordinal);
        private static readonly HashSet<int> expiredReconnectEntityIds =
            new HashSet<int>();
        private static readonly List<string> expiredReconnectTickets =
            new List<string>();
        private static readonly List<PredictedNetworkInput>
            clientSentInputs = new List<PredictedNetworkInput>();
        private static readonly Queue<AcceptedNetworkInput> serverInputs =
            new Queue<AcceptedNetworkInput>();
        private static readonly Queue<NetworkPlayerAssignment> assignments =
            new Queue<NetworkPlayerAssignment>();
        private static int[] competitorEntityIds = Array.Empty<int>();
        private static string[] heroBySlot = Array.Empty<string>();
        private static bool[] assignedSlots = Array.Empty<bool>();
        private static WorldSnapshot latestServerSnapshot;
        private static WorldSnapshot latestReplicationSnapshot;
        private static NetworkInputSample clientInput;
        private static bool clientCastQueued;
        private static bool clientInteractQueued;

        public static bool ServerListening { get; private set; }
        public static int PeakConnectedClientCount { get; private set; }
        public static int ReceivedJoinRpcCount { get; private set; }
        public static int IssuedReconnectTicketCount { get; private set; }
        public static int ResumedJoinRpcCount { get; private set; }
        public static int AcceptedInputRpcCount { get; private set; }
        public static int RejectedInputRpcCount { get; private set; }
        public static int SentStateRpcCount { get; private set; }
        public static int ServerMatchSequence { get; private set; }
        public static int ClientNetworkId { get; private set; }
        public static int ClientEntityId { get; private set; }
        public static int ClientMatchSequence { get; private set; }
        public static string ClientReconnectTicket { get; private set; }
        public static string ClientAssignedHeroId { get; private set; }
        public static bool ClientResumedSession { get; private set; }
        public static int SentInputRpcCount { get; private set; }
        public static int ReceivedStateRpcCount { get; private set; }
        public static bool GhostRegistrationComplete { get; private set; }
        public static int ReplicatedWorldGhostCount { get; private set; }
        public static int ReplicatedPlayerGhostCount { get; private set; }
        public static int ReplicatedProjectileGhostCount { get; private set; }
        public static int ReplicatedWindWallGhostCount { get; private set; }
        public static int ReplicatedMonsterGhostCount { get; private set; }
        public static int ReplicatedLootGhostCount { get; private set; }
        public static int ReplicatedShopGhostCount { get; private set; }
        public static int ReplicatedGhostSnapshotTick { get; private set; }
        public static int PeakReplicatedGhostCount { get; private set; }
        public static int ClientWorldGhostCount { get; private set; }
        public static int ClientPlayerGhostCount { get; private set; }
        public static int ClientProjectileGhostCount { get; private set; }
        public static int ClientWindWallGhostCount { get; private set; }
        public static int ClientMonsterGhostCount { get; private set; }
        public static int ClientLootGhostCount { get; private set; }
        public static int ClientShopGhostCount { get; private set; }
        public static bool ClientMapEnabled { get; private set; }
        public static string ClientMapGeometryHash { get; private set; }
        public static bool ClientPveEnabled { get; private set; }
        public static int ClientStormRadiusMm { get; private set; }
        public static int ClientGhostSnapshotTick { get; private set; }
        public static int ClientCompleteSnapshotCount { get; private set; }
        public static int ClientPredictedInputCount { get; private set; }
        public static int ClientPredictionReplayCount { get; private set; }
        public static int ClientPredictionFrameCount { get; private set; }
        public static int ClientPredictionCorrectionCount {
            get;
            private set;
        }
        public static int ClientPredictionHardSnapCount {
            get;
            private set;
        }
        public static int ClientPredictionReconciliationHardCorrectionCount {
            get;
            private set;
        }
        public static int ClientMaxPredictionErrorMm { get; private set; }
        public static int ClientMaxPredictionVisualStepMm {
            get;
            private set;
        }
        public static int LatestClientSentInputSequence =>
            clientSentInputs.Count == 0
                ? 0
                : clientSentInputs[clientSentInputs.Count - 1].Sequence;
        public static ClientPredictionTelemetry
            LatestClientPredictionTelemetry { get; private set; }
        public static int ClientPredictedPositionX { get; private set; }
        public static int ClientPredictedPositionZ { get; private set; }
        public static int ClientAuthoritativePositionX { get; private set; }
        public static int ClientAuthoritativePositionZ { get; private set; }
        public static int ClientRemoteInterpolationFrameCount {
            get;
            private set;
        }
        public static int ClientRemoteInterpolationHoldViewCount {
            get;
            private set;
        }
        public static int ClientPeakRemoteInterpolatedViewCount {
            get;
            private set;
        }
        public static int ClientMaxRemoteInterpolationStepMm {
            get;
            private set;
        }
        public static MatchStateRpc LatestClientState { get; private set; }
        public static MatchStateRpc LatestClientGhostState { get; private set; }
        public static int ActiveReconnectReservationCount =>
            reconnectReservations.Count;
        public static int ExpiredReconnectSessionCount =>
            expiredReconnectEntityIds.Count;

        public static void ResetProcessState()
        {
            entityByNetworkId.Clear();
            lastInputByNetworkId.Clear();
            ticketByNetworkId.Clear();
            processedInputByEntity.Clear();
            playerRuntimeByEntity.Clear();
            reconnectReservations.Clear();
            expiredReconnectEntityIds.Clear();
            expiredReconnectTickets.Clear();
            clientSentInputs.Clear();
            serverInputs.Clear();
            assignments.Clear();
            ResetServerTransactionState();
            ResetServerEventState();
            ResetRematchState();
            competitorEntityIds = Array.Empty<int>();
            heroBySlot = Array.Empty<string>();
            assignedSlots = Array.Empty<bool>();
            latestServerSnapshot = null;
            latestReplicationSnapshot = null;
            ServerListening = false;
            PeakConnectedClientCount = 0;
            ReceivedJoinRpcCount = 0;
            IssuedReconnectTicketCount = 0;
            ResumedJoinRpcCount = 0;
            AcceptedInputRpcCount = 0;
            RejectedInputRpcCount = 0;
            SentStateRpcCount = 0;
            ServerMatchSequence = 0;
            ResetClientConnectionState();
            GhostRegistrationComplete = false;
            ReplicatedWorldGhostCount = 0;
            ReplicatedPlayerGhostCount = 0;
            ReplicatedProjectileGhostCount = 0;
            ReplicatedWindWallGhostCount = 0;
            ReplicatedMonsterGhostCount = 0;
            ReplicatedLootGhostCount = 0;
            ReplicatedShopGhostCount = 0;
            ReplicatedGhostSnapshotTick = 0;
            PeakReplicatedGhostCount = 0;
        }

        public static void ResetClientConnectionState()
        {
            ResetClientTransactionState();
            ResetClientEventState();
            clientRematchQueued = false;
            nextClientRematchSequence = 0;
            clientSentInputs.Clear();
            clientInput = default;
            clientCastQueued = false;
            clientInteractQueued = false;
            ClientNetworkId = 0;
            ClientEntityId = 0;
            ClientMatchSequence = 0;
            ClientReconnectTicket = null;
            ClientAssignedHeroId = null;
            ClientResumedSession = false;
            SentInputRpcCount = 0;
            ReceivedStateRpcCount = 0;
            ClientWorldGhostCount = 0;
            ClientPlayerGhostCount = 0;
            ClientProjectileGhostCount = 0;
            ClientWindWallGhostCount = 0;
            ClientMonsterGhostCount = 0;
            ClientLootGhostCount = 0;
            ClientShopGhostCount = 0;
            ClientMapEnabled = false;
            ClientMapGeometryHash = null;
            ClientPveEnabled = false;
            ClientStormRadiusMm = 0;
            ClientGhostSnapshotTick = 0;
            ClientCompleteSnapshotCount = 0;
            ClientPredictedInputCount = 0;
            ClientPredictionReplayCount = 0;
            ClientPredictionFrameCount = 0;
            ClientPredictionCorrectionCount = 0;
            ClientPredictionHardSnapCount = 0;
            ClientPredictionReconciliationHardCorrectionCount = 0;
            ClientMaxPredictionErrorMm = 0;
            ClientMaxPredictionVisualStepMm = 0;
            LatestClientPredictionTelemetry = default;
            ClientPredictedPositionX = 0;
            ClientPredictedPositionZ = 0;
            ClientAuthoritativePositionX = 0;
            ClientAuthoritativePositionZ = 0;
            ClientRemoteInterpolationFrameCount = 0;
            ClientRemoteInterpolationHoldViewCount = 0;
            ClientPeakRemoteInterpolatedViewCount = 0;
            ClientMaxRemoteInterpolationStepMm = 0;
            LatestClientState = default;
            LatestClientGhostState = default;
        }
    }
}
