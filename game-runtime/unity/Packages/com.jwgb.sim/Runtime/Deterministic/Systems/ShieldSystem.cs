using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static class ShieldSystem
    {
        private static readonly DamageForm[] AllDamageForms =
        {
            DamageForm.Basic,
            DamageForm.Skill,
            DamageForm.Dot,
            DamageForm.Percent,
            DamageForm.Reflect,
            DamageForm.True,
            DamageForm.Storm
        };

        public static void Advance(SimulationState state)
        {
            foreach (var player in state.Players.Values)
            {
                for (var index = player.Shields.Count - 1; index >= 0; index -= 1)
                {
                    if (player.Shields[index].ExpiresAtTick <= state.Tick)
                    {
                        player.Shields.RemoveAt(index);
                    }
                }
            }
        }

        public static int GetTotal(PlayerState player)
        {
            var total = 0;
            for (var index = 0; index < player.Shields.Count; index += 1)
            {
                total += player.Shields[index].RemainingAmount;
            }

            return total;
        }

        public static ShieldState AddActive(
            SimulationState state,
            PlayerState player,
            string activeId,
            int amount,
            int durationTicks)
        {
            return Add(
                state,
                player,
                "active",
                activeId,
                amount,
                durationTicks,
                null);
        }

        public static ShieldState AddPassive(
            SimulationState state,
            PlayerState player,
            string passiveId,
            int amount,
            int durationTicks,
            ShieldBreakEffectState breakEffect)
        {
            for (var index = player.Shields.Count - 1;
                index >= 0;
                index -= 1)
            {
                var shield = player.Shields[index];
                if (shield.SourceKind == "passive" &&
                    shield.SourceId == passiveId)
                {
                    player.Shields.RemoveAt(index);
                }
            }

            return Add(
                state,
                player,
                "passive",
                passiveId,
                amount,
                durationTicks,
                breakEffect);
        }

        public static ShieldAbsorptionResult Absorb(
            PlayerState player,
            DamageForm form,
            int amount)
        {
            var result = new ShieldAbsorptionResult
            {
                RemainingDamage = amount
            };
            var ordered = new List<ShieldState>(player.Shields);
            ordered.Sort(
                (left, right) =>
                {
                    var expiry = left.ExpiresAtTick.CompareTo(
                        right.ExpiresAtTick);
                    return expiry != 0
                        ? expiry
                        : left.CreationSequence.CompareTo(
                            right.CreationSequence);
                });

            for (var index = 0; index < ordered.Count; index += 1)
            {
                var shield = ordered[index];
                if (result.RemainingDamage == 0 ||
                    !shield.Absorbs.Contains(form))
                {
                    continue;
                }

                var shieldDamage = System.Math.Min(
                    shield.RemainingAmount,
                    result.RemainingDamage);
                shield.RemainingAmount -= shieldDamage;
                result.RemainingDamage -= shieldDamage;
                result.Absorbed += shieldDamage;
                if (shield.RemainingAmount == 0)
                {
                    result.BrokenShields.Add(shield);
                }
            }

            player.Shields.RemoveAll(shield => shield.RemainingAmount == 0);
            return result;
        }

        private static ShieldState Add(
            SimulationState state,
            PlayerState player,
            string sourceKind,
            string sourceId,
            int amount,
            int durationTicks,
            ShieldBreakEffectState breakEffect)
        {
            var shield = new ShieldState
            {
                SourceKind = sourceKind,
                SourceId = sourceId,
                ExpiresAtTick = state.Tick + durationTicks,
                CreationSequence = state.NextShieldSequence,
                BreakEffect = breakEffect,
                RemainingAmount = amount
            };
            shield.Absorbs.AddRange(AllDamageForms);
            state.NextShieldSequence += 1;
            player.Shields.Add(shield);
            return shield;
        }
    }
}
