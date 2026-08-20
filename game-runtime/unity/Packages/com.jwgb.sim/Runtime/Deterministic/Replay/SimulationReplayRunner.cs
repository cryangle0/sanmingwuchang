using System;
using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    public static class SimulationReplayRunner
    {
        public static GameSimulation Replay(SimulationReplay tape)
        {
            return Run(tape, false).Simulation;
        }

        public static ReplayVerificationResult Verify(SimulationReplay tape)
        {
            return Run(tape, true);
        }

        private static ReplayVerificationResult Run(
            SimulationReplay tape,
            bool verify)
        {
            var tapeIndex = new ReplayTapeIndex(tape);
            var simulation = new GameSimulation(
                new GameSimulationOptions
                {
                    RootSeed = tape.RootSeed,
                    StaticSolids = tape.StaticSolids,
                    MapEnabled = tape.MapEnabled,
                    PveEnabled = tape.PveEnabled,
                    PvePopulation = tape.PvePopulation
                });
            var entityIds = new Dictionary<int, int>();

            while (simulation.Tick <= tape.FinalTick)
            {
                AddRosterAtTick(
                    simulation,
                    entityIds,
                    tapeIndex.RosterByTick,
                    simulation.Tick);
                var inputDrift = SubmitInputsAtTick(
                    simulation,
                    entityIds,
                    tapeIndex.InputsByTick,
                    tapeIndex.CheckpointsByTick,
                    tape,
                    simulation.Tick);
                if (verify && inputDrift != null)
                {
                    return Result(simulation, inputDrift);
                }

                if (verify &&
                    tapeIndex.CheckpointsByTick.TryGetValue(
                        simulation.Tick,
                        out var checkpoint))
                {
                    var checkpointDrift = Compare(
                        simulation,
                        checkpoint.StateHash,
                        "checkpoint");
                    if (checkpointDrift != null)
                    {
                        return Result(simulation, checkpointDrift);
                    }
                }

                if (simulation.Tick == tape.FinalTick)
                {
                    break;
                }

                var previousTick = simulation.Tick;
                simulation.Step();
                if (simulation.Tick == previousTick)
                {
                    return Result(
                        simulation,
                        new ReplayDrift
                        {
                            Tick = simulation.Tick,
                            Reason = "simulation stopped before final tick",
                            ExpectedStateHash = tape.ExpectedStateHash,
                            ActualStateHash = simulation.GetStateHash()
                        });
                }
            }

            var finalDrift = verify
                ? Compare(
                    simulation,
                    tape.ExpectedStateHash,
                    "final-state")
                : null;
            return Result(simulation, finalDrift);
        }

        private static void AddRosterAtTick(
            GameSimulation simulation,
            Dictionary<int, int> entityIds,
            IReadOnlyDictionary<int, List<ReplayRosterEntry>> entriesByTick,
            int tick)
        {
            if (!entriesByTick.TryGetValue(tick, out var entries))
            {
                return;
            }

            for (var index = 0; index < entries.Count; index += 1)
            {
                var entry = entries[index];
                if (entityIds.ContainsKey(entry.EntityId))
                {
                    throw new ArgumentException(
                        $"Duplicate replay entity {entry.EntityId}.");
                }

                var replayEntityId = simulation.AddPlayer(
                    new AddPlayerOptions
                    {
                        PlayerId = entry.PlayerId,
                        HeroId = entry.HeroId,
                        ActiveAbilityId = entry.ActiveAbilityId,
                        HasPosition = entry.HasPosition,
                        Position = entry.Position,
                        Passives = ClonePassives(entry.Passives),
                        EquipmentIds = CloneStrings(entry.EquipmentIds)
                    });
                entityIds.Add(entry.EntityId, replayEntityId);
            }
        }

        private static ReplayDrift SubmitInputsAtTick(
            GameSimulation simulation,
            IReadOnlyDictionary<int, int> entityIds,
            IReadOnlyDictionary<int, List<ReplayInputEntry>> entriesByTick,
            IReadOnlyDictionary<int, ReplayCheckpoint> checkpointsByTick,
            SimulationReplay tape,
            int tick)
        {
            if (!entriesByTick.TryGetValue(tick, out var entries))
            {
                return null;
            }

            for (var index = 0; index < entries.Count; index += 1)
            {
                var entry = entries[index];
                if (!entityIds.TryGetValue(
                        entry.EntityId,
                        out var replayEntityId))
                {
                    throw new ArgumentException(
                        $"Unknown replay input entity {entry.EntityId}.");
                }

                var intent = RemapIntent(entry.Intent, entityIds);
                if (simulation.SubmitIntent(replayEntityId, intent))
                {
                    continue;
                }

                var expectedHash = checkpointsByTick.TryGetValue(
                    tick,
                    out var checkpoint)
                        ? checkpoint.StateHash
                        : tape.ExpectedStateHash;
                return new ReplayDrift
                {
                    Tick = tick,
                    Reason =
                        $"accepted input {index} was rejected during replay",
                    ExpectedStateHash = expectedHash,
                    ActualStateHash = simulation.GetStateHash()
                };
            }

            return null;
        }

        private static PlayerIntent RemapIntent(
            PlayerIntent intent,
            IReadOnlyDictionary<int, int> entityIds)
        {
            int? targetEntityId = null;
            if (intent.TargetEntityId.HasValue)
            {
                if (!entityIds.TryGetValue(
                        intent.TargetEntityId.Value,
                        out var replayTargetEntityId))
                {
                    throw new ArgumentException(
                        $"Unknown replay target {intent.TargetEntityId.Value}.");
                }

                targetEntityId = replayTargetEntityId;
            }

            return PlayerIntent.Create(
                intent.Sequence,
                intent.Movement.X,
                intent.Movement.Z,
                intent.Aim.X,
                intent.Aim.Z,
                intent.Attack,
                targetEntityId,
                intent.CastActive,
                intent.Interact);
        }

        private static ReplayDrift Compare(
            GameSimulation simulation,
            string expectedHash,
            string reason)
        {
            var actualHash = simulation.GetStateHash();
            return string.Equals(
                actualHash,
                expectedHash,
                StringComparison.Ordinal)
                    ? null
                    : new ReplayDrift
                    {
                        Tick = simulation.Tick,
                        Reason = reason,
                        ExpectedStateHash = expectedHash,
                        ActualStateHash = actualHash
                    };
        }

        private static ReplayVerificationResult Result(
            GameSimulation simulation,
            ReplayDrift drift)
        {
            return new ReplayVerificationResult
            {
                Simulation = simulation,
                FirstDrift = drift
            };
        }

        private static PassiveLoadoutEntry[] ClonePassives(
            PassiveLoadoutEntry[] values)
        {
            values ??= Array.Empty<PassiveLoadoutEntry>();
            return (PassiveLoadoutEntry[])values.Clone();
        }

        private static string[] CloneStrings(string[] values)
        {
            values ??= Array.Empty<string>();
            return (string[])values.Clone();
        }
    }
}
