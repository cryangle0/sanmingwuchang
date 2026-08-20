using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveHitSystem
    {
        private static PassiveDamageEffects ResolveDamageEffects(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId)
        {
            var splashTriggered = false;
            var splashPercent = 0;
            var splashRadius = 0;
            if (PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Splash,
                    out var splash) &&
                ShouldProc(
                    state,
                    forcedPassiveId == GameplayIds.Splash,
                    new[] { 10, 13, 16, 20, 25 }[
                        splash.Level - 1]))
            {
                var definition = PassiveCatalog.Get(GameplayIds.Splash);
                splashTriggered = true;
                splashPercent = PassiveCatalog.LevelValue(
                    definition.SplashPercentByLevel,
                    splash.Level);
                splashRadius = splash.Level == 5
                    ? definition.Level5RadiusMm
                    : definition.RadiusMm;
                Emit(
                    state,
                    events,
                    GameplayIds.Splash,
                    owner.EntityId,
                    target.EntityId,
                    "splash",
                    splashPercent,
                    splashRadius);
            }

            var burnDamage = ResolveBurn(
                state,
                events,
                owner,
                target,
                forcedPassiveId);
            var poison = ResolvePoison(
                state,
                events,
                owner,
                target,
                forcedPassiveId);
            return new PassiveDamageEffects(
                splashTriggered,
                splashPercent,
                splashRadius,
                burnDamage,
                poison.DamagePerSecond,
                poison.Stacks);
        }

        private static int ResolveBurn(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Burn,
                    out var burn))
            {
                return 0;
            }

            var targetState = PassiveRuntimeSystem.GetOrCreateTargetState(
                state,
                owner.EntityId,
                target.EntityId);
            var definition = PassiveCatalog.Get(GameplayIds.Burn);
            var threshold = PassiveCatalog.LevelValue(
                definition.ThresholdByLevel,
                burn.Level);
            targetState.BurnStacks +=
                forcedPassiveId == GameplayIds.Burn ? 2 : 1;
            if (targetState.BurnStacks < threshold)
            {
                return 0;
            }

            targetState.BurnStacks = 0;
            var lostHp = Math.Max(
                0,
                TargetMaxHp(target) - TargetHp(target));
            var damage = lostHp *
                PassiveCatalog.LevelValue(
                    definition.LostHpDamagePercentByLevel,
                    burn.Level) /
                100;
            Emit(
                state,
                events,
                GameplayIds.Burn,
                owner.EntityId,
                target.EntityId,
                "burn-detonation",
                damage,
                0);
            if (burn.Level == 5)
            {
                SpreadBurn(
                    state,
                    events,
                    owner,
                    target,
                    threshold,
                    definition);
            }

            return damage;
        }

        private static void SpreadBurn(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            int threshold,
            PassiveDefinition definition)
        {
            foreach (var nearby in NearbyTargets(
                         state,
                         target.Position,
                         definition.SpreadRadiusMm))
            {
                if (nearby.EntityId == owner.EntityId ||
                    nearby.EntityId == target.EntityId)
                {
                    continue;
                }

                var nearbyState =
                    PassiveRuntimeSystem.GetOrCreateTargetState(
                        state,
                        owner.EntityId,
                        nearby.EntityId);
                nearbyState.BurnStacks = Math.Min(
                    threshold - 1,
                    nearbyState.BurnStacks +
                    definition.Level5SpreadStacks);
                Emit(
                    state,
                    events,
                    GameplayIds.Burn,
                    owner.EntityId,
                    nearby.EntityId,
                    "burn-spread",
                    nearbyState.BurnStacks,
                    0);
            }
        }

        private readonly struct PoisonResolution
        {
            public PoisonResolution(int damagePerSecond, int stacks)
            {
                DamagePerSecond = damagePerSecond;
                Stacks = stacks;
            }

            public int DamagePerSecond { get; }
            public int Stacks { get; }
        }

        private static PoisonResolution ResolvePoison(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.Poison,
                    out var poison))
            {
                return new PoisonResolution(0, 0);
            }

            var targetState = PassiveRuntimeSystem.GetOrCreateTargetState(
                state,
                owner.EntityId,
                target.EntityId);
            var definition = PassiveCatalog.Get(GameplayIds.Poison);
            var stacks = Math.Min(
                targetState.PoisonStacks +
                (forcedPassiveId == GameplayIds.Poison ? 2 : 1),
                PassiveCatalog.LevelValue(
                    definition.MaxStacksByLevel,
                    poison.Level));
            targetState.PoisonStacks = stacks;
            targetState.PoisonExpiresAtTick = checked(
                state.Tick +
                PassiveCatalog.LevelValue(
                    definition.DurationTicksByLevel,
                    poison.Level));
            targetState.PoisonNextTick =
                state.Tick + SimulationConstants.TicksPerSecond;
            var damage = PassiveCatalog.LevelValue(
                definition.DamagePerSecondByLevel,
                poison.Level);
            if (poison.Level == 5 &&
                stacks >= PassiveCatalog.LevelValue(
                    definition.MaxStacksByLevel,
                    poison.Level))
            {
                damage = damage *
                    definition.Level5FullStackMultiplierBasisPoints /
                    10_000;
            }

            Emit(
                state,
                events,
                GameplayIds.Poison,
                owner.EntityId,
                target.EntityId,
                "poison-stack",
                stacks,
                targetState.PoisonExpiresAtTick - state.Tick);
            return new PoisonResolution(damage, stacks);
        }
    }
}
