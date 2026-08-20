namespace Jwgb.Sim.Deterministic
{
    public sealed partial class GameSimulation
    {
        public WorldSnapshot GetSnapshot()
        {
            return SnapshotFactory.Create(state);
        }

        /// <summary>
        /// Cheap per-tick snapshot for bot intent planning. Carries
        /// the tick, match summary and full player snapshots; the
        /// state hash and all PVE/world collections are omitted (empty
        /// defaults). Use <see cref="GetSnapshot"/> for replication,
        /// parity and persistence; this view is only for planners
        /// that read player data.
        /// </summary>
        public WorldSnapshot GetBotPlanningSnapshot()
        {
            return SnapshotFactory.CreatePlanning(state);
        }

        public PlayerRuntimeSnapshot GetPlayerRuntimeSnapshot(
            int entityId)
        {
            var player = StateQueries.GetRequiredPlayer(state, entityId);
            return new PlayerRuntimeSnapshot(
                player.EntityId,
                player.HardControlTicks,
                player.RespawnTarget,
                player.ReviveProtectionTicks,
                player.MoveRemainderX,
                player.MoveRemainderZ);
        }

        public string GetStateHash()
        {
            return StateHashBuilder.Compute(state);
        }

        /// <summary>
        /// Debug-only: canonical stable-JSON payload behind the state
        /// hash, for diffing against
        /// tools/migration/dump-sim-hash-input.ts.
        /// </summary>
        public string GetStateHashCanonicalJson()
        {
            return StateHashBuilder.ComputeCanonicalJson(state);
        }

        public SimEvent[] DrainEvents()
        {
            var events = pendingEvents.ToArray();
            pendingEvents.Clear();
            return events;
        }
    }
}
