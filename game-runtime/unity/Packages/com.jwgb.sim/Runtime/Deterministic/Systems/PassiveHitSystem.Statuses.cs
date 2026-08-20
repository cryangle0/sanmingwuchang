using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveHitSystem
    {
        public static void ApplyStatuses(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            bool isCritical,
            string forcedPassiveId = null)
        {
            if (!target.IsPlayer && !target.IsMonster)
            {
                return;
            }

            ApplyFrost(
                state,
                events,
                owner,
                target,
                forcedPassiveId);
            ApplyParalysis(
                state,
                events,
                owner,
                target,
                forcedPassiveId);
            ApplyBlind(
                state,
                events,
                owner,
                target,
                forcedPassiveId);
            ApplyStun(
                state,
                events,
                owner,
                target,
                forcedPassiveId);
            if (isCritical || forcedPassiveId == GameplayIds.Knockback)
            {
                ApplyKnockback(
                    state,
                    events,
                    owner,
                    target,
                    forcedPassiveId);
            }
        }

        private static void ApplyFrost(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Frost,
                    out var loadout) ||
                !ShouldProc(
                    state,
                    forcedPassiveId == GameplayIds.Frost,
                    new[] { 10, 13, 16, 20, 25 }[
                        loadout.Level - 1]))
            {
                return;
            }

            var definition = PassiveCatalog.Get(GameplayIds.Frost);
            var duration = PassiveCatalog.LevelValue(
                definition.DurationTicksByLevel,
                loadout.Level);
            var slow = PassiveCatalog.LevelValue(
                definition.SlowPercentByLevel,
                loadout.Level);
            MaxSlow(target, slow, duration);
            Emit(
                state,
                events,
                GameplayIds.Frost,
                owner.EntityId,
                target.EntityId,
                "slow",
                slow,
                duration);

            if (loadout.Level != 5)
            {
                return;
            }

            foreach (var nearby in NearbyTargets(
                         state,
                         target.Position,
                         definition.Level5AoeRadiusMm))
            {
                if (nearby.EntityId == target.EntityId ||
                    nearby.EntityId == owner.EntityId)
                {
                    continue;
                }

                MaxSlow(
                    nearby,
                    definition.Level5AoeSlowPercent,
                    duration);
            }
        }

        private static void ApplyParalysis(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Paralysis,
                    out var loadout) ||
                !ShouldProc(
                    state,
                    forcedPassiveId == GameplayIds.Paralysis,
                    new[] { 8, 10, 12, 15, 18 }[
                        loadout.Level - 1]))
            {
                return;
            }

            var definition = PassiveCatalog.Get(
                GameplayIds.Paralysis);
            var duration = PassiveCatalog.LevelValue(
                definition.DurationTicksByLevel,
                loadout.Level);
            SetSilence(target, duration);
            if (loadout.Level == 5)
            {
                AddSilencePenalty(
                    target,
                    definition.Level5CooldownPenaltyTicks);
            }

            Emit(
                state,
                events,
                GameplayIds.Paralysis,
                owner.EntityId,
                target.EntityId,
                "silence",
                0,
                duration);
        }

        private static void ApplyBlind(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Blind,
                    out var loadout) ||
                !ShouldProc(
                    state,
                    forcedPassiveId == GameplayIds.Blind,
                    new[] { 10, 12, 14, 17, 20 }[
                        loadout.Level - 1]))
            {
                return;
            }

            var definition = PassiveCatalog.Get(GameplayIds.Blind);
            var duration = PassiveCatalog.LevelValue(
                definition.DurationTicksByLevel,
                loadout.Level);
            var miss = PassiveCatalog.LevelValue(
                definition.MissPercentByLevel,
                loadout.Level);
            SetBlind(target, duration, miss);
            Emit(
                state,
                events,
                GameplayIds.Blind,
                owner.EntityId,
                target.EntityId,
                "blind",
                miss,
                duration);
        }

    }
}
