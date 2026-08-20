using System;

namespace Jwgb.Core
{
    public struct DeterministicRng
    {
        private const uint NonZeroFallbackSeed = 0x6d2b79f5;
        private uint state;

        public DeterministicRng(long seed)
        {
            var normalized = unchecked((uint)seed);
            InitialSeed = normalized == 0 ? NonZeroFallbackSeed : normalized;
            state = InitialSeed;
        }

        public uint InitialSeed { get; }

        public uint NextUInt32()
        {
            unchecked
            {
                var value = state;
                value ^= value << 13;
                value ^= value >> 17;
                value ^= value << 5;
                state = value;
                return state;
            }
        }

        public uint NextInt(ulong maximumExclusive)
        {
            const ulong Range = 0x1_0000_0000UL;
            if (maximumExclusive == 0 || maximumExclusive > Range)
            {
                throw new ArgumentOutOfRangeException(nameof(maximumExclusive));
            }

            var limit = (Range / maximumExclusive) * maximumExclusive;
            var value = NextUInt32();
            while (value >= limit)
            {
                value = NextUInt32();
            }

            return (uint)(value % maximumExclusive);
        }

        public DeterministicRng Fork(string streamName)
        {
            if (streamName == null)
            {
                throw new ArgumentNullException(nameof(streamName));
            }

            return new DeterministicRng(Mix32(InitialSeed ^ Hash32.HashString(streamName)));
        }

        public uint Snapshot()
        {
            return state;
        }

        private static uint Mix32(uint value)
        {
            unchecked
            {
                var mixed = value;
                mixed ^= mixed >> 16;
                mixed *= 0x7feb352d;
                mixed ^= mixed >> 15;
                mixed *= 0x846ca68b;
                mixed ^= mixed >> 16;
                return mixed;
            }
        }
    }
}
