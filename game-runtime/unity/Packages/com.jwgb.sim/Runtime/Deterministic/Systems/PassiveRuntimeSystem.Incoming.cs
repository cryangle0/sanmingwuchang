using System;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveRuntimeSystem
    {
        public static IncomingDamageModifier ResolveIncomingDamageModifier(
            SimulationState state,
            PlayerState target,
            DamageRequest request)
        {
            if (request.Amount <= 0)
            {
                return new IncomingDamageModifier(0, false);
            }

            if (request.Form == DamageForm.Basic &&
                TryFind(
                    target,
                    GameplayIds.Dodge,
                    out var dodge) &&
                state.Random.Combat.NextInt(100) <
                PassiveCatalog.LevelValue(
                    PassiveCatalog.Get(GameplayIds.Dodge)
                        .ChancePercentByLevel,
                    dodge.Level))
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.Dodge);
                target.B15SpeedBoostTicks =
                    PassiveCatalog.LevelValue(
                        definition.DurationTicksByLevel,
                        dodge.Level);
                target.B15SpeedBonusPercent =
                    PassiveCatalog.LevelValue(
                        definition.SpeedBonusPercentByLevel,
                        dodge.Level);
                return new IncomingDamageModifier(0, true);
            }

            var amount = request.Amount;
            if (request.Form == DamageForm.Basic &&
                TryFind(
                    target,
                    GameplayIds.IronSkin,
                    out var ironSkin))
            {
                var definition = PassiveCatalog.Get(
                    GameplayIds.IronSkin);
                if (ironSkin.Level == 5 &&
                    state.Random.Combat.NextInt(100) <
                    definition.Level5BlockChancePercent)
                {
                    return new IncomingDamageModifier(0, true);
                }

                amount = Math.Max(
                    1,
                    amount - PassiveCatalog.LevelValue(
                        definition.ReductionByLevel,
                        ironSkin.Level));
            }

            if (target.HardControlTicks > 0 &&
                TryFind(
                    target,
                    GameplayIds.Adversity,
                    out var adversity))
            {
                var reduction = new[] { 15, 20, 25, 30, 35 }[
                    adversity.Level - 1];
                amount = amount * (100 - reduction) / 100;
            }

            return new IncomingDamageModifier(
                Math.Max(0, amount),
                false);
        }

        public static bool ApplyTargetHardControl(
            PlayerState target,
            int durationTicks)
        {
            if (LethalProtectionSystem.HasControlImmunity(target))
            {
                return false;
            }

            target.HardControlTicks = Math.Max(
                target.HardControlTicks,
                durationTicks);
            target.WhirlwindTicks = 0;
            target.WhirlwindNextPulseTick = 0;
            return true;
        }

        public static int BasicLifestealPercent(PlayerState player)
        {
            return TryFind(
                    player,
                    GameplayIds.Bloodlust,
                    out var loadout) &&
                loadout.Level == 5 &&
                player.Hp * 100 < player.MaxHp * 30
                ? 10
                : 0;
        }

        public static int ActiveAttackSpeedBonusPercent(
            PlayerState player)
        {
            return player.B25AttackSpeedBoostTicks > 0
                ? player.B25AttackSpeedBonusPercent
                : 0;
        }
    }
}
