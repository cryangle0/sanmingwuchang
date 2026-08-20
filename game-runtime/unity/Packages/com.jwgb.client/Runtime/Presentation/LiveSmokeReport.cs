using System;

namespace Jwgb.Client.Presentation
{
    [Serializable]
    internal sealed class LiveSmokeReport
    {
        public string schema;
        public string unityVersion;
        public string mode;
        public int tick;
        public int localEntityId;
        public int playerCount;
        public int remainingCompetitors;
        public int projectileCount;
        public int windWallCount;
        public int localHp;
        public int localMaxHp;
        public string stateHash;
        public int completeGhostSnapshotCount;
        public bool mapEnabled;
        public bool pveEnabled;
        public int monsterCount;
        public int lootDropCount;
        public int shopCount;
        public int stormRadiusMm;
        public int screenWidth;
        public int screenHeight;
    }
}
