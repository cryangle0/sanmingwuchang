using System;
using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of advanceActiveWorld from
    /// packages/sim/src/systems/active-world.ts restricted to the
    /// deterministic classic-arena slice: player history recording and
    /// monster active timers. Active zones, projectiles, and target
    /// effects never exist in fixtures, so their advance steps are no-ops.
    /// </summary>
    internal static class ActiveWorldSystem
    {
        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            _ = events;
            RecordPlayerHistory(state);
            AdvanceMonsterActiveTimers(state);
        }

        private static void RecordPlayerHistory(SimulationState state)
        {
            var minimumTick = state.Tick - 100;
            for (var index = state.PlayerHistoryFrames.Count - 1;
                index >= 0;
                index -= 1)
            {
                if (state.PlayerHistoryFrames[index].Tick < minimumTick)
                {
                    state.PlayerHistoryFrames.RemoveAt(index);
                }
            }

            foreach (var player in state.Players.Values)
            {
                if (player.LifeState != LifeState.Alive)
                {
                    continue;
                }

                state.PlayerHistoryFrames.Add(
                    new PlayerHistoryFrame
                    {
                        EntityId = player.EntityId,
                        Tick = state.Tick,
                        Position = player.Position,
                        Hp = player.Hp
                    });
            }
        }

        private static void AdvanceMonsterActiveTimers(SimulationState state)
        {
            foreach (var monster in state.Monsters.Values)
            {
                monster.PolymorphTicks = Math.Max(
                    0,
                    monster.PolymorphTicks - 1);
                monster.DisplacementLockTicks = Math.Max(
                    0,
                    monster.DisplacementLockTicks - 1);
            }
        }
    }
}
