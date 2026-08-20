using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public readonly struct PlayerRuntimeSnapshot
    {
        public PlayerRuntimeSnapshot(
            int entityId,
            int hardControlTicks,
            Int2Mm? respawnTarget,
            int reviveProtectionTicks,
            int moveRemainderX,
            int moveRemainderZ)
        {
            EntityId = entityId;
            HardControlTicks = hardControlTicks;
            RespawnTarget = respawnTarget;
            ReviveProtectionTicks = reviveProtectionTicks;
            MoveRemainderX = moveRemainderX;
            MoveRemainderZ = moveRemainderZ;
        }

        public int EntityId { get; }

        public int HardControlTicks { get; }

        public Int2Mm? RespawnTarget { get; }

        public int ReviveProtectionTicks { get; }

        public int MoveRemainderX { get; }

        public int MoveRemainderZ { get; }
    }
}
