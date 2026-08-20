using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal sealed class SummonState
    {
        public int EntityId;
        public int OwnerEntityId;
        public SummonKind Kind;
        public Int2Mm Position;
        public int Hp;
        public int MaxHp;
        public int AttackPower;
        public bool Targetable;
        public int ExpiresAtTick;
        public int AttackCooldownTicks;
        public int TouchCooldownTicks;
        public bool DestroyedByHostileDamage;
    }
}
