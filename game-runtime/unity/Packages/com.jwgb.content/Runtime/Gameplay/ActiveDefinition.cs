namespace Jwgb.Content
{
    public sealed class ActiveDefinition
    {
        public string Id { get; set; }

        public string Name { get; set; }

        public int CooldownTicks { get; set; }

        public ActiveEffect Effect { get; set; }

        public int DurationTicks { get; set; }

        public int RangeMm { get; set; }

        public int LengthMm { get; set; }

        public int KnockbackMm { get; set; }

        public int AttackSpeedPercent { get; set; }

        public int IncomingDamageBasisPoints { get; set; } = 10_000;

        public int PassiveEffectMagnitudeBasisPoints { get; set; } = 10_000;

        public int PulseIntervalTicks { get; set; }

        public int RadiusMm { get; set; }

        public int FixedDamage { get; set; }

        public int AttackCoefficientBasisPoints { get; set; }

        public int SelfMoveMultiplierBasisPoints { get; set; } = 10_000;

        public int ShieldAmount { get; set; }

        public int DistanceMm { get; set; }

        public int MaxContinuousSolidChordMm { get; set; }

        public int PostCastLockTicks { get; set; }

        public int HardControlTicks { get; set; }

        public int MinimumDamage { get; set; }

        public int MaximumDamage { get; set; }

        public int GoldAmount { get; set; }

        public string Script { get; set; }

        public int SlowPercent { get; set; }

        public int SlowDurationTicks { get; set; }

        public int RootTicks { get; set; }

        public int DelayTicks { get; set; }

        public int BurnDamagePerSecond { get; set; }

        public int BurnDurationTicks { get; set; }

        public int MaximumTargets { get; set; }

        public int DamageDecayBasisPoints { get; set; } = 10_000;

        public int DisplacementMm { get; set; }

        public int MissingHpDamagePercent { get; set; }

        public int MaximumStacks { get; set; }

        public int PercentDamage { get; set; }

        public int SummonCount { get; set; }

        public int SummonHp { get; set; }

        public int SummonAttack { get; set; }

        public int SummonAttributeBasisPoints { get; set; }

        public int SpeedBonusPercent { get; set; }

        public int LifestealPercent { get; set; }

        public int DamageReductionBasisPoints { get; set; }

        public int HealAmount { get; set; }

        public int GoldPercent { get; set; }

        public int MinimumGoldAmount { get; set; }

        public int RewardGold { get; set; }

        public int RevealTicks { get; set; }

        public int WallHp { get; set; }

        public int ProjectileSpeedMmPerSecond { get; set; }

        public int CollisionRadiusMm { get; set; }

        public int TargetDamageBonusPercent { get; set; }

        public int DamagePercent { get; set; }

        public int DamagePerDistanceBasisPoints { get; set; }

        public int MaximumDistanceBonusPercent { get; set; }

        public int ExecuteThresholdPercent { get; set; }

        public int StealGoldPercent { get; set; }

        public int StealFlatGold { get; set; }

        public int LootGoldMultiplier { get; set; }

        public int MaximumGoldAmount { get; set; }

        public int MinimumLootAgeTicks { get; set; }

        public int DetonationDamage { get; set; }

        public int DetonationAttackCoefficientBasisPoints { get; set; }

        public int TriggerHardControlTicks { get; set; }

        public int TriggerRevealTicks { get; set; }

        public int TriggerRadiusMm { get; set; }

        public int MaximumInstances { get; set; }

        public string BlocksProjectileTag { get; set; }

        public bool CanMove { get; set; } = true;

        public bool CanBasic { get; set; } = true;

        public bool CanCast { get; set; } = true;
    }
}
