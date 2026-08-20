namespace Jwgb.Content
{
    public enum FiveElement : byte
    {
        Metal = 1,
        Wood = 2,
        Water = 3,
        Fire = 4,
        Earth = 5
    }

    public enum BasicAttackKind : byte
    {
        Melee = 1,
        RangedProjectile = 2
    }

    public enum HeroArchetype : byte
    {
        Repeater = 1,
        Assassin = 2,
        Fighter = 3
    }

    public enum MovementClass : byte
    {
        Ground = 1,
        Flying = 2
    }

    public enum ActiveEffect : byte
    {
        WindWall = 1,
        SelfCombatBuff = 2,
        MobileChannelAreaDamage = 3,
        SelfShield = 4,
        CapsuleSweepBlink = 5,
        SelfLockInvulnerability = 6,
        TargetDamageControl = 7,
        AreaDamage = 8,
        TargetRandomDamage = 9,
        GoldGrant = 10,
        Scripted = 11,
        DefinitionOnly = 12
    }

    public enum PassiveEffect : byte
    {
        BasicCritical = 1,
        IncomingBasicShield = 2,
        LethalProc = 3,
        OncePerMatchRevive = 4,
        BasicSlow = 5,
        BasicSilence = 6,
        CriticalKnockback = 7,
        BasicBlind = 8,
        BasicStun = 9,
        BasicSplash = 10,
        BasicBurnStack = 11,
        BasicPoisonStack = 12,
        LowHpExecute = 13,
        BasicCombo = 14,
        SummonWolf = 15,
        SummonFireSpirit = 16,
        ColdArrow = 17,
        BasicDodge = 18,
        BasicReduction = 19,
        LowHpOffense = 20,
        OutOfCombatRecovery = 21,
        BasicReflect = 22,
        BasicCounter = 23,
        SkillAbsorption = 24,
        CriticalRage = 25,
        Backstab = 26,
        HitSpeedBoost = 27,
        LowHpHunt = 28,
        Ambush = 29,
        Afterimage = 30,
        Pickpocket = 31,
        MonsterKillGold = 32,
        TreasureHunter = 33,
        Interest = 34,
        SaleBonus = 35,
        Momentum = 36,
        SummonResonance = 37,
        ControlledRecovery = 38,
        OutOfCombatStatue = 39,
        KillGrowth = 40,
        BountyMark = 41,
        BountyHunter = 42,
        StormWard = 43,
        Thunderstorm = 44,
        DefinitionOnly = 45
    }

    public enum EquipmentEffect : byte
    {
        None = 0,
        LethalProtectionConsumable = 1,
        BasicAttackRangeFlat = 2,
        RuleModifier = 3
    }
}
