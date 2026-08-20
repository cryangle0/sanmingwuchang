namespace Jwgb.Content
{
    public readonly struct HeroStats
    {
        public HeroStats(
            int attack,
            int maxHp,
            int moveSpeedMmPerSecond,
            int attackRangeMm,
            int attacksPerSecondMilli)
        {
            Attack = attack;
            MaxHp = maxHp;
            MoveSpeedMmPerSecond = moveSpeedMmPerSecond;
            AttackRangeMm = attackRangeMm;
            AttacksPerSecondMilli = attacksPerSecondMilli;
        }

        public int Attack { get; }

        public int MaxHp { get; }

        public int MoveSpeedMmPerSecond { get; }

        public int AttackRangeMm { get; }

        public int AttacksPerSecondMilli { get; }
    }

    public sealed class BasicProjectileDefinition
    {
        public int SpeedMmPerSecond { get; set; }

        public int CollisionRadiusMm { get; set; }

        public int MaxTravelDistanceMm { get; set; }
    }

    public sealed class HeroDefinition
    {
        public string Id { get; set; }

        public string Name { get; set; }

        public HeroArchetype Archetype { get; set; }

        public BasicAttackKind BasicAttackKind { get; set; }

        public BasicProjectileDefinition BasicProjectile { get; set; }

        public MovementClass MovementClass { get; set; }

        public FiveElement Element { get; set; }

        public HeroStats Level1 { get; set; }

        public HeroStats Level15 { get; set; }

        public ActiveDefinition Active { get; set; }
    }
}
