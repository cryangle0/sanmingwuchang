using System;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of the currency helpers from
    /// packages/sim/src/systems/equipment-economy.ts.
    /// </summary>
    internal static class EquipmentEconomySystem
    {
        private const string TreasureBasin = "G5";

        private static readonly int[] XpCumulative =
        {
            0, 50, 120, 210, 320, 450, 605, 785,
            995, 1_235, 1_510, 1_825, 2_275, 2_825, 3_525
        };

        public static int GrantGeneratedGold(
            PlayerState player,
            int baseAmount)
        {
            var amount = Math.Max(0, baseAmount);
            if (HasTreasureBasin(player))
            {
                amount = amount + (amount / 2);
            }

            amount = Math.Max(0, amount);
            player.Gold = checked(player.Gold + amount);
            return amount;
        }

        public static int GrantExperience(PlayerState player, int amount)
        {
            var granted = Math.Max(0, amount);
            var previousLevel = player.Level;
            player.Experience = checked(player.Experience + granted);
            while (player.Level < 15 &&
                player.Experience >=
                CumulativeExperienceForLevel(player.Level + 1))
            {
                player.Level += 1;
            }

            if (player.Level != previousLevel)
            {
                EquipmentInventorySystem.RebuildEquipmentStats(player);
            }

            return granted;
        }

        private static bool HasTreasureBasin(PlayerState player)
        {
            for (var index = 0; index < player.Equipment.Count; index += 1)
            {
                if (player.Equipment[index].EquipmentId == TreasureBasin)
                {
                    return true;
                }
            }

            return false;
        }

        private static int CumulativeExperienceForLevel(int level)
        {
            var bounded = Math.Max(1, Math.Min(15, level));
            return XpCumulative[bounded];
        }
    }
}
