using Unity.Collections;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    public enum MatchNetworkEventKind : byte
    {
        CriticalHit = 1,
        ActiveCast = 2,
        TrueDeath = 3,
        Eliminated = 4,
        LethalProtection = 5,
        ProjectileBlocked = 6,
        CoreBossCast = 7
    }

    public struct MatchEventRpc : IRpcCommand
    {
        public int MatchSequence;
        public int EventCursor;
        public int Tick;
        public byte Kind;
        public int EntityId;
        public bool HasSourceEntityId;
        public int SourceEntityId;
        public FixedString32Bytes ActiveAbilityId;
        public FixedString32Bytes Reason;
        public bool IsReplay;
    }
}
