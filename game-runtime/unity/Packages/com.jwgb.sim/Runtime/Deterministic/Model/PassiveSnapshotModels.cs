namespace Jwgb.Sim.Deterministic
{
    public sealed class PassiveTargetSnapshot
    {
        public int SourceEntityId { get; set; }
        public int TargetEntityId { get; set; }
        public int BurnStacks { get; set; }
        public int PoisonStacks { get; set; }
        public int PoisonExpiresAtTick { get; set; }
        public int PoisonNextTick { get; set; }
        public int FireBurnDamagePerSecond { get; set; }
        public int FireBurnExpiresAtTick { get; set; }
        public int FireBurnNextTick { get; set; }
        public int? FireBurnSourceEntityId { get; set; }
        public int RevealExpiresAtTick { get; set; }
        public int PickpocketCooldownTicks { get; set; }
        public int StunCooldownTicks { get; set; }
        public int CounterCooldownTicks { get; set; }
        public int LastBasicHitTick { get; set; }
    }
}
