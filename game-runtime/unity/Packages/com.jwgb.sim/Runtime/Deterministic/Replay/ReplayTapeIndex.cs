using System;
using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal sealed class ReplayTapeIndex
    {
        public ReplayTapeIndex(SimulationReplay tape)
        {
            ValidateTape(tape);
            RosterByTick = GroupRoster(tape);
            InputsByTick = GroupInputs(tape);
            CheckpointsByTick = GroupCheckpoints(tape);
        }

        public IReadOnlyDictionary<int, List<ReplayRosterEntry>>
            RosterByTick { get; }

        public IReadOnlyDictionary<int, List<ReplayInputEntry>>
            InputsByTick { get; }

        public IReadOnlyDictionary<int, ReplayCheckpoint>
            CheckpointsByTick { get; }

        private static void ValidateTape(SimulationReplay tape)
        {
            if (tape == null)
            {
                throw new ArgumentNullException(nameof(tape));
            }

            if (tape.FinalTick < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(tape));
            }

            if (string.IsNullOrEmpty(tape.ExpectedStateHash))
            {
                throw new ArgumentException(
                    "Replay expected state hash must not be empty.",
                    nameof(tape));
            }
        }

        private static Dictionary<int, List<ReplayRosterEntry>> GroupRoster(
            SimulationReplay tape)
        {
            var result = new Dictionary<int, List<ReplayRosterEntry>>();
            var entries = tape.Roster ?? Array.Empty<ReplayRosterEntry>();
            for (var index = 0; index < entries.Length; index += 1)
            {
                AddAtTick(
                    result,
                    entries[index].JoinedAtTick,
                    tape.FinalTick,
                    entries[index]);
            }

            return result;
        }

        private static Dictionary<int, List<ReplayInputEntry>> GroupInputs(
            SimulationReplay tape)
        {
            var result = new Dictionary<int, List<ReplayInputEntry>>();
            var entries = tape.Inputs ?? Array.Empty<ReplayInputEntry>();
            for (var index = 0; index < entries.Length; index += 1)
            {
                AddAtTick(
                    result,
                    entries[index].AtTick,
                    tape.FinalTick,
                    entries[index]);
            }

            return result;
        }

        private static Dictionary<int, ReplayCheckpoint> GroupCheckpoints(
            SimulationReplay tape)
        {
            var result = new Dictionary<int, ReplayCheckpoint>();
            var entries =
                tape.Checkpoints ?? Array.Empty<ReplayCheckpoint>();
            for (var index = 0; index < entries.Length; index += 1)
            {
                var entry = entries[index];
                ValidateTick(entry.Tick, tape.FinalTick);
                if (!result.TryAdd(entry.Tick, entry))
                {
                    throw new ArgumentException(
                        $"Duplicate replay checkpoint tick {entry.Tick}.");
                }
            }

            return result;
        }

        private static void AddAtTick<T>(
            IDictionary<int, List<T>> result,
            int tick,
            int finalTick,
            T entry)
        {
            ValidateTick(tick, finalTick);
            if (!result.TryGetValue(tick, out var entries))
            {
                entries = new List<T>();
                result.Add(tick, entries);
            }

            entries.Add(entry);
        }

        private static void ValidateTick(int tick, int finalTick)
        {
            if (tick < 0 || tick > finalTick)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(tick),
                    $"Replay tick {tick} is outside 0-{finalTick}.");
            }
        }
    }
}
