using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static class SummonHealthSystem
    {
        public static int Apply(
            SimulationState state,
            List<SimEvent> events,
            int sourceEntityId,
            SummonState summon,
            int amount)
        {
            if (amount <= 0 ||
                !summon.Targetable ||
                summon.Hp <= 0 ||
                !state.Summons.ContainsKey(summon.EntityId))
            {
                return 0;
            }

            var actualDamage = Math.Min(summon.Hp, amount);
            summon.Hp -= actualDamage;
            if (summon.Hp == 0)
            {
                var hostilePlayer =
                    state.Players.TryGetValue(
                        sourceEntityId,
                        out var sourcePlayer) &&
                    sourcePlayer.EntityId != summon.OwnerEntityId;
                var hostileSummon =
                    state.Summons.TryGetValue(
                        sourceEntityId,
                        out var sourceSummon) &&
                    sourceSummon.OwnerEntityId != summon.OwnerEntityId;
                summon.DestroyedByHostileDamage =
                    state.Monsters.ContainsKey(sourceEntityId) ||
                    hostilePlayer ||
                    hostileSummon;
            }

            events.Add(
                new SimEvent
                {
                    Type = "passive-proc",
                    Tick = state.Tick,
                    PassiveId = summon.Kind == SummonKind.StoneStatue
                        ? GameplayIds.StoneStatue
                        : GameplayIds.WolfSpirit,
                    SourceEntityId = sourceEntityId,
                    TargetEntityId = summon.EntityId,
                    Detail = "summon-damaged",
                    Amount = actualDamage,
                    DurationTicks = 0
                });
            return actualDamage;
        }
    }
}
