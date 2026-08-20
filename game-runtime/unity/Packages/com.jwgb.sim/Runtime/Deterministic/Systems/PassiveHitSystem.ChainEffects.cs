using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveHitSystem
    {
        private static PassiveChainEffects ResolveChainEffects(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId,
            bool allowCombo)
        {
            var comboHits = 0;
            if (allowCombo &&
                PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Combo,
                    out var combo) &&
                ShouldProc(
                    state,
                    false,
                    new[] { 8, 10, 12, 15, 20 }[
                        combo.Level - 1]))
            {
                var maximum = PassiveCatalog.LevelValue(
                    PassiveCatalog.Get(GameplayIds.Combo)
                        .MaximumExtraHitsByLevel,
                    combo.Level);
                comboHits = 1 + (int)state.Random.Combat.NextInt(
                    (ulong)maximum);
                Emit(
                    state,
                    events,
                    GameplayIds.Combo,
                    owner.EntityId,
                    target.EntityId,
                    "combo",
                    comboHits,
                    0);
            }

            var coldDamage = 0;
            if (PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.ColdArrow,
                    out var cold) &&
                ShouldProc(
                    state,
                    forcedPassiveId == GameplayIds.ColdArrow,
                    new[] { 10, 12, 14, 16, 20 }[
                        cold.Level - 1]))
            {
                coldDamage = PassiveCatalog.LevelValue(
                    PassiveCatalog.Get(GameplayIds.ColdArrow)
                        .DamageByLevel,
                    cold.Level);
                Emit(
                    state,
                    events,
                    GameplayIds.ColdArrow,
                    owner.EntityId,
                    target.EntityId,
                    "cold-arrow",
                    coldDamage,
                    0);
            }

            var thunderstormTriggered = false;
            var thunderstormDamage = 0;
            var thunderstormRadius = 0;
            if (PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Thunderstorm,
                    out var thunderstorm))
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.Thunderstorm);
                var chancePercent = PassiveCatalog.LevelValue(
                    definition.ChancePercentByLevel,
                    thunderstorm.Level);
                if (thunderstorm.Level == 5 &&
                    StormSystem.IsInNormalStormZone(
                        state,
                        owner.Position))
                {
                    chancePercent = chancePercent *
                        definition.Level5StormChanceMultiplierBasisPoints /
                        10_000;
                }

                if (ShouldProc(
                        state,
                        forcedPassiveId == GameplayIds.Thunderstorm,
                        chancePercent))
                {
                    thunderstormTriggered = true;
                    thunderstormDamage = PassiveCatalog.LevelValue(
                        definition.DamageByLevel,
                        thunderstorm.Level);
                    thunderstormRadius = PassiveCatalog.LevelValue(
                        definition.RadiusMmByLevel,
                        thunderstorm.Level);
                    Emit(
                        state,
                        events,
                        GameplayIds.Thunderstorm,
                        owner.EntityId,
                        target.EntityId,
                        "thunderstorm",
                        thunderstormDamage,
                        thunderstormRadius);
                }
            }

            return new PassiveChainEffects(
                comboHits,
                coldDamage,
                thunderstormTriggered,
                thunderstormDamage,
                thunderstormRadius);
        }
    }
}
