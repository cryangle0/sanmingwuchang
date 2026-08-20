using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Integer 2D geometry primitives for authoritative map collision.
    /// Mirrors packages/sim/src/geometry/integer-geometry.ts exactly; every
    /// product stays inside long range because segment lengths are capped by
    /// <see cref="MaxSegmentLengthMm"/> subdivision.
    /// </summary>
    internal static class IntegerGeometry
    {
        public const long MaxSegmentLengthMm = 32_768;

        public static long CrossOrientation(
            MapPointMmRecord a,
            MapPointMmRecord b,
            MapPointMmRecord point)
        {
            return ((b.X - a.X) * (point.Z - a.Z)) - ((b.Z - a.Z) * (point.X - a.X));
        }

        public static bool RingContainsPoint(
            MapPointMmRecord[] ring,
            MapPointMmRecord point)
        {
            var inside = false;
            for (var index = 0; index < ring.Length; index += 1)
            {
                var a = ring[index];
                var b = ring[(index + 1) % ring.Length];
                if ((a.Z > point.Z) == (b.Z > point.Z))
                {
                    continue;
                }

                var deltaZ = b.Z - a.Z;
                var left = (point.X - a.X) * deltaZ;
                var right = (point.Z - a.Z) * (b.X - a.X);
                if (deltaZ > 0 ? left < right : left > right)
                {
                    inside = !inside;
                }
            }

            return inside;
        }

        public static bool ConvexContainsPoint(
            MapPointMmRecord[] vertices,
            MapPointMmRecord point)
        {
            for (var index = 0; index < vertices.Length; index += 1)
            {
                var a = vertices[index];
                var b = vertices[(index + 1) % vertices.Length];
                if (CrossOrientation(a, b, point) < 0)
                {
                    return false;
                }
            }

            return true;
        }

        /// <summary>
        /// Closest lattice point on [a, b]; up to 1 mm from the exact foot
        /// point, matching the TypeScript truncation semantics.
        /// </summary>
        public static MapPointMmRecord ClosestPointOnSegment(
            MapPointMmRecord a,
            MapPointMmRecord b,
            MapPointMmRecord point)
        {
            var abX = b.X - a.X;
            var abZ = b.Z - a.Z;
            var lengthSquared = (abX * abX) + (abZ * abZ);
            if (lengthSquared == 0)
            {
                return a;
            }

            var apX = point.X - a.X;
            var apZ = point.Z - a.Z;
            var rawT = (apX * abX) + (apZ * abZ);
            if (rawT <= 0)
            {
                return a;
            }

            if (rawT >= lengthSquared)
            {
                return b;
            }

            // C# integer division truncates toward zero exactly like
            // Math.trunc on the float64-exact products used in TypeScript.
            return new MapPointMmRecord(
                a.X + ((abX * rawT) / lengthSquared),
                a.Z + ((abZ * rawT) / lengthSquared));
        }

        public static long DistanceSquaredBetween(
            MapPointMmRecord a,
            MapPointMmRecord b)
        {
            var dx = a.X - b.X;
            var dz = a.Z - b.Z;
            return (dx * dx) + (dz * dz);
        }

        private static bool IsPointOnSegment(
            MapPointMmRecord a,
            MapPointMmRecord b,
            MapPointMmRecord point)
        {
            return System.Math.Min(a.X, b.X) <= point.X &&
                point.X <= System.Math.Max(a.X, b.X) &&
                System.Math.Min(a.Z, b.Z) <= point.Z &&
                point.Z <= System.Math.Max(a.Z, b.Z);
        }

        /// <summary>
        /// Inclusive integer segment intersection used by line-of-sight
        /// queries. Port of segmentsIntersect from
        /// packages/sim/src/geometry/integer-geometry.ts.
        /// </summary>
        public static bool SegmentsIntersect(
            MapPointMmRecord firstStart,
            MapPointMmRecord firstEnd,
            MapPointMmRecord secondStart,
            MapPointMmRecord secondEnd)
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

        /// <summary>
        /// Port of distanceSquaredToSegment from
        /// packages/sim/src/geometry/integer-geometry.ts.
        /// </summary>
        public static long DistanceSquaredToSegment(
            MapPointMmRecord point,
            MapPointMmRecord start,
            MapPointMmRecord end)
        {
            var deltaX = end.X - start.X;
            var deltaZ = end.Z - start.Z;
            var lengthSquared = (deltaX * deltaX) + (deltaZ * deltaZ);
            if (lengthSquared == 0)
            {
                return DistanceSquaredBetween(point, start);
            }

            var rawProjection =
                ((point.X - start.X) * deltaX) +
                ((point.Z - start.Z) * deltaZ);
            var projection = System.Math.Max(
                0,
                System.Math.Min(lengthSquared, rawProjection));
            var closest = new MapPointMmRecord(
                start.X + ((deltaX * projection) / lengthSquared),
                start.Z + ((deltaZ * projection) / lengthSquared));
            return DistanceSquaredBetween(point, closest);
        }

        public static int SubdivideChunkCount(
            MapPointMmRecord a,
            MapPointMmRecord b,
            long maximumLengthMm)
        {
            var spanX = b.X - a.X;
            var spanZ = b.Z - a.Z;
            var span = System.Math.Max(System.Math.Abs(spanX), System.Math.Abs(spanZ));
            var chunkCount = (span + maximumLengthMm - 1) / maximumLengthMm;
            return (int)System.Math.Max(1, chunkCount);
        }

        public static MapPointMmRecord SubdividePoint(
            MapPointMmRecord a,
            MapPointMmRecord b,
            int chunk,
            int chunkCount)
        {
            if (chunk >= chunkCount)
            {
                return b;
            }

            var spanX = b.X - a.X;
            var spanZ = b.Z - a.Z;
            return new MapPointMmRecord(
                a.X + ((spanX * chunk) / chunkCount),
                a.Z + ((spanZ * chunk) / chunkCount));
        }
    }
}
