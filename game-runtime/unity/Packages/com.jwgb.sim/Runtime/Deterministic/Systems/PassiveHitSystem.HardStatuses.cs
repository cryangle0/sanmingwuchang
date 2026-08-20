using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveHitSystem
    {
        private static void ApplyStun(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Stun,
                    out var loadout))
            {
                return;
            }

            var targetState = PassiveRuntimeSystem.GetOrCreateTargetState(
                state,
                owner.EntityId,
                target.EntityId);
            var definition = PassiveCatalog.Get(GameplayIds.Stun);
            if (definition.Effect != PassiveEffect.BasicStun ||
                targetState.StunCooldownTicks > 0 ||
                !ShouldProc(
                    state,
                    forcedPassiveId == GameplayIds.Stun,
                    PassiveCatalog.LevelValue(
                        definition.ChancePercentByLevel,
                        loadout.Level)))
            {
                return;
            }

            targetState.StunCooldownTicks =
                definition.InternalCooldownTicks;
            var duration = PassiveCatalog.LevelValue(
                definition.DurationTicksByLevel,
                loadout.Level);
            ApplyControl(target, duration);
            Emit(
                state,
                events,
                GameplayIds.Stun,
                owner.EntityId,
                target.EntityId,
                "stun",
                0,
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

                ApplyControl(
                    nearby,
                    definition.Level5AoeDurationTicks);
            }
        }

        private static void ApplyKnockback(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Knockback,
                    out var loadout) ||
                !ShouldProc(
                    state,
                    forcedPassiveId == GameplayIds.Knockback,
                    new[] { 20, 23, 26, 30, 35 }[
                        loadout.Level - 1]))
            {
                return;
            }

            var definition = PassiveCatalog.Get(
                GameplayIds.Knockback);
            var distance = PassiveCatalog.LevelValue(
                definition.DistanceMmByLevel,
                loadout.Level);
            MoveAway(
                state,
                owner.Position,
                target,
                distance);
            Emit(
                state,
                events,
                GameplayIds.Knockback,
                owner.EntityId,
                target.EntityId,
                "knockback",
                distance,
                0);

            if (loadout.Level != 5)
            {
                return;
            }

            foreach (var nearby in NearbyTargets(
                         state,
                         target.Position,
                         definition.Level5AoeRadiusMm))
            {
                if (nearby.EntityId == owner.EntityId ||
                    nearby.EntityId == target.EntityId)
                {
                    continue;
                }

                MoveAway(
                    state,
                    target.Position,
                    nearby,
                    definition.Level5AoeDistanceMm);
            }
        }
    }
}
