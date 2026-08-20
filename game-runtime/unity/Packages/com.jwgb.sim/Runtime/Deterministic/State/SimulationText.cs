using System;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static class SimulationText
    {
        public static string MatchStatus(MatchStatus value)
        {
            return value switch
            {
                Deterministic.MatchStatus.Waiting => "waiting",
                Deterministic.MatchStatus.Running => "running",
                Deterministic.MatchStatus.Finished => "finished",
                _ => throw new ArgumentOutOfRangeException(nameof(value))
            };
        }

        public static string LifeState(LifeState value)
        {
            return value switch
            {
                Deterministic.LifeState.Alive => "alive",
                Deterministic.LifeState.SoulFlight => "soul-flight",
                Deterministic.LifeState.ReviveProtection => "revive-protection",
                Deterministic.LifeState.Eliminated => "eliminated",
                _ => throw new ArgumentOutOfRangeException(nameof(value))
            };
        }

        public static string DamageForm(DamageForm value)
        {
            return value switch
            {
                Deterministic.DamageForm.Basic => "basic",
                Deterministic.DamageForm.Skill => "skill",
                Deterministic.DamageForm.Dot => "dot",
                Deterministic.DamageForm.Percent => "percent",
                Deterministic.DamageForm.Reflect => "reflect",
                Deterministic.DamageForm.True => "true",
                Deterministic.DamageForm.Storm => "storm",
                _ => throw new ArgumentOutOfRangeException(nameof(value))
            };
        }

        public static string DamageCause(DamageCause value)
        {
            return value switch
            {
                Deterministic.DamageCause.Basic => "basic",
                Deterministic.DamageCause.Active => "active",
                Deterministic.DamageCause.Passive => "passive",
                Deterministic.DamageCause.Monster => "monster",
                Deterministic.DamageCause.Storm => "storm",
                Deterministic.DamageCause.Debug => "debug",
                _ => throw new ArgumentOutOfRangeException(nameof(value))
            };
        }

        public static string Element(FiveElement value)
        {
            return value switch
            {
                FiveElement.Metal => "metal",
                FiveElement.Wood => "wood",
                FiveElement.Water => "water",
                FiveElement.Fire => "fire",
                FiveElement.Earth => "earth",
                _ => throw new ArgumentOutOfRangeException(nameof(value))
            };
        }

        public static string MonsterKind(MonsterKind value)
        {
            return value switch
            {
                Deterministic.MonsterKind.GroundMelee => "ground-melee",
                Deterministic.MonsterKind.GroundRanged => "ground-ranged",
                Deterministic.MonsterKind.Flying => "flying",
                Deterministic.MonsterKind.Pig => "pig",
                Deterministic.MonsterKind.EliteTank => "elite-tank",
                Deterministic.MonsterKind.EliteRanged => "elite-ranged",
                Deterministic.MonsterKind.DragonKing => "dragon-king",
                Deterministic.MonsterKind.CoreBoss => "core-boss",
                _ => throw new ArgumentOutOfRangeException(nameof(value))
            };
        }

        public static string MonsterRing(MonsterRing value)
        {
            return value switch
            {
                Deterministic.MonsterRing.Outer => "outer",
                Deterministic.MonsterRing.Middle => "middle",
                Deterministic.MonsterRing.Inner => "inner",
                Deterministic.MonsterRing.Den => "den",
                Deterministic.MonsterRing.Arena => "arena",
                Deterministic.MonsterRing.Court => "court",
                _ => throw new ArgumentOutOfRangeException(nameof(value))
            };
        }

        public static string SummonKind(SummonKind value)
        {
            return value switch
            {
                Deterministic.SummonKind.WolfSpirit => "wolf-spirit",
                Deterministic.SummonKind.FireSpirit => "fire-spirit",
                Deterministic.SummonKind.StoneStatue => "stone-statue",
                Deterministic.SummonKind.CoreMirror => "core-mirror",
                _ => throw new ArgumentOutOfRangeException(nameof(value))
            };
        }
    }
}
