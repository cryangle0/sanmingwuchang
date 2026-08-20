using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal readonly struct BasicHitPassiveEffects
    {
        public BasicHitPassiveEffects(
            bool splashTriggered,
            int splashPercent,
            int splashRadiusMm,
            int burnDetonationDamage,
            int poisonDamagePerSecond,
            int poisonStacks,
            int comboExtraHits,
            int coldArrowDamage,
            bool thunderstormTriggered,
            int thunderstormDamage,
            int thunderstormRadiusMm)
        {
            SplashTriggered = splashTriggered;
            SplashPercent = splashPercent;
            SplashRadiusMm = splashRadiusMm;
            BurnDetonationDamage = burnDetonationDamage;
            PoisonDamagePerSecond = poisonDamagePerSecond;
            PoisonStacks = poisonStacks;
            ComboExtraHits = comboExtraHits;
            ColdArrowDamage = coldArrowDamage;
            ThunderstormTriggered = thunderstormTriggered;
            ThunderstormDamage = thunderstormDamage;
            ThunderstormRadiusMm = thunderstormRadiusMm;
        }

        public bool SplashTriggered { get; }
        public int SplashPercent { get; }
        public int SplashRadiusMm { get; }
        public int BurnDetonationDamage { get; }
        public int PoisonDamagePerSecond { get; }
        public int PoisonStacks { get; }
        public int ComboExtraHits { get; }
        public int ColdArrowDamage { get; }
        public bool ThunderstormTriggered { get; }
        public int ThunderstormDamage { get; }
        public int ThunderstormRadiusMm { get; }
    }

    internal static partial class PassiveHitSystem
    {
        public static BasicHitPassiveEffects ResolveEffects(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            string forcedPassiveId,
            bool allowCombo)
        {
            var damage = ResolveDamageEffects(
                state,
                events,
                owner,
                target,
                forcedPassiveId);
            var chains = ResolveChainEffects(
                state,
                events,
                owner,
                target,
                forcedPassiveId,
                allowCombo);
            return new BasicHitPassiveEffects(
                damage.SplashTriggered,
                damage.SplashPercent,
                damage.SplashRadiusMm,
                damage.BurnDetonationDamage,
                damage.PoisonDamagePerSecond,
                damage.PoisonStacks,
                chains.ComboExtraHits,
                chains.ColdArrowDamage,
                chains.ThunderstormTriggered,
                chains.ThunderstormDamage,
                chains.ThunderstormRadiusMm);
        }

        public static void ResolveIncoming(
            SimulationState state,
            List<SimEvent> events,
            PlayerState target,
            int sourceEntityId,
            bool wasCritical)
        {
            if (wasCritical &&
                PassiveRuntimeSystem.TryFind(
                    target,
                    GameplayIds.Rage,
                    out var rage))
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.Rage);
                target.B25NextBasicBonusPercent =
                    PassiveCatalog.LevelValue(
                        definition.NextBasicBonusPercentByLevel,
                        rage.Level);
                target.B25AttackSpeedBoostTicks =
                    definition.AttackSpeedDurationTicks;
                target.B25AttackSpeedBonusPercent =
                    rage.Level == 5
                        ? definition.AttackSpeedBonusPercent
                        : 0;
                Emit(
                    state,
                    events,
                    GameplayIds.Rage,
                    target.EntityId,
                    sourceEntityId,
                    "rage",
                    target.B25NextBasicBonusPercent,
                    target.B25AttackSpeedBoostTicks);
            }

            if (PassiveRuntimeSystem.TryFind(
                    target,
                    GameplayIds.Sprint,
                    out var sprint) &&
                ShouldProc(
                    state,
                    false,
                    new[] { 10, 13, 16, 20, 25 }[
                        sprint.Level - 1]))
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.Sprint);
                target.B27SpeedBoostTicks =
                    PassiveCatalog.LevelValue(
                        definition.DurationTicksByLevel,
                        sprint.Level);
                target.B27SpeedBonusPercent =
                    PassiveCatalog.LevelValue(
                        definition.SpeedBonusPercentByLevel,
                        sprint.Level);
                if (sprint.Level == 5)
                {
                    target.SlowTicks = 0;
                    target.SlowBasisPoints = 10_000;
                }

                Emit(
                    state,
                    events,
                    GameplayIds.Sprint,
                    target.EntityId,
                    sourceEntityId,
                    "sprint",
                    target.B27SpeedBonusPercent,
                    target.B27SpeedBoostTicks);
            }
        }

        private static int TargetHp(CombatTarget target)
        {
            return target.IsPlayer
                ? target.Player.Hp
                : target.Monster.Hp;
        }

        private static int TargetMaxHp(CombatTarget target)
        {
            return target.IsPlayer
                ? target.Player.MaxHp
                : target.Monster.MaxHp;
        }
    }
}
