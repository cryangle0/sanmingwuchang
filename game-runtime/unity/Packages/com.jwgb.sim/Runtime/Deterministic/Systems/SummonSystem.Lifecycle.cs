using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class SummonSystem
    {
        private static void EnsureStoneStatues(
            SimulationState state,
            List<SimEvent> events)
        {
            foreach (var owner in state.Players.Values)
            {
                if (owner.LifeState != LifeState.Alive ||
                    !PassiveRuntimeSystem.TryFind(
                        owner,
                        GameplayIds.StoneStatue,
                        out var loadout))
                {
                    continue;
                }

                var definition = PassiveCatalog.Get(
                    GameplayIds.StoneStatue);
                var requiredTicks = PassiveCatalog.LevelValue(
                    definition.OutOfCombatTicksByLevel,
                    loadout.Level);
                if (state.Tick - owner.LastCombatTick >= requiredTicks)
                {
                    SpawnStoneStatue(
                        state,
                        events,
                        owner,
                        definition,
                        loadout);
                }
            }
        }

        private static void SpawnStoneStatue(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            PassiveDefinition definition,
            PassiveLoadoutEntry loadout)
        {
            if (Count(
                    state,
                    owner.EntityId,
                    SummonKind.StoneStatue) > 0)
            {
                return;
            }

            var hp = PassiveCatalog.LevelValue(
                definition.HpByLevel,
                loadout.Level);
            var summon = new SummonState
            {
                EntityId = state.NextEntityId,
                OwnerEntityId = owner.EntityId,
                Kind = SummonKind.StoneStatue,
                Position = owner.Position,
                Hp = hp,
                MaxHp = hp,
                Targetable = true,
                ExpiresAtTick = int.MaxValue
            };
            state.NextEntityId += 1;
            state.Summons.Add(summon.EntityId, summon);
            AddSpawnEvent(state, events, summon);
        }

        private static void AdvanceStoneStatue(
            SummonState summon,
            PlayerState owner)
        {
            if (IntegerMath.DistanceSquared(
                    summon.Position,
                    owner.Position) <= 2_000L * 2_000)
            {
                return;
            }

            summon.Position = IntegerMath.MoveToward(
                summon.Position,
                owner.Position,
                4_000 / SimulationConstants.TicksPerSecond);
        }

        private static void Remove(
            SimulationState state,
            List<SimEvent> events,
            SummonState summon,
            bool destroyed)
        {
            if (!state.Summons.Remove(summon.EntityId))
            {
                return;
            }

            if (state.Players.TryGetValue(
                    summon.OwnerEntityId,
                    out var owner))
            {
                ResolveDeathEffects(
                    state,
                    events,
                    summon,
                    owner,
                    destroyed);
            }

            events.Add(
                new SimEvent
                {
                    Type = "summon-expired",
                    Tick = state.Tick,
                    EntityId = summon.EntityId,
                    OwnerEntityId = summon.OwnerEntityId,
                    SummonKind = SimulationText.SummonKind(summon.Kind)
                });
        }
    }
}
