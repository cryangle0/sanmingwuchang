using System;

namespace Jwgb.Core
{
    public static class IntegerMath
    {
        public static long IntegerSquareRoot(long value)
        {
            if (value < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(value));
            }

            var result = (long)Math.Floor(Math.Sqrt(value));
            while (result < long.MaxValue)
            {
                var next = result + 1;
                if (next > value / next)
                {
                    break;
                }

                result = next;
            }

            while (result > 0 && result > value / result)
            {
                result -= 1;
            }

            return result;
        }

        public static long DistanceSquared(Int2Mm left, Int2Mm right)
        {
            var deltaX = (long)left.X - right.X;
            var deltaZ = (long)left.Z - right.Z;
            return checked((deltaX * deltaX) + (deltaZ * deltaZ));
        }

        public static Int2Mm NormalizeAxisPair(int x, int z, int scale = 1_000)
        {
            if (scale <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(scale));
            }

            var clampedX = Clamp(x, -scale, scale);
            var clampedZ = Clamp(z, -scale, scale);
            var magnitudeSquared = ((long)clampedX * clampedX) + ((long)clampedZ * clampedZ);
            var scaleSquared = (long)scale * scale;

            if (magnitudeSquared <= scaleSquared)
            {
                return new Int2Mm(clampedX, clampedZ);
            }

            var magnitude = IntegerSquareRoot(magnitudeSquared);
            return new Int2Mm(
                checked((int)(((long)clampedX * scale) / magnitude)),
                checked((int)(((long)clampedZ * scale) / magnitude)));
        }

        public static Int2Mm ClampToCircle(Int2Mm position, int radiusMm)
        {
            if (radiusMm < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(radiusMm));
            }

            var distanceSquared = ((long)position.X * position.X) + ((long)position.Z * position.Z);
            var radiusSquared = (long)radiusMm * radiusMm;

            if (distanceSquared <= radiusSquared)
            {
                return position;
            }

            var distance = IntegerSquareRoot(distanceSquared);
            return new Int2Mm(
                checked((int)(((long)position.X * radiusMm) / distance)),
                checked((int)(((long)position.Z * radiusMm) / distance)));
        }

        public static Int2Mm MoveToward(Int2Mm from, Int2Mm to, int maximumDistanceMm)
        {
            if (maximumDistanceMm < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(maximumDistanceMm));
            }

            var deltaX = (long)to.X - from.X;
            var deltaZ = (long)to.Z - from.Z;
            var distanceSquared = (deltaX * deltaX) + (deltaZ * deltaZ);
            var maximumDistanceSquared = (long)maximumDistanceMm * maximumDistanceMm;

            if (distanceSquared == 0 || distanceSquared <= maximumDistanceSquared)
            {
                return to;
            }

            var distance = IntegerSquareRoot(distanceSquared);
            return new Int2Mm(
                checked(from.X + (int)((deltaX * maximumDistanceMm) / distance)),
                checked(from.Z + (int)((deltaZ * maximumDistanceMm) / distance)));
        }

        private static int Clamp(int value, int minimum, int maximum)
        {
            if (value < minimum)
            {
                return minimum;
            }

            return value > maximum ? maximum : value;
        }
    }
}
