using System;

namespace Jwgb.Tests
{
    [Serializable]
    internal sealed class SimulationFixtureDocument
    {
        public string schema;
        public string ruleset;
        public SimulationFixtureScenario[] scenarios;
    }

    [Serializable]
    internal sealed class SimulationFixtureScenario
    {
        public string name;
        public long rootSeed;
        public bool mapEnabled;
        public bool pveEnabled;
        public string pvePopulation;
        public SimulationSolidFixture[] staticSolids;
        public SimulationRosterFixture[] roster;
        public string initialStateHash;
        public SimulationActionFixture[] actions;
        public SimulationEventFixture[] expectedEvents;
        public bool verifyEvents;
    }

    [Serializable]
    internal sealed class SimulationSolidFixture
    {
        public string solidId;
        public int minimumX;
        public int maximumX;
        public int minimumZ;
        public int maximumZ;
    }

    [Serializable]
    internal sealed class SimulationRosterFixture
    {
        public int entityId;
        public string playerId;
        public string heroId;
        public bool hasPosition;
        public VectorFixture position;
        public string activeAbilityId;
        public SimulationPassiveFixture[] passives;
        public string[] equipmentIds;
    }

    [Serializable]
    internal sealed class SimulationPassiveFixture
    {
        public string passiveId;
        public int level;
    }

    [Serializable]
    internal sealed class SimulationActionFixture
    {
        public string kind;
        public int entityId;
        public string op;
        public string shopId;
        public int version;
        public string heroId;
        public string passiveId;
        public string mode;
        public string destination;
        public int lootEntityId;
        public bool confirm;
        public int wagerGold;
        public int instanceId;
        public string expectedCode;
        public int sequence;
        public int moveX;
        public int moveZ;
        public int aimX;
        public int aimZ;
        public bool attack;
        public int targetEntityId;
        public bool castActive;
        public bool interact;
        public int amount;
        public int sourceEntityId;
        public string damageForm;
        public int durationTicks;
        public int stepCount;
        public bool expectedAccepted;
        public int expectedAppliedDamage;
        public string expectedStateHash;
    }

    [Serializable]
    internal sealed class SimulationEventFixture
    {
        public string type;
        public int tick;
        public int entityId;
        public int sourceEntityId;
        public int targetEntityId;
        public int projectileEntityId;
        public int wallEntityId;
        public string playerId;
        public string heroId;
        public int competitorCount;
        public int trueDeaths;
        public int livesRemaining;
        public int amount;
        public int shieldDamage;
        public int hpDamage;
        public int shieldBypassHpDamage;
        public int remainingHp;
        public int remainingShield;
        public string cause;
        public string form;
        public bool isCritical;
        public string reason;
        public string outcome;
        public int winnerEntityId;
        public int[] placements;
        public string activeAbilityId;
        public string activeName;
        public string passiveId;
        public int criticalDamagePercent;
        public int shieldBypassPercent;
        public int durationTicks;
        public string projectileKind;
        public bool hasPosition;
        public VectorFixture position;
        public VectorFixture previousPosition;
        public VectorFixture newPosition;
        public int requestedDistanceMm;
        public int actualDistanceMm;
        public string blockingSolidId;
        public string protection;
        public int hpRestored;
        public bool didBlink;
        public int buffTicks;
        public int consumedEquipmentInstanceId;
        public int invulnerableTicks;
    }
}
