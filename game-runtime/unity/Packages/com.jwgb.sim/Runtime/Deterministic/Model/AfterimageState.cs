using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal sealed class AfterimageState
    {
        public int EntityId;
        public int OwnerEntityId;
        public Int2Mm Position;
        public int SlowPercent;
        public int SlowDurationTicks;
        public int ExplosionDamage;
        public int ExplosionRadiusMm;
        public int ExpiresAtTick;
    }
}
