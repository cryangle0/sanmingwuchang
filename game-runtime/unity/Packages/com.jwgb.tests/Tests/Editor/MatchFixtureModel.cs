using System;

namespace Jwgb.Tests
{
    [Serializable]
    internal sealed class MatchFixtureDocument
    {
        public string schema;
        public string ruleset;
        public long rootSeed;
        public bool mapEnabled;
        public bool pveEnabled;
        public SimulationSolidFixture[] staticSolids;
        public MatchRosterFixture[] roster;
        public MatchInputFixture[] inputs;
        public MatchCheckpointFixture[] checkpoints;
        public int finalTick;
        public string expectedStateHash;
        public MatchOutcomeFixture outcome;
    }

    [Serializable]
    internal sealed class MatchRosterFixture
    {
        public int entityId;
        public int joinedAtTick;
        public string playerId;
        public string heroId;
        public string activeAbilityId;
        public bool hasPosition;
        public VectorFixture position;
        public SimulationPassiveFixture[] passives;
        public string[] equipmentIds;
    }

    [Serializable]
    internal sealed class MatchInputFixture
    {
        public int atTick;
        public int entityId;
        public int sequence;
        public int moveX;
        public int moveZ;
        public int aimX;
        public int aimZ;
        public bool attack;
        public int targetEntityId;
        public bool castActive;
        public bool interact;
    }

    [Serializable]
    internal sealed class MatchCheckpointFixture
    {
        public int tick;
        public string stateHash;
    }

    [Serializable]
    internal sealed class MatchOutcomeFixture
    {
        public string outcome;
        public int winnerEntityId;
        public int finishedAtTick;
        public int[] placements;
    }
}
