using System;

namespace Jwgb.Tests
{
    [Serializable]
    internal sealed class SeedFixtureDocument
    {
        public string schema;
        public string ruleset;
        public int stepCount;
        public SeedFixtureEntry[] seeds;
    }

    [Serializable]
    internal sealed class SeedFixtureEntry
    {
        public int rootSeed;
        public int finalTick;
        public string finalStateHash;
    }
}
