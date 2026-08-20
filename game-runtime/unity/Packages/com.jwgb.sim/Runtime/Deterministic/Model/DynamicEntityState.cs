using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal sealed class WindWallState
    {
        public int EntityId;
        public int OwnerEntityId;
        public Int2Mm Center;
        public Int2Mm Direction;
        public int LengthMm;
        public int RemainingTicks;
    }

    internal sealed class ProjectileState
    {
        public int EntityId;
        public string Kind = "basic";
        public int OwnerEntityId;
        public int TargetEntityId;
        public Int2Mm Position;
        public int SpeedMmPerSecond;
        public int CollisionRadiusMm;
        public FiveElement SourceElement;
        public int BaseDamage;
        public int OutgoingDamageBasisPoints;
        public int CreatedAtTick;
        public int RemainingTravelMm;
        public int MovementRemainder;
    }
}
