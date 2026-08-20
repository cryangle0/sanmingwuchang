namespace Jwgb.Sim.Deterministic
{
    internal sealed class BountyMarkState
    {
        public int SourceEntityId;
        public int TargetEntityId;
        public int RewardGold;
        public bool RevealToAll;
        public int ExpiresAtTick;
    }
}
