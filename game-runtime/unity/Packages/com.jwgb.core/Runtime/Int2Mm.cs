using System;

namespace Jwgb.Core
{
    public readonly struct Int2Mm : IEquatable<Int2Mm>
    {
        public Int2Mm(int x, int z)
        {
            X = x;
            Z = z;
        }

        public int X { get; }

        public int Z { get; }

        public bool Equals(Int2Mm other)
        {
            return X == other.X && Z == other.Z;
        }

        public override bool Equals(object obj)
        {
            return obj is Int2Mm other && Equals(other);
        }

        public override int GetHashCode()
        {
            return unchecked((X * 397) ^ Z);
        }

        public override string ToString()
        {
            return $"({X}, {Z})";
        }
    }
}
