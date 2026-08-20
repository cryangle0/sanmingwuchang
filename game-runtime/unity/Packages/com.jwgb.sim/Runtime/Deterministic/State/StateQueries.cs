using System;

namespace Jwgb.Sim.Deterministic
{
    internal static class StateQueries
    {
        public static PlayerState GetRequiredPlayer(
            SimulationState state,
            int entityId)
        {
            if (!state.Players.TryGetValue(entityId, out var player))
            {
                throw new ArgumentException(
                    $"Unknown entity {entityId}.",
                    nameof(entityId));
            }

            return player;
        }

        public static MonsterState GetRequiredMonster(
            SimulationState state,
            int entityId)
        {
            if (!state.Monsters.TryGetValue(entityId, out var monster))
            {
                throw new ArgumentException(
                    $"Unknown monster entity {entityId}.",
                    nameof(entityId));
            }

            return monster;
        }
    }
}
