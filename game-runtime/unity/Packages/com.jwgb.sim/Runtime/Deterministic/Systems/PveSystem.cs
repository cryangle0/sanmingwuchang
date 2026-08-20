using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static class PveSystem
    {
        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            if (!state.PveEnabled ||
                state.Match.Status != MatchStatus.Running)
            {
                return;
            }

            PveSpawnSystem.AdvanceRespawns(state, events);
            LootSystem.Expire(state, events);
            CoreBossSystem.Advance(state, events);
            // Reused scratch copy: PveAiSystem may add or remove
            // monsters mid-iteration, so AI advances over a stable
            // SortedDictionary-ordered copy. The buffer lives on the
            // state to avoid a per-tick List allocation.
            var monsters = state.MonsterAdvanceScratch;
            monsters.Clear();
            foreach (var monster in state.Monsters.Values)
            {
                monsters.Add(monster);
            }
            for (var index = 0; index < monsters.Count; index += 1)
            {
                var monster = monsters[index];
                if (state.Monsters.ContainsKey(monster.EntityId))
                {
                    PveAiSystem.Advance(state, events, monster);
                }
            }
            monsters.Clear();

            LootSystem.CollectNearby(state, events);
        }
    }
}
