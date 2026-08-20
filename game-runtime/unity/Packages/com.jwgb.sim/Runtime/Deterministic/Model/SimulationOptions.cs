using System;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    public sealed class GameSimulationOptions
    {
        public long RootSeed { get; set; }

        public StaticSolidRect[] StaticSolids { get; set; } =
            Array.Empty<StaticSolidRect>();

        public bool MapEnabled { get; set; }

        public bool PveEnabled { get; set; }

        public PvePopulation PvePopulation { get; set; } =
            PvePopulation.Demo;

        public bool CaptureReplayCheckpoints { get; set; }
    }

    public sealed class AddPlayerOptions
    {
        public string PlayerId { get; set; }

        public string HeroId { get; set; }

        public bool HasPosition { get; set; }

        public Int2Mm Position { get; set; }

        public string ActiveAbilityId { get; set; }

        public PassiveLoadoutEntry[] Passives { get; set; } =
            Array.Empty<PassiveLoadoutEntry>();

        public string[] EquipmentIds { get; set; } = Array.Empty<string>();
    }

    public readonly struct StaticSolidRect
    {
        public StaticSolidRect(
            string solidId,
            int minimumX,
            int maximumX,
            int minimumZ,
            int maximumZ)
        {
            if (string.IsNullOrWhiteSpace(solidId))
            {
                throw new ArgumentException(
                    "Static solid id must not be empty.",
                    nameof(solidId));
            }

            if (minimumX >= maximumX || minimumZ >= maximumZ)
            {
                throw new ArgumentException(
                    "Static solid bounds must have positive width and depth.");
            }

            SolidId = solidId;
            MinimumX = minimumX;
            MaximumX = maximumX;
            MinimumZ = minimumZ;
            MaximumZ = maximumZ;
        }

        public string SolidId { get; }

        public int MinimumX { get; }

        public int MaximumX { get; }

        public int MinimumZ { get; }

        public int MaximumZ { get; }
    }
}
