using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal sealed class ShieldBreakEffectState
    {
        public int SourceEntityId;
        public FiveElement SourceElement;
        public int Damage;
        public int RadiusMm;
    }

    internal sealed class ShieldState
    {
        public string SourceKind;
        public string SourceId;
        public int ExpiresAtTick;
        public int CreationSequence;
        public readonly List<DamageForm> Absorbs = new List<DamageForm>();
        public ShieldBreakEffectState BreakEffect;
        public int RemainingAmount;
    }
}
