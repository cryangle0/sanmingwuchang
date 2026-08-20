using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class StormSystem
    {
        public static bool IsInNormalStormZone(
            SimulationState state,
            Int2Mm position)
        {
            return StormZoneSystem.IsInNormalStormZone(state, position);
        }

        public static void Resolve(
            SimulationState state,
            List<SimEvent> events)
        {
            ResolveNormalStorm(state, events);
            ResolveFinalStorm(state, events);
        }

        private static void ResolveNormalStorm(
            SimulationState state,
            List<SimEvent> events)
        {
            if (state.Tick >= GameplayRules.ApocalypseStartTick ||
                state.Tick %
                (3 * SimulationConstants.TicksPerSecond) != 0)
            {
                return;
            }

            foreach (var player in state.Players.Values)
            {
                if (player.LifeState != LifeState.Alive ||
                    !StormZoneSystem.IsInNormalStormZone(
                        state,
                        player.Position))
                {
                    continue;
                }

                var hitChancePercent = 50;
                if (PassiveRuntimeSystem.TryFind(
                        player,
                        GameplayIds.StormWard,
                        out var ward))
                {
                    var definition = PassiveCatalog.Get(
                        GameplayIds.StormWard);
                    var reduction = PassiveCatalog.LevelValue(
                        definition.StormChanceReductionPercentByLevel,
                        ward.Level);
                    hitChancePercent =
                        hitChancePercent * (100 - reduction) / 100;
                }

                if (state.Random.Storm.NextInt(100) >= hitChancePercent)
                {
                    continue;
                }

                var applied = DamageSystem.Apply(
                    state,
                    events,
                    new DamageRequest(
                        null,
                        player.EntityId,
                        Math.Max(1, player.MaxHp * 20 / 100),
                        DamageCause.Storm,
                        DamageForm.Storm));
                if (applied > 0 &&
                    player.LifeState == LifeState.Alive &&
                    !LethalProtectionSystem.HasControlImmunity(player))
                {
                    player.HardControlTicks = Math.Max(
                        player.HardControlTicks,
                        SimulationConstants.TicksPerSecond / 2);
                    player.WhirlwindTicks = 0;
                    player.WhirlwindNextPulseTick = 0;
                }
            }
        }

        private static void ResolveFinalStorm(
            SimulationState state,
            List<SimEvent> events)
        {
            if (state.Tick < GameplayRules.ApocalypseFirstDamageTick ||
                state.Tick %
                GameplayRules.ApocalypseDamageIntervalTicks != 0)
            {
                return;
            }

            var elapsedSeconds =
                state.Tick / SimulationConstants.TicksPerSecond;
            var damagePercent =
                2 + ((elapsedSeconds - 1_200) / 5);
            foreach (var player in state.Players.Values)
            {
                if (player.LifeState != LifeState.Alive)
                {
                    continue;
                }

                var damage = Math.Max(
                    1,
                    checked(player.MaxHp * damagePercent / 100));
                DamageSystem.Apply(
                    state,
                    events,
                    new DamageRequest(
                        null,
                        player.EntityId,
                        damage,
                        DamageCause.Storm,
                        DamageForm.Storm));
            }
        }
    }
}
