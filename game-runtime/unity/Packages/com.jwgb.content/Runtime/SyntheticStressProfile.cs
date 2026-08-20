using System;

namespace Jwgb.Content
{
    public readonly struct SyntheticStressProfile
    {
        public SyntheticStressProfile(
            int playerCount,
            int monsterCount,
            int summonCount,
            int arenaRadiusMm)
        {
            if (playerCount < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(playerCount));
            }

            if (monsterCount < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(monsterCount));
            }

            if (summonCount < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(summonCount));
            }

            if (arenaRadiusMm <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(arenaRadiusMm));
            }

            PlayerCount = playerCount;
            MonsterCount = monsterCount;
            SummonCount = summonCount;
            ArenaRadiusMm = arenaRadiusMm;
        }

        public int PlayerCount { get; }

        public int MonsterCount { get; }

        public int SummonCount { get; }

        public int ArenaRadiusMm { get; }

        public int TotalAgentCount => checked(PlayerCount + MonsterCount + SummonCount);

        public static SyntheticStressProfile Baseline =>
            new SyntheticStressProfile(
                playerCount: 30,
                monsterCount: 123,
                summonCount: 270,
                arenaRadiusMm: 120_000);
    }
}
