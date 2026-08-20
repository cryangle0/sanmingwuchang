namespace Jwgb.Sim.Deterministic
{
    public enum LifeState : byte
    {
        Alive = 1,
        SoulFlight = 2,
        ReviveProtection = 3,
        Eliminated = 4
    }

    public enum MatchStatus : byte
    {
        Waiting = 1,
        Running = 2,
        Finished = 3
    }

    public enum DamageForm : byte
    {
        Basic = 1,
        Skill = 2,
        Dot = 3,
        Percent = 4,
        Reflect = 5,
        True = 6,
        Storm = 7
    }

    public enum DamageCause : byte
    {
        Basic = 1,
        Active = 2,
        Passive = 3,
        Storm = 4,
        Debug = 5,
        Monster = 6
    }

    public enum PvePopulation : byte
    {
        Demo = 1,
        Full = 2
    }

    public enum MonsterKind : byte
    {
        GroundMelee = 1,
        GroundRanged = 2,
        Flying = 3,
        Pig = 4,
        EliteTank = 5,
        EliteRanged = 6,
        DragonKing = 7,
        CoreBoss = 8
    }

    public enum MonsterRing : byte
    {
        Outer = 1,
        Middle = 2,
        Inner = 3,
        Den = 4,
        Arena = 5,
        Court = 6
    }

    public enum SummonKind : byte
    {
        WolfSpirit = 1,
        FireSpirit = 2,
        StoneStatue = 3,
        CoreMirror = 4
    }
}
