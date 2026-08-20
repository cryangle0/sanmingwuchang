namespace Jwgb.Sim.Deterministic
{
    internal sealed class PassiveTargetState
    {
        public int SourceEntityId;
        public int TargetEntityId;
        public int BurnStacks;
        public int PoisonStacks;
        public int PoisonExpiresAtTick;
        public int PoisonNextTick;
        public int FireBurnDamagePerSecond;
        public int FireBurnExpiresAtTick;
        public int FireBurnNextTick;
        public int? FireBurnSourceEntityId;
        public int EquipmentBurnDamagePerSecond;
        public int EquipmentBurnExpiresAtTick;
        public int EquipmentBurnNextTick;
        public int? EquipmentBurnSourceEntityId;
        public int RevealExpiresAtTick;
        public int PickpocketCooldownTicks;
        public int StunCooldownTicks;
        public int CounterCooldownTicks;
        public int LastBasicHitTick = -1;
        public int ComboShoesStacks;
        public int ComboShoesExpiresAtTick;
    }
}
