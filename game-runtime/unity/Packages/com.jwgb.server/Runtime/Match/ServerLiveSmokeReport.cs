using System;

namespace Jwgb.Server
{
    [Serializable]
    internal sealed class ServerLiveSmokeReport
    {
        public string schema;
        public string unityVersion;
        public string mode;
        public bool networkListening;
        public int networkPort;
        public int peakConnectedClients;
        public int receivedJoinRpcCount;
        public int issuedReconnectTicketCount;
        public int resumedJoinRpcCount;
        public int activeReconnectReservationCount;
        public int acceptedInputRpcCount;
        public int appliedExternalInputCount;
        public int lastAppliedExternalInputSequence;
        public int sentStateRpcCount;
        public int sentEventRpcCount;
        public int sentReplayEventRpcCount;
        public int bufferedEventCount;
        public int matchSequence;
        public bool ghostRegistrationComplete;
        public int replicatedGhostSnapshotTick;
        public int replicatedWorldGhostCount;
        public int replicatedPlayerGhostCount;
        public int replicatedProjectileGhostCount;
        public int replicatedWindWallGhostCount;
        public int replicatedMonsterGhostCount;
        public int replicatedLootGhostCount;
        public int replicatedShopGhostCount;
        public int peakReplicatedGhostCount;
        public int rootSeed;
        public int configuredCompetitors;
        public bool mapEnabled;
        public string mapGeometryHash;
        public bool pveEnabled;
        public int tick;
        public int playerCount;
        public int remainingCompetitors;
        public int projectileCount;
        public int windWallCount;
        public int monsterCount;
        public int lootDropCount;
        public int shopCount;
        public int stormRadiusMm;
        public string matchStatus;
        public string stateHash;
    }
}
