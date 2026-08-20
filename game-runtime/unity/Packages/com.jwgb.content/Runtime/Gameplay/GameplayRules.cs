using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Content
{
    public static class GameplayRules
    {
        private static readonly Int2Mm[] SpawnPointValues =
        {
            new Int2Mm(90_000, 0),
            new Int2Mm(88_033, 18_712),
            new Int2Mm(82_219, 36_606),
            new Int2Mm(72_812, 52_901),
            new Int2Mm(60_222, 66_883),
            new Int2Mm(45_000, 77_942),
            new Int2Mm(27_812, 85_595),
            new Int2Mm(9_408, 89_507),
            new Int2Mm(-9_408, 89_507),
            new Int2Mm(-27_812, 85_595),
            new Int2Mm(-45_000, 77_942),
            new Int2Mm(-60_222, 66_883),
            new Int2Mm(-72_812, 52_901),
            new Int2Mm(-82_219, 36_606),
            new Int2Mm(-88_033, 18_712),
            new Int2Mm(-90_000, 0),
            new Int2Mm(-88_033, -18_712),
            new Int2Mm(-82_219, -36_606),
            new Int2Mm(-72_812, -52_901),
            new Int2Mm(-60_222, -66_883),
            new Int2Mm(-45_000, -77_942),
            new Int2Mm(-27_812, -85_595),
            new Int2Mm(-9_408, -89_507),
            new Int2Mm(9_408, -89_507),
            new Int2Mm(27_812, -85_595),
            new Int2Mm(45_000, -77_942),
            new Int2Mm(60_222, -66_883),
            new Int2Mm(72_812, -52_901),
            new Int2Mm(82_219, -36_606),
            new Int2Mm(88_033, -18_712)
        };

        public const int PlayerLives = 3;
        public const int PlayerCapsuleRadiusMm = 450;
        public const int ArenaRadiusMm = 120_000;
        public const int SoulSpeedMmPerSecond = 18_000;
        public const int ReviveProtectionTicks = 3 * SimulationConstants.TicksPerSecond;
        public const int ApocalypseStartTick = 1_200 * SimulationConstants.TicksPerSecond;
        public const int ApocalypseFirstDamageTick = 1_201 * SimulationConstants.TicksPerSecond;
        public const int ApocalypseDamageIntervalTicks = SimulationConstants.TicksPerSecond;
        public const int StormCourtAnnouncementTick =
            12 * 60 * SimulationConstants.TicksPerSecond;
        public const int StormCenterMoveStartTick =
            13 * 60 * SimulationConstants.TicksPerSecond;
        public const int StormCenterArrivalTick =
            (17 * 60 + 30) * SimulationConstants.TicksPerSecond;
        public const int StormWarningTick =
            (19 * 60 + 55) * SimulationConstants.TicksPerSecond;
        public const int MatchVoidAbortTicks =
            30 * 60 * SimulationConstants.TicksPerSecond;
        public const int VoidAbortCultivationCompensation = 20;

        public static IReadOnlyList<Int2Mm> SpawnPoints => SpawnPointValues;

        public static int ElementDamageBasisPoints(
            FiveElement attacker,
            FiveElement defender)
        {
            FiveElement? countered = attacker switch
            {
                FiveElement.Metal => FiveElement.Wood,
                FiveElement.Wood => FiveElement.Earth,
                FiveElement.Earth => FiveElement.Water,
                FiveElement.Water => FiveElement.Fire,
                FiveElement.Fire => FiveElement.Metal,
                _ => null
            };
            return countered == defender ? 15_000 : 10_000;
        }
    }
}
