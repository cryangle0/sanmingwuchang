namespace Jwgb.Netcode
{
    public static class MatchNetworkDefaults
    {
        public const int ProtocolVersion = 7;
        public const ushort Port = 7979;
        public const int SnapshotRate = 10;
        // Monsters, loot and shop pads change slowly; cap their ghost
        // send rate below the player snapshot rate to bound bandwidth
        // for the 123-monster full population without interest
        // management. Spawn/despawn still replicates immediately.
        public const int PveSnapshotRate = 4;
        public const int SimulationRate = 20;
        public const int BotTakeoverDelaySeconds = 3;
        public const int BotTakeoverDelayTicks =
            SimulationRate * BotTakeoverDelaySeconds;
        public const int ReconnectGraceSeconds = 120;
        public const int ReconnectGraceTicks =
            SimulationRate * ReconnectGraceSeconds;
    }
}
