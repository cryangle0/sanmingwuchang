using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public sealed class SummonSnapshot
    {
        public int EntityId { get; set; }
        public int OwnerEntityId { get; set; }
        public string Kind { get; set; }
        public Int2Mm Position { get; set; }
        public int Hp { get; set; }
        public int MaxHp { get; set; }
        public int AttackPower { get; set; }
        public bool Targetable { get; set; }
        public int ExpiresAtTick { get; set; }
        public int AttackCooldownTicks { get; set; }
        public int TouchCooldownTicks { get; set; }
        public bool DestroyedByHostileDamage { get; set; }
    }

    public sealed class AfterimageSnapshot
    {
        public int EntityId { get; set; }
        public int OwnerEntityId { get; set; }
        public Int2Mm Position { get; set; }
        public int SlowPercent { get; set; }
        public int SlowDurationTicks { get; set; }
        public int ExplosionDamage { get; set; }
        public int ExplosionRadiusMm { get; set; }
        public int ExpiresAtTick { get; set; }
    }

    public sealed class BountyMarkSnapshot
    {
        public int SourceEntityId { get; set; }
        public int TargetEntityId { get; set; }
        public int RewardGold { get; set; }
        public bool RevealToAll { get; set; }
        public int ExpiresAtTick { get; set; }
    }
}
