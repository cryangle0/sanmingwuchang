namespace Jwgb.Sim.Deterministic
{
    internal readonly struct PassiveDamageEffects
    {
        public PassiveDamageEffects(
            bool splashTriggered,
            int splashPercent,
            int splashRadiusMm,
            int burnDetonationDamage,
            int poisonDamagePerSecond,
            int poisonStacks)
        {
            SplashTriggered = splashTriggered;
            SplashPercent = splashPercent;
            SplashRadiusMm = splashRadiusMm;
            BurnDetonationDamage = burnDetonationDamage;
            PoisonDamagePerSecond = poisonDamagePerSecond;
            PoisonStacks = poisonStacks;
        }

        public bool SplashTriggered { get; }
        public int SplashPercent { get; }
        public int SplashRadiusMm { get; }
        public int BurnDetonationDamage { get; }
        public int PoisonDamagePerSecond { get; }
        public int PoisonStacks { get; }
    }

    internal readonly struct PassiveChainEffects
    {
        public PassiveChainEffects(
            int comboExtraHits,
            int coldArrowDamage,
            bool thunderstormTriggered,
            int thunderstormDamage,
            int thunderstormRadiusMm)
        {
            ComboExtraHits = comboExtraHits;
            ColdArrowDamage = coldArrowDamage;
            ThunderstormTriggered = thunderstormTriggered;
            ThunderstormDamage = thunderstormDamage;
            ThunderstormRadiusMm = thunderstormRadiusMm;
        }

        public int ComboExtraHits { get; }
        public int ColdArrowDamage { get; }
        public bool ThunderstormTriggered { get; }
        public int ThunderstormDamage { get; }
        public int ThunderstormRadiusMm { get; }
    }
}
