using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of hasDirectLineOfSight from
    /// packages/sim/src/systems/active-targeting.ts restricted to the
    /// deterministic slice: the 840m map field and static solids block
    /// sight; active ability walls are absent in fixtures.
    /// </summary>
    internal static class LineOfSightSystem
    {
        public static bool HasDirectLineOfSight(
            SimulationState state,
            Int2Mm start,
            Int2Mm end,
            int clearanceMm = 450,
            WallTraversal traversal = default)
        {
            if (state.MapField != null &&
                state.MapField.FirstLineOfSightBlock(
                    MapCollisionAdapter.ToMapPoint(start),
                    MapCollisionAdapter.ToMapPoint(end),
                    clearanceMm,
                    traversal) != null)
            {
                return false;
            }

            return !HasStaticSolidLineBlock(state, start, end, clearanceMm);
        }

        private static bool HasStaticSolidLineBlock(
            SimulationState state,
            Int2Mm start,
            Int2Mm end,
            int clearanceMm)
        {
            for (var index = 0; index < state.StaticSolids.Count; index += 1)
            {
                var solid = state.StaticSolids[index];
                if (SegmentIntersectsExpandedRect(
                        start,
                        end,
                        solid.MinimumX - clearanceMm,
                        solid.MaximumX + clearanceMm,
                        solid.MinimumZ - clearanceMm,
                        solid.MaximumZ + clearanceMm))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool SegmentIntersectsExpandedRect(
            Int2Mm start,
            Int2Mm end,
            int minimumX,
            int maximumX,
            int minimumZ,
            int maximumZ)
        {
            if (IsInsideRect(start, minimumX, maximumX, minimumZ, maximumZ) ||
                IsInsideRect(end, minimumX, maximumX, minimumZ, maximumZ))
            {
                return true;
            }

            var corners = new[]
            {
                new Int2Mm(minimumX, minimumZ),
                new Int2Mm(maximumX, minimumZ),
                new Int2Mm(maximumX, maximumZ),
                new Int2Mm(minimumX, maximumZ)
            };
            for (var index = 0; index < corners.Length; index += 1)
            {
                var first = corners[index];
                var second = corners[(index + 1) % corners.Length];
                if (SegmentsIntersect(start, end, first, second))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool IsInsideRect(
            Int2Mm point,
            int minimumX,
            int maximumX,
            int minimumZ,
            int maximumZ)
        {
            return point.X >= minimumX &&
                point.X <= maximumX &&
                point.Z >= minimumZ &&
                point.Z <= maximumZ;
        }

        private static long CrossOrientation(Int2Mm a, Int2Mm b, Int2Mm point)
        {
            return ((long)(b.X - a.X) * (point.Z - a.Z)) -
                ((long)(b.Z - a.Z) * (point.X - a.X));
        }

        private static bool IsPointOnSegment(Int2Mm a, Int2Mm b, Int2Mm point)
        {
            return System.Math.Min(a.X, b.X) <= point.X &&
                point.X <= System.Math.Max(a.X, b.X) &&
                System.Math.Min(a.Z, b.Z) <= point.Z &&
                point.Z <= System.Math.Max(a.Z, b.Z);
        }

        internal static bool SegmentsIntersect(
            Int2Mm firstStart,
            Int2Mm firstEnd,
            Int2Mm secondStart,
            Int2Mm secondEnd)
        {
            var firstToSecondStart = CrossOrientation(
                firstStart,
                firstEnd,
                secondStart);
            var firstToSecondEnd = CrossOrientation(
                firstStart,
                firstEnd,
                secondEnd);
            var secondToFirstStart = CrossOrientation(
                secondStart,
                secondEnd,
                firstStart);
            var secondToFirstEnd = CrossOrientation(
                secondStart,
                secondEnd,
                firstEnd);
            var firstStraddles =
                (firstToSecondStart < 0 && firstToSecondEnd > 0) ||
                (firstToSecondStart > 0 && firstToSecondEnd < 0);
            var secondStraddles =
                (secondToFirstStart < 0 && secondToFirstEnd > 0) ||
                (secondToFirstStart > 0 && secondToFirstEnd < 0);
            if (firstStraddles && secondStraddles)
            {
                return true;
            }

            return (firstToSecondStart == 0 &&
                    IsPointOnSegment(firstStart, firstEnd, secondStart)) ||
                (firstToSecondEnd == 0 &&
                    IsPointOnSegment(firstStart, firstEnd, secondEnd)) ||
                (secondToFirstStart == 0 &&
                    IsPointOnSegment(secondStart, secondEnd, firstStart)) ||
                (secondToFirstEnd == 0 &&
                    IsPointOnSegment(secondStart, secondEnd, firstEnd));
        }
    }
}
