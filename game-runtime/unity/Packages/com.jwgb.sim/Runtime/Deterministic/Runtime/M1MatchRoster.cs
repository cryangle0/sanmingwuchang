using System;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    public static class M1MatchRoster
    {
        public static int[] AddCompetitors(
            GameSimulation simulation,
            int competitorCount,
            string playerIdPrefix,
            string firstHeroId = null)
        {
            if (simulation == null)
            {
                throw new ArgumentNullException(nameof(simulation));
            }

            if (competitorCount < 1 || competitorCount > 30)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(competitorCount));
            }

            if (string.IsNullOrWhiteSpace(playerIdPrefix))
            {
                throw new ArgumentException(
                    "Player id prefix must not be empty.",
                    nameof(playerIdPrefix));
            }
            if (firstHeroId != null)
            {
                HeroCatalog.Get(firstHeroId);
            }

            var result = new int[competitorCount];
            for (var index = 0; index < result.Length; index += 1)
            {
                result[index] = simulation.AddPlayer(
                    CreateOptions(
                        index,
                        playerIdPrefix,
                        firstHeroId));
            }

            return result;
        }

        private static AddPlayerOptions CreateOptions(
            int index,
            string playerIdPrefix,
            string firstHeroId)
        {
            var heroId = index == 0
                ? firstHeroId ?? GameplayIds.SunWukong
                : (index % 3) switch
                {
                    0 => GameplayIds.SunWukong,
                    1 => GameplayIds.IronFanPrincess,
                    _ => GameplayIds.BullDemonKing
                };
            var options = new AddPlayerOptions
            {
                PlayerId = $"{playerIdPrefix}-{index + 1:00}",
                HeroId = heroId
            };
            ApplyLoadout(options, index % 4);
            return options;
        }

        private static void ApplyLoadout(
            AddPlayerOptions options,
            int loadoutIndex)
        {
            switch (loadoutIndex)
            {
                case 0:
                    options.Passives = new[]
                    {
                        new PassiveLoadoutEntry(
                            GameplayIds.Critical,
                            5),
                        new PassiveLoadoutEntry(
                            GameplayIds.PassiveRevive,
                            1)
                    };
                    options.EquipmentIds = new[]
                    {
                        GameplayIds.RefinedIronStaff,
                        GameplayIds.GoldenCudgel
                    };
                    break;
                case 1:
                    options.Passives = new[]
                    {
                        new PassiveLoadoutEntry(
                            GameplayIds.ReactiveShield,
                            5)
                    };
                    options.EquipmentIds = new[]
                    {
                        GameplayIds.CoarseClothArmor
                    };
                    break;
                case 2:
                    options.Passives = new[]
                    {
                        new PassiveLoadoutEntry(
                            GameplayIds.FeignDeath,
                            5)
                    };
                    options.EquipmentIds = new[]
                    {
                        GameplayIds.NineTurnPill
                    };
                    break;
                default:
                    options.Passives = new[]
                    {
                        new PassiveLoadoutEntry(
                            GameplayIds.Critical,
                            3),
                        new PassiveLoadoutEntry(
                            GameplayIds.ReactiveShield,
                            3)
                    };
                    options.EquipmentIds = new[]
                    {
                        GameplayIds.RefinedIronStaff,
                        GameplayIds.CoarseClothArmor
                    };
                    break;
            }
        }
    }
}
