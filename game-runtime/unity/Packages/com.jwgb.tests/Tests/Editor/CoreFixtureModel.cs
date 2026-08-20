using System;

namespace Jwgb.Tests
{
    [Serializable]
    internal sealed class CoreFixtureDocument
    {
        public string schema;
        public string ruleset;
        public RngFixture rng;
        public HashFixture[] hashes;
        public MathFixture[] math;
        public ScalarFixture scalar;
    }

    [Serializable]
    internal sealed class RngFixture
    {
        public RngSequenceFixture[] sequences;
        public BoundedRngFixture[] bounded;
        public ForkRngFixture[] forks;
    }

    [Serializable]
    internal sealed class RngSequenceFixture
    {
        public long seed;
        public long initialSeed;
        public long[] nextUint32;
    }

    [Serializable]
    internal sealed class BoundedRngFixture
    {
        public long seed;
        public long maximumExclusive;
        public long[] values;
    }

    [Serializable]
    internal sealed class ForkRngFixture
    {
        public long seed;
        public string stream;
        public long initialSeed;
        public long[] nextUint32;
    }

    [Serializable]
    internal sealed class HashFixture
    {
        public string text;
        public long hashString32;
        public long hashText32;
        public string stableHash32;
    }

    [Serializable]
    internal sealed class MathFixture
    {
        public VectorFixture input;
        public VectorFixture normalized;
        public long distanceSquaredFromOrigin;
        public VectorFixture clampedToCircle;
        public VectorFixture movedTowardOrigin;
    }

    [Serializable]
    internal sealed class VectorFixture
    {
        public int x;
        public int z;
    }

    [Serializable]
    internal sealed class ScalarFixture
    {
        public int ticksPerSecond;
        public SquareRootFixture[] squareRoots;
    }

    [Serializable]
    internal sealed class SquareRootFixture
    {
        public long input;
        public long output;
    }
}
