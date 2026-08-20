using System;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public readonly struct PlayerIntent
    {
        private PlayerIntent(
            int sequence,
            Int2Mm movement,
            Int2Mm aim,
            bool attack,
            int? targetEntityId,
            bool castActive,
            bool interact)
        {
            Sequence = sequence;
            Movement = movement;
            Aim = aim;
            Attack = attack;
            TargetEntityId = targetEntityId;
            CastActive = castActive;
            Interact = interact;
        }

        public int Sequence { get; }

        public Int2Mm Movement { get; }

        public Int2Mm Aim { get; }

        public bool Attack { get; }

        public int? TargetEntityId { get; }

        public bool CastActive { get; }

        public bool Interact { get; }

        public static PlayerIntent Neutral(int sequence = 0)
        {
            return new PlayerIntent(
                sequence,
                new Int2Mm(0, 0),
                new Int2Mm(0, 0),
                false,
                null,
                false,
                false);
        }

        public static PlayerIntent Create(
            int sequence,
            int moveX,
            int moveZ,
            int aimX = 0,
            int aimZ = 0,
            bool attack = false,
            int? targetEntityId = null,
            bool castActive = false,
            bool interact = false)
        {
            ValidateAxis(moveX, nameof(moveX));
            ValidateAxis(moveZ, nameof(moveZ));
            ValidateAxis(aimX, nameof(aimX));
            ValidateAxis(aimZ, nameof(aimZ));
            if (targetEntityId.HasValue && targetEntityId.Value <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(targetEntityId));
            }

            return new PlayerIntent(
                sequence,
                IntegerMath.NormalizeAxisPair(moveX, moveZ),
                IntegerMath.NormalizeAxisPair(aimX, aimZ),
                attack,
                targetEntityId,
                castActive,
                interact);
        }

        private static void ValidateAxis(int value, string name)
        {
            if (value < -1_000 || value > 1_000)
            {
                throw new ArgumentOutOfRangeException(name);
            }
        }
    }
}
