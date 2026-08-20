using System;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public static class BotIntentPlanner
    {
        public static PlayerIntent Create(
            WorldSnapshot snapshot,
            int entityId,
            int sequence)
        {
            if (snapshot == null)
            {
                throw new ArgumentNullException(nameof(snapshot));
            }

            var self = FindPlayer(snapshot, entityId);
            if (self == null || self.LifeState == LifeState.Eliminated)
            {
                return PlayerIntent.Neutral(sequence);
            }

            var target = FindNearestTarget(snapshot, self);
            if (target == null)
            {
                return PlayerIntent.Neutral(sequence);
            }

            var deltaX = target.Position.X - self.Position.X;
            var deltaZ = target.Position.Z - self.Position.Z;
            var aim = IntegerMath.NormalizeAxisPair(deltaX, deltaZ);
            var distanceSquared = IntegerMath.DistanceSquared(
                self.Position,
                target.Position);
            var movement = ResolveMovement(
                self,
                aim,
                distanceSquared);
            var attackRangeSquared =
                (long)self.AttackRangeMm * self.AttackRangeMm;
            return PlayerIntent.Create(
                sequence,
                movement.X,
                movement.Z,
                aim.X,
                aim.Z,
                distanceSquared <= attackRangeSquared,
                target.EntityId,
                ShouldCastActive(self, distanceSquared));
        }

        private static PlayerSnapshot FindPlayer(
            WorldSnapshot snapshot,
            int entityId)
        {
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                if (snapshot.Players[index].EntityId == entityId)
                {
                    return snapshot.Players[index];
                }
            }

            return null;
        }

        private static PlayerSnapshot FindNearestTarget(
            WorldSnapshot snapshot,
            PlayerSnapshot self)
        {
            PlayerSnapshot best = null;
            var bestDistance = long.MaxValue;
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                var candidate = snapshot.Players[index];
                if (candidate.EntityId == self.EntityId ||
                    candidate.LifeState != LifeState.Alive)
                {
                    continue;
                }

                var distance = IntegerMath.DistanceSquared(
                    self.Position,
                    candidate.Position);
                if (distance < bestDistance ||
                    (distance == bestDistance &&
                     (best == null ||
                      candidate.EntityId < best.EntityId)))
                {
                    best = candidate;
                    bestDistance = distance;
                }
            }

            return best;
        }

        private static Int2Mm ResolveMovement(
            PlayerSnapshot self,
            Int2Mm aim,
            long distanceSquared)
        {
            var desiredRange = Math.Max(
                1_000,
                self.AttackRangeMm - 700);
            if (distanceSquared >
                (long)desiredRange * desiredRange)
            {
                return aim;
            }

            if (self.HeroId == GameplayIds.IronFanPrincess &&
                distanceSquared < 7_000L * 7_000L)
            {
                return new Int2Mm(-aim.X, -aim.Z);
            }

            return new Int2Mm(0, 0);
        }

        private static bool ShouldCastActive(
            PlayerSnapshot self,
            long distanceSquared)
        {
            if (self.LifeState != LifeState.Alive ||
                self.ActiveCooldownTicks > 0)
            {
                return false;
            }

            var castRange = self.HeroId switch
            {
                GameplayIds.IronFanPrincess => 20_000,
                GameplayIds.BullDemonKing => 8_000,
                _ => 15_000
            };
            return distanceSquared <= (long)castRange * castRange;
        }
    }
}
