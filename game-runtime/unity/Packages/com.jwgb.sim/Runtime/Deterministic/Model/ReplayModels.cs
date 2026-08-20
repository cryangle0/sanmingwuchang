using System;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public sealed class ReplayRosterEntry
    {
        public int EntityId { get; set; }

        public int JoinedAtTick { get; set; }

        public string PlayerId { get; set; }

        public string HeroId { get; set; }

        public string ActiveAbilityId { get; set; }

        public bool HasPosition { get; set; }

        public Int2Mm Position { get; set; }

        public PassiveLoadoutEntry[] Passives { get; set; } =
            Array.Empty<PassiveLoadoutEntry>();

        public string[] EquipmentIds { get; set; } =
            Array.Empty<string>();
    }

    public sealed class ReplayInputEntry
    {
        public int AtTick { get; set; }

        public int EntityId { get; set; }

        public PlayerIntent Intent { get; set; }
    }

    public sealed class ReplayCheckpoint
    {
        public int Tick { get; set; }

        public string StateHash { get; set; }
    }

    public sealed class SimulationReplay
    {
        public long RootSeed { get; set; }

        public StaticSolidRect[] StaticSolids { get; set; } =
            Array.Empty<StaticSolidRect>();

        public bool MapEnabled { get; set; }

        public bool PveEnabled { get; set; }

        public PvePopulation PvePopulation { get; set; } =
            PvePopulation.Demo;

        public ReplayRosterEntry[] Roster { get; set; } =
            Array.Empty<ReplayRosterEntry>();

        public ReplayInputEntry[] Inputs { get; set; } =
            Array.Empty<ReplayInputEntry>();

        public ReplayCheckpoint[] Checkpoints { get; set; } =
            Array.Empty<ReplayCheckpoint>();

        public int FinalTick { get; set; }

        public string ExpectedStateHash { get; set; }
    }

    public sealed class ReplayDrift
    {
        public int Tick { get; set; }

        public string Reason { get; set; }

        public string ExpectedStateHash { get; set; }

        public string ActualStateHash { get; set; }
    }

    public sealed class ReplayVerificationResult
    {
        public GameSimulation Simulation { get; set; }

        public ReplayDrift FirstDrift { get; set; }

        public bool IsMatch => FirstDrift == null;
    }
}
