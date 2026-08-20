using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static class MatchSystem
    {
        public static void StartIfReady(
            SimulationState state,
            List<SimEvent> events)
        {
            if (state.Match.Status != MatchStatus.Waiting ||
                state.Players.Count < 2)
            {
                return;
            }

            state.Match.Status = MatchStatus.Running;
            state.Match.StartedAtTick = state.Tick;
            events.Add(
                new SimEvent
                {
                    Type = "match-started",
                    Tick = state.Tick,
                    CompetitorCount = state.Players.Count
                });
        }

        public static void ResolveOutcome(
            SimulationState state,
            List<SimEvent> events)
        {
            if (state.Match.Status != MatchStatus.Running)
            {
                return;
            }

            var contenders = new List<PlayerState>();
            foreach (var player in state.Players.Values)
            {
                if (player.LifeState != LifeState.Eliminated)
                {
                    contenders.Add(player);
                }
            }

            var eliminatedGroups = EliminationGroups(state);
            if (contenders.Count > 1)
            {
                var startedAtTick = state.Match.StartedAtTick ?? state.Tick;
                if (state.Tick - startedAtTick >=
                    GameplayRules.MatchVoidAbortTicks)
                {
                    FinishMatch(
                        state,
                        events,
                        "void-abort",
                        new List<int>(),
                        new List<List<int>>(),
                        true);
                }

                return;
            }

            if (contenders.Count == 1)
            {
                var winnerEntityId = contenders[0].EntityId;
                var placementGroups = new List<List<int>>
                {
                    new List<int> { winnerEntityId }
                };
                placementGroups.AddRange(eliminatedGroups);
                FinishMatch(
                    state,
                    events,
                    "winner",
                    new List<int> { winnerEntityId },
                    placementGroups,
                    false);
                return;
            }

            var latestEliminatedGroup = eliminatedGroups.Count > 0
                ? eliminatedGroups[0]
                : new List<int>();
            var outcome = latestEliminatedGroup.Count > 1
                ? "tied-first"
                : "draw";
            FinishMatch(
                state,
                events,
                outcome,
                outcome == "tied-first"
                    ? new List<int>(latestEliminatedGroup)
                    : new List<int>(),
                eliminatedGroups,
                false);
        }

        private static List<List<int>> EliminationGroups(
            SimulationState state)
        {
            // Groups keyed by elimination tick, preserving first-seen tick
            // order like the TS Map, then sorted by tick descending.
            var byTick = new List<KeyValuePair<int, List<int>>>();
            for (var index = 0;
                index < state.EliminationOrder.Count;
                index += 1)
            {
                var entityId = state.EliminationOrder[index];
                var tick = state.EliminationTicks.TryGetValue(
                    entityId,
                    out var eliminatedAt)
                        ? eliminatedAt
                        : state.Tick;
                List<int> group = null;
                for (var groupIndex = 0;
                    groupIndex < byTick.Count;
                    groupIndex += 1)
                {
                    if (byTick[groupIndex].Key == tick)
                    {
                        group = byTick[groupIndex].Value;
                        break;
                    }
                }

                if (group == null)
                {
                    group = new List<int>();
                    byTick.Add(
                        new KeyValuePair<int, List<int>>(tick, group));
                }

                group.Add(entityId);
            }

            byTick.Sort((left, right) => right.Key.CompareTo(left.Key));
            var groups = new List<List<int>>(byTick.Count);
            for (var index = 0; index < byTick.Count; index += 1)
            {
                var group = new List<int>(byTick[index].Value);
                group.Sort();
                groups.Add(group);
            }

            return groups;
        }

        private static void FinishMatch(
            SimulationState state,
            List<SimEvent> events,
            string outcome,
            List<int> winnerEntityIds,
            List<List<int>> placementGroups,
            bool voidAbort)
        {
            var placements = new List<int>();
            for (var index = 0; index < placementGroups.Count; index += 1)
            {
                placements.AddRange(placementGroups[index]);
            }

            if (!voidAbort && placements.Count != state.Players.Count)
            {
                throw new InvalidOperationException(
                    "Match placements must include every competitor.");
            }

            state.Match.CultivationAwards.Clear();
            if (voidAbort)
            {
                foreach (var player in state.Players.Values)
                {
                    state.Match.CultivationAwards.Add(
                        new CultivationAward
                        {
                            EntityId = player.EntityId,
                            Amount = GameplayRules
                                .VoidAbortCultivationCompensation
                        });
                }
            }

            state.Match.Status = MatchStatus.Finished;
            state.Match.FinishedAtTick = state.Tick;
            state.Match.Outcome = outcome;
            state.Match.WinnerEntityId = winnerEntityIds.Count == 1
                ? winnerEntityIds[0]
                : (int?)null;
            state.Match.WinnerEntityIds.Clear();
            state.Match.WinnerEntityIds.AddRange(winnerEntityIds);
            state.Match.Placements.Clear();
            state.Match.Placements.AddRange(placements);
            state.Match.PlacementGroups.Clear();
            for (var index = 0; index < placementGroups.Count; index += 1)
            {
                state.Match.PlacementGroups.Add(
                    new List<int>(placementGroups[index]));
            }

            state.Match.VoidAbortReason = voidAbort ? "VOID_ABORT" : null;
            state.Match.MmrEligible = !voidAbort;
            state.Match.DiagnosticReplayRequired = voidAbort;
            events.Add(
                new SimEvent
                {
                    Type = "match-ended",
                    Tick = state.Tick,
                    Outcome = outcome,
                    WinnerEntityId = state.Match.WinnerEntityId,
                    Placements = placements.ToArray()
                });
        }
    }
}
