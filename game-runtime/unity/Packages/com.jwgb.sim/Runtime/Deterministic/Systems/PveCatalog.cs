using System;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal readonly struct MonsterStats
    {
        public MonsterStats(
            int maxHp,
            int attackPower,
            int attacksPerSecondMilli,
            int moveSpeedMmPerSecond,
            int attackRangeMm,
            int collisionRadiusMm,
            int aggroRadiusMm,
            int leashRadiusMm)
        {
            MaxHp = maxHp;
            AttackPower = attackPower;
            AttacksPerSecondMilli = attacksPerSecondMilli;
            MoveSpeedMmPerSecond = moveSpeedMmPerSecond;
            AttackRangeMm = attackRangeMm;
            CollisionRadiusMm = collisionRadiusMm;
            AggroRadiusMm = aggroRadiusMm;
            LeashRadiusMm = leashRadiusMm;
        }

        public int MaxHp { get; }
        public int AttackPower { get; }
        public int AttacksPerSecondMilli { get; }
        public int MoveSpeedMmPerSecond { get; }
        public int AttackRangeMm { get; }
        public int CollisionRadiusMm { get; }
        public int AggroRadiusMm { get; }
        public int LeashRadiusMm { get; }
    }

    internal static class PveCatalog
    {
        private static readonly Int2Mm[] LegacyHomePoints =
        {
            new Int2Mm(-92_000, 52_000),
            new Int2Mm(-72_000, 78_000),
            new Int2Mm(-36_000, 96_000),
            new Int2Mm(0, 98_000),
            new Int2Mm(36_000, 96_000),
            new Int2Mm(72_000, 78_000),
            new Int2Mm(92_000, 52_000),
            new Int2Mm(98_000, 0),
            new Int2Mm(92_000, -52_000),
            new Int2Mm(72_000, -78_000),
            new Int2Mm(36_000, -96_000),
            new Int2Mm(0, -98_000),
            new Int2Mm(-36_000, -96_000),
            new Int2Mm(-72_000, -78_000),
            new Int2Mm(-92_000, -52_000),
            new Int2Mm(-98_000, 0),
            new Int2Mm(-55_000, 34_000),
            new Int2Mm(-18_000, 54_000),
            new Int2Mm(18_000, 54_000),
            new Int2Mm(55_000, 34_000),
            new Int2Mm(55_000, -34_000),
            new Int2Mm(18_000, -54_000),
            new Int2Mm(-18_000, -54_000),
            new Int2Mm(-55_000, -34_000)
        };

        public static readonly MonsterKind[] Kinds =
        {
            MonsterKind.GroundMelee,
            MonsterKind.GroundRanged,
            MonsterKind.Flying,
            MonsterKind.Pig,
            MonsterKind.EliteTank,
            MonsterKind.EliteRanged,
            MonsterKind.DragonKing,
            MonsterKind.CoreBoss
        };

        public static int Count(PvePopulation population, MonsterKind kind)
        {
            if (population == PvePopulation.Demo)
            {
                return kind switch
                {
                    MonsterKind.GroundMelee => 3,
                    MonsterKind.GroundRanged => 2,
                    MonsterKind.Flying => 1,
                    MonsterKind.Pig => 1,
                    MonsterKind.EliteTank => 1,
                    _ => 0
                };
            }

            return kind switch
            {
                MonsterKind.GroundMelee => 58,
                MonsterKind.GroundRanged => 38,
                MonsterKind.Flying => 12,
                MonsterKind.Pig => 8,
                MonsterKind.EliteTank => 2,
                MonsterKind.EliteRanged => 2,
                MonsterKind.DragonKing => 2,
                MonsterKind.CoreBoss => 1,
                _ => 0
            };
        }

        public static MonsterRing Ring(
            bool mapEnabled,
            MonsterKind kind,
            int index)
        {
            if (mapEnabled)
            {
                if (kind == MonsterKind.GroundMelee)
                {
                    return index < 30
                        ? MonsterRing.Outer
                        : index < 48 ? MonsterRing.Middle : MonsterRing.Inner;
                }

                if (kind == MonsterKind.GroundRanged)
                {
                    return index < 20
                        ? MonsterRing.Outer
                        : index < 32 ? MonsterRing.Middle : MonsterRing.Inner;
                }

                if (kind == MonsterKind.Flying)
                {
                    return index < 8
                        ? MonsterRing.Middle
                        : MonsterRing.Outer;
                }
            }

            return kind switch
            {
                MonsterKind.GroundMelee or MonsterKind.GroundRanged =>
                    (MonsterRing)(1 + (index % 3)),
                MonsterKind.Flying =>
                    index % 2 == 0 ? MonsterRing.Outer : MonsterRing.Middle,
                MonsterKind.Pig => MonsterRing.Den,
                MonsterKind.EliteTank or MonsterKind.EliteRanged =>
                    MonsterRing.Middle,
                MonsterKind.DragonKing => MonsterRing.Arena,
                MonsterKind.CoreBoss => MonsterRing.Court,
                _ => throw new ArgumentOutOfRangeException(nameof(kind))
            };
        }

        public static Int2Mm Home(
            SimulationState state,
            MonsterKind kind,
            int kindIndex,
            int placementIndex,
            MonsterRing ring)
        {
            return state.MapField == null
                ? LegacyHome(kind, placementIndex, ring)
                : PveMapPlacement.Home(state.RootSeed, kind, kindIndex);
        }

        public static MonsterStats Stats(
            MonsterKind kind,
            MonsterRing ring,
            int spawnTick)
        {
            var stats = BaseStats(kind);
            var elapsedMinutes = spawnTick /
                (60 * SimulationConstants.TicksPerSecond);
            // Ordinary monster health multiplier tiers: x1.05 / x1.10 / x1.15.
            var ordinaryNumerator = elapsedMinutes >= 15
                ? 115
                : elapsedMinutes >= 10 ? 110 : elapsedMinutes >= 5 ? 105 : 100;
            if (kind == MonsterKind.GroundMelee)
            {
                return new MonsterStats(
                    (ring == MonsterRing.Outer
                        ? 110
                        : ring == MonsterRing.Middle ? 300 : 600) *
                        ordinaryNumerator / 100,
                    ring == MonsterRing.Outer
                        ? 18
                        : ring == MonsterRing.Middle ? 35 : 60,
                    ring == MonsterRing.Inner ? 500 : 800,
                    stats.MoveSpeedMmPerSecond,
                    stats.AttackRangeMm,
                    stats.CollisionRadiusMm,
                    stats.AggroRadiusMm,
                    stats.LeashRadiusMm);
            }

            if (kind == MonsterKind.GroundRanged)
            {
                return new MonsterStats(
                    (ring == MonsterRing.Outer
                        ? 88
                        : ring == MonsterRing.Middle ? 240 : 480) *
                        ordinaryNumerator / 100,
                    ring == MonsterRing.Outer
                        ? 22
                        : ring == MonsterRing.Middle ? 42 : 72,
                    ring == MonsterRing.Inner ? 500 : 800,
                    stats.MoveSpeedMmPerSecond,
                    stats.AttackRangeMm,
                    stats.CollisionRadiusMm,
                    stats.AggroRadiusMm,
                    stats.LeashRadiusMm);
            }

            if (kind == MonsterKind.Flying)
            {
                return new MonsterStats(
                    (ring == MonsterRing.Outer
                        ? 80
                        : ring == MonsterRing.Middle ? 200 : 400) *
                        ordinaryNumerator / 100,
                    ring == MonsterRing.Outer
                        ? 15
                        : ring == MonsterRing.Middle ? 30 : 50,
                    stats.AttacksPerSecondMilli,
                    stats.MoveSpeedMmPerSecond,
                    stats.AttackRangeMm,
                    stats.CollisionRadiusMm,
                    stats.AggroRadiusMm,
                    stats.LeashRadiusMm);
            }

            if (kind == MonsterKind.EliteTank ||
                kind == MonsterKind.EliteRanged ||
                kind == MonsterKind.DragonKing ||
                kind == MonsterKind.CoreBoss)
            {
                var hpNumerator = elapsedMinutes >= 15
                    ? 120
                    : elapsedMinutes >= 10 ? 110 : 100;
                var isBoss = kind == MonsterKind.DragonKing ||
                    kind == MonsterKind.CoreBoss;
                var attackNumerator = isBoss && elapsedMinutes >= 15
                    ? 110
                    : isBoss && elapsedMinutes >= 10 ? 105 : 100;
                // attacksPerSecondMilli / cooldownMultiplier with
                // cooldownMultiplier in {1, 0.95, 0.9}.
                int attacksPerSecondMilli;
                if (kind == MonsterKind.CoreBoss)
                {
                    attacksPerSecondMilli = elapsedMinutes >= 10
                        ? stats.AttacksPerSecondMilli * 10 / 9
                        : stats.AttacksPerSecondMilli;
                }
                else
                {
                    attacksPerSecondMilli = elapsedMinutes >= 15
                        ? stats.AttacksPerSecondMilli * 10 / 9
                        : elapsedMinutes >= 10
                            ? stats.AttacksPerSecondMilli * 100 / 95
                            : stats.AttacksPerSecondMilli;
                }

                return new MonsterStats(
                    stats.MaxHp * hpNumerator / 100,
                    stats.AttackPower * attackNumerator / 100,
                    attacksPerSecondMilli,
                    stats.MoveSpeedMmPerSecond,
                    stats.AttackRangeMm,
                    stats.CollisionRadiusMm,
                    stats.AggroRadiusMm,
                    stats.LeashRadiusMm);
            }

            return stats;
        }

        private static MonsterStats BaseStats(MonsterKind kind)
        {
            return kind switch
            {
                MonsterKind.GroundMelee =>
                    new MonsterStats(300, 35, 800, 2_500, 1_500, 500, 10_000, 40_000),
                MonsterKind.GroundRanged =>
                    new MonsterStats(240, 42, 800, 2_500, 12_000, 500, 12_000, 40_000),
                MonsterKind.Flying =>
                    new MonsterStats(200, 30, 800, 3_000, 2_000, 400, 15_000, 45_000),
                MonsterKind.Pig =>
                    new MonsterStats(1_200, 80, 166, 2_600, 1_000, 800, 8_000, 25_000),
                MonsterKind.EliteTank =>
                    new MonsterStats(7_000, 120, 600, 2_200, 2_000, 1_200, 25_000, 40_000),
                MonsterKind.EliteRanged =>
                    new MonsterStats(4_000, 220, 1_000, 2_400, 8_000, 1_200, 25_000, 40_000),
                MonsterKind.DragonKing =>
                    new MonsterStats(10_000, 200, 1_000, 2_800, 4_000, 1_500, 30_000, 120_000),
                MonsterKind.CoreBoss =>
                    new MonsterStats(22_000, 300, 1_000, 2_000, 5_000, 2_000, 120_000, 120_000),
                _ => throw new ArgumentOutOfRangeException(nameof(kind))
            };
        }

        private static Int2Mm LegacyHome(
            MonsterKind kind,
            int index,
            MonsterRing ring)
        {
            if (kind == MonsterKind.CoreBoss)
            {
                return new Int2Mm(0, 0);
            }

            if (kind == MonsterKind.DragonKing)
            {
                var dragonPoint = LegacyHomePoints[index % 8];
                return new Int2Mm(dragonPoint.X / 2, dragonPoint.Z / 2);
            }

            var point = LegacyHomePoints[index % LegacyHomePoints.Length];

            var offset = ring == MonsterRing.Inner
                ? 8_000
                : ring == MonsterRing.Middle ? 18_000 : 0;
            var sign = index % 2 == 0 ? 1 : -1;
            return new Int2Mm(
                point.X - (sign * offset),
                point.Z + (sign * offset));
        }

    }
}
