namespace Jwgb.Content
{
    public sealed class PassiveDefinition
    {
        public string Id { get; set; }

        public string Name { get; set; }

        public PassiveEffect Effect { get; set; }

        public int[] ChancePercentByLevel { get; set; }

        public int[] SlowPercentByLevel { get; set; }

        public int[] MissPercentByLevel { get; set; }

        public int[] DurationTicksByLevel { get; set; }

        public int[] DistanceMmByLevel { get; set; }

        public int[] CriticalDamagePercentByLevel { get; set; }

        public int[] SplashPercentByLevel { get; set; }

        public int[] ThresholdByLevel { get; set; }

        public int[] LostHpDamagePercentByLevel { get; set; }

        public int[] DamagePerSecondByLevel { get; set; }

        public int[] MaxStacksByLevel { get; set; }

        public int[] ThresholdPercentByLevel { get; set; }

        public int[] DamageBonusPercentByLevel { get; set; }

        public int[] MaximumExtraHitsByLevel { get; set; }

        public int[] HpByLevel { get; set; }

        public int[] AttackByLevel { get; set; }

        public int[] MaximumCountByLevel { get; set; }

        public int[] ContactDamageByLevel { get; set; }

        public int[] DamageByLevel { get; set; }

        public int[] SpeedBonusPercentByLevel { get; set; }

        public int[] ReductionByLevel { get; set; }

        public int[] ShieldAmountByLevel { get; set; }

        public int[] AttackBonusPerMissingTenPercentByLevel { get; set; }

        public int[] HealMaxHpPercentByLevel { get; set; }

        public int[] HealPerSecondByLevel { get; set; }

        public int[] OutOfCombatTicksByLevel { get; set; }

        public int[] ReflectPercentByLevel { get; set; }

        public int[] DamagePercentByLevel { get; set; }

        public int[] AbsorptionPercentByLevel { get; set; }

        public int[] NextBasicBonusPercentByLevel { get; set; }

        public int[] RangeMmByLevel { get; set; }

        public int[] IntervalTicksByLevel { get; set; }

        public int[] GoldByLevel { get; set; }

        public int[] MonsterGoldByLevel { get; set; }

        public int[] ChestChancePercentByLevel { get; set; }

        public int[] ChestGoldByLevel { get; set; }

        public int[] ChestGoldBonusPercentByLevel { get; set; }

        public int[] GemChancePercentByLevel { get; set; }

        public int[] InterestPercentByLevel { get; set; }

        public int[] CapByLevel { get; set; }

        public int[] SaleBonusPercentByLevel { get; set; }

        public int[] MoveBonusBasisPointsByLevel { get; set; }

        public int[] MaximumStacksByLevel { get; set; }

        public int[] HealByLevel { get; set; }

        public int[] AoeDamageByLevel { get; set; }

        public int[] DamageReductionPercentByLevel { get; set; }

        public int[] HpPerKillByLevel { get; set; }

        public int[] MarkDurationTicksByLevel { get; set; }

        public int[] RewardGoldByLevel { get; set; }

        public int[] CooldownReductionTicksByLevel { get; set; }

        public int[] StormChanceReductionPercentByLevel { get; set; }

        public int[] StormSpeedBonusPercentByLevel { get; set; }

        public int[] RadiusMmByLevel { get; set; }

        public int DurationTicks { get; set; }

        public int Level5AoeSlowPercent { get; set; }

        public int Level5AoeRadiusMm { get; set; }

        public int Level5CooldownPenaltyTicks { get; set; }

        public int Level5AoeDistanceMm { get; set; }

        public bool Level5PreventsCritical { get; set; }

        public int InternalCooldownTicks { get; set; }

        public int Level5AoeDurationTicks { get; set; }

        public int Level5ShieldBypassPercent { get; set; }

        public int RadiusMm { get; set; }

        public int Level5RadiusMm { get; set; }

        public bool Level5HitsMainTarget { get; set; }

        public int Level5SpreadStacks { get; set; }

        public int SpreadRadiusMm { get; set; }

        public int Level5FullStackMultiplierBasisPoints { get; set; }

        public int Level5KillHealPercent { get; set; }

        public int Level5ForcedPassiveChancePercent { get; set; }

        public int ContactCooldownTicks { get; set; }

        public int BurnDamagePerSecond { get; set; }

        public int BurnDurationTicks { get; set; }

        public bool Level5CanCritical { get; set; }

        public bool Level5SlowImmune { get; set; }

        public int Level5BlockChancePercent { get; set; }

        public int Level5BreakAoeDamage { get; set; }

        public int Level5BreakAoeRadiusMm { get; set; }

        public int Level5LifestealPercent { get; set; }

        public int Level5BlinkDistanceMm { get; set; }

        public int Level5BuffTicks { get; set; }

        public int Level5DamageMultiplierBasisPoints { get; set; }

        public bool Level5ControlImmune { get; set; }

        public int Level5FirstHitBonusPercent { get; set; }

        public int Level5ReflectPercent { get; set; }

        public bool Level5GuaranteedCritical { get; set; }

        public int AttackSpeedDurationTicks { get; set; }

        public int AttackSpeedBonusPercent { get; set; }

        public int Level5DamageBonusPercent { get; set; }

        public int Level5RevealTicks { get; set; }

        public int Level5ExplosionDamage { get; set; }

        public int Level5ExplosionRadiusMm { get; set; }

        public int Level5HealPercent { get; set; }

        public int HeroKillGold { get; set; }

        public int GoldEquipmentChancePercent { get; set; }

        public int IntervalTicks { get; set; }

        public int RangeMm { get; set; }

        public int Level5CapMultiplier { get; set; }

        public int PickupGoldPercent { get; set; }

        public int Level5ExtraDamagePercent { get; set; }

        public int AoeRadiusMm { get; set; }

        public int Level5EffectMultiplierBasisPoints { get; set; }

        public int HealPercentPerSecond { get; set; }

        public int DestructionDamage { get; set; }

        public int DestructionRadiusMm { get; set; }

        public int MilestoneKills { get; set; }

        public int MilestoneHpBonus { get; set; }

        public bool Level5Reveal { get; set; }

        public int SpeedBonusPercent { get; set; }

        public int SpeedDurationTicks { get; set; }

        public int Level5BasicDamageBonusPercent { get; set; }

        public int Level5StormChanceMultiplierBasisPoints { get; set; }

        public int PostSuccessRetriggerLockTicks { get; set; }
    }
}
