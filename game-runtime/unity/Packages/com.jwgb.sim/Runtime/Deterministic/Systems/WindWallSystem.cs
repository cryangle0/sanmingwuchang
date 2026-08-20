using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal readonly struct WindWallSweepHit
    {
        public WindWallSweepHit(
            WindWallState wall,
            long fractionNumerator,
            long fractionDenominator)
        {
            Wall = wall;
            FractionNumerator = fractionNumerator;
            FractionDenominator = fractionDenominator;
        }

        public WindWallState Wall { get; }
        public long FractionNumerator { get; }
        public long FractionDenominator { get; }
    }

    internal static class WindWallSystem
    {
        private const int DirectionScale = 1_000;

        public static WindWallState Create(
            SimulationState state,
            PlayerState owner,
            ActiveDefinition definition)
        {
            var direction = CastDirection(owner);
            var center = IntegerMath.ClampToCircle(
                Offset(owner.Position, direction, definition.RangeMm),
                state.ArenaRadiusMm);
            var wall = new WindWallState
            {
                EntityId = state.NextEntityId,
                OwnerEntityId = owner.EntityId,
                Center = center,
                Direction = direction,
                LengthMm = definition.LengthMm,
                RemainingTicks = definition.DurationTicks
            };
            state.NextEntityId += 1;
            state.WindWalls.Add(wall.EntityId, wall);

            foreach (var candidate in state.Players.Values)
            {
                if (candidate.EntityId == owner.EntityId ||
                    candidate.LifeState != LifeState.Alive ||
                    !TouchesWall(candidate, wall))
                {
                    continue;
                }

                candidate.Position = IntegerMath.ClampToCircle(
                    Offset(
                        candidate.Position,
                        direction,
                        definition.KnockbackMm),
                    state.ArenaRadiusMm);
            }

            return wall;
        }

        public static void Advance(SimulationState state)
        {
            var expired = new List<int>();
            foreach (var pair in state.WindWalls)
            {
                pair.Value.RemainingTicks -= 1;
                if (pair.Value.RemainingTicks <= 0)
                {
                    expired.Add(pair.Key);
                }
            }

            for (var index = 0; index < expired.Count; index += 1)
            {
                state.WindWalls.Remove(expired[index]);
            }
        }

        public static void RemoveOwned(SimulationState state, int ownerEntityId)
        {
            var owned = new List<int>();
            foreach (var pair in state.WindWalls)
            {
                if (pair.Value.OwnerEntityId == ownerEntityId)
                {
                    owned.Add(pair.Key);
                }
            }

            for (var index = 0; index < owned.Count; index += 1)
            {
                state.WindWalls.Remove(owned[index]);
            }
        }

        public static WindWallSweepHit? FindFirstBlocking(
            SimulationState state,
            Int2Mm start,
            Int2Mm end,
            int projectileRadiusMm)
        {
            WindWallSweepHit? best = null;
            foreach (var wall in state.WindWalls.Values)
            {
                if (!TrySweepHit(
                    wall,
                    start,
                    end,
                    projectileRadiusMm,
                    out var hit))
                {
                    continue;
                }

                if (!best.HasValue || Compare(hit, best.Value) < 0)
                {
                    best = hit;
                }
            }

            return best;
        }

        private static bool TrySweepHit(
            WindWallState wall,
            Int2Mm start,
            Int2Mm end,
            int projectileRadiusMm,
            out WindWallSweepHit hit)
        {
            ScaledProjections(start, wall, out var startNormal, out var startTangent);
            ScaledProjections(end, wall, out var endNormal, out var endTangent);
            var normalLimit = (long)projectileRadiusMm * DirectionScale;
            long numerator;
            long denominator;
            if (Math.Abs(startNormal) <= normalLimit)
            {
                numerator = 0;
                denominator = 1;
            }
            else if (startNormal > normalLimit)
            {
                if (endNormal > normalLimit)
                {
                    hit = default;
                    return false;
                }

                numerator = startNormal - normalLimit;
                denominator = startNormal - endNormal;
            }
            else
            {
                if (endNormal < -normalLimit)
                {
                    hit = default;
                    return false;
                }

                numerator = startNormal + normalLimit;
                denominator = startNormal - endNormal;
            }

            if (denominator < 0)
            {
                numerator *= -1;
                denominator *= -1;
            }

            if (numerator < 0 ||
                numerator > denominator ||
                denominator <= 0)
            {
                hit = default;
                return false;
            }

            var tangentNumerator =
                (startTangent * denominator) +
                ((endTangent - startTangent) * numerator);
            var tangentLimit =
                (long)(wall.LengthMm / 2 + projectileRadiusMm) *
                DirectionScale *
                denominator;
            if (Math.Abs(tangentNumerator) > tangentLimit)
            {
                hit = default;
                return false;
            }

            hit = new WindWallSweepHit(wall, numerator, denominator);
            return true;
        }

        private static int Compare(
            WindWallSweepHit left,
            WindWallSweepHit right)
        {
            var leftFraction =
                left.FractionNumerator * right.FractionDenominator;
            var rightFraction =
                right.FractionNumerator * left.FractionDenominator;
            var fraction = leftFraction.CompareTo(rightFraction);
            return fraction != 0
                ? fraction
                : left.Wall.EntityId.CompareTo(right.Wall.EntityId);
        }

        private static Int2Mm CastDirection(PlayerState player)
        {
            if (player.Intent.Aim.X != 0 || player.Intent.Aim.Z != 0)
            {
                return IntegerMath.NormalizeAxisPair(
                    player.Intent.Aim.X,
                    player.Intent.Aim.Z);
            }

            if (player.Facing.X != 0 || player.Facing.Z != 0)
            {
                return IntegerMath.NormalizeAxisPair(
                    player.Facing.X,
                    player.Facing.Z);
            }

            return new Int2Mm(0, DirectionScale);
        }

        private static Int2Mm Offset(
            Int2Mm position,
            Int2Mm direction,
            int distanceMm)
        {
            return new Int2Mm(
                checked(
                    position.X +
                    (int)((long)direction.X * distanceMm / DirectionScale)),
                checked(
                    position.Z +
                    (int)((long)direction.Z * distanceMm / DirectionScale)));
        }

        private static bool TouchesWall(
            PlayerState player,
            WindWallState wall)
        {
            ScaledProjections(
                player.Position,
                wall,
                out var normal,
                out var tangent);
            return
                Math.Abs(normal) <=
                (long)GameplayRules.PlayerCapsuleRadiusMm * DirectionScale &&
                Math.Abs(tangent) <=
                (long)(
                    wall.LengthMm / 2 +
                    GameplayRules.PlayerCapsuleRadiusMm) *
                DirectionScale;
        }

        private static void ScaledProjections(
            Int2Mm point,
            WindWallState wall,
            out long normal,
            out long tangent)
        {
            var deltaX = (long)point.X - wall.Center.X;
            var deltaZ = (long)point.Z - wall.Center.Z;
            normal =
                (deltaX * wall.Direction.X) +
                (deltaZ * wall.Direction.Z);
            tangent =
                (-deltaX * wall.Direction.Z) +
                (deltaZ * wall.Direction.X);
        }
    }
}
