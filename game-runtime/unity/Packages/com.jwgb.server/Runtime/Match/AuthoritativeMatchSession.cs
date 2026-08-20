using System;
using System.Collections.Generic;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Server
{
    public sealed class AuthoritativeMatchSession
    {
        /// <summary>
        /// Full snapshots (state hash + all PVE collections) are only
        /// built at the network snapshot cadence; bot planning uses a
        /// cheap players-only snapshot on the other sim ticks. Keeps
        /// the 20 Hz server loop free of the full 123-monster
        /// snapshot allocation bill without changing bot inputs.
        /// </summary>
        private const int FullSnapshotCadenceTicks =
            MatchNetworkDefaults.SimulationRate /
            MatchNetworkDefaults.SnapshotRate;

        private readonly GameSimulation simulation;
        private readonly int[] competitorEntityIds;
        private readonly Dictionary<int, int> sequences =
            new Dictionary<int, int>();
        private WorldSnapshot planningSnapshot;

        public AuthoritativeMatchSession(
            long rootSeed,
            int competitorCount = 30,
            bool mapEnabled = true,
            bool pveEnabled = true)
        {
            simulation = new GameSimulation(
                new GameSimulationOptions
                {
                    RootSeed = rootSeed,
                    MapEnabled = mapEnabled,
                    PveEnabled = pveEnabled,
                    PvePopulation = mapEnabled
                        ? PvePopulation.Full
                        : PvePopulation.Demo
                });
            MapEnabled = mapEnabled;
            PveEnabled = pveEnabled;
            competitorEntityIds = M1MatchRoster.AddCompetitors(
                simulation,
                competitorCount,
                "server");
            for (var index = 0;
                index < competitorEntityIds.Length;
                index += 1)
            {
                sequences.Add(competitorEntityIds[index], 0);
            }

            Snapshot = simulation.GetSnapshot();
            planningSnapshot = Snapshot;
        }

        public bool MapEnabled { get; }

        public bool PveEnabled { get; }

        public int CurrentTick => simulation.Tick;

        public int AppliedExternalInputCount { get; private set; }

        public int LastAppliedExternalInputSequence {
            get;
            private set;
        }

        /// <summary>
        /// Latest full snapshot. Refreshed at the network snapshot
        /// cadence (and on match finish), not every sim tick.
        /// </summary>
        public WorldSnapshot Snapshot { get; private set; }

        public int[] GetCompetitorEntityIds()
        {
            return (int[])competitorEntityIds.Clone();
        }

        public PlayerRuntimeSnapshot[] GetPlayerRuntimeSnapshots()
        {
            var result =
                new PlayerRuntimeSnapshot[competitorEntityIds.Length];
            for (var index = 0; index < result.Length; index += 1)
            {
                result[index] =
                    simulation.GetPlayerRuntimeSnapshot(
                        competitorEntityIds[index]);
            }
            return result;
        }

        public SimulationTransactionResult ExecuteTransaction(
            SimulationTransactionRequest request)
        {
            var result = simulation.ExecuteTransaction(request);
            Snapshot = result.Snapshot;
            planningSnapshot = simulation.GetBotPlanningSnapshot();
            return result;
        }

        public void AssignNetworkHero(
            int entityId,
            string heroId)
        {
            simulation.AssignNetworkHero(entityId, heroId);
            Snapshot = simulation.GetSnapshot();
            planningSnapshot = simulation.GetBotPlanningSnapshot();
        }

        public int SubmitDisconnectNeutralIntent(int entityId)
        {
            var sequence = NextInternalSequence(entityId);
            if (!simulation.SubmitIntent(
                    entityId,
                    PlayerIntent.Neutral(sequence)))
            {
                throw new InvalidOperationException(
                    $"Could not neutralize entity {entityId}.");
            }
            planningSnapshot = simulation.GetBotPlanningSnapshot();
            return sequence;
        }

        internal void FinishForSmoke()
        {
            if (Snapshot.Match.Status == MatchStatus.Finished)
            {
                return;
            }

            var winnerEntityId = competitorEntityIds[0];
            for (var index = 1;
                index < competitorEntityIds.Length;
                index += 1)
            {
                EliminateForSmoke(
                    competitorEntityIds[index],
                    winnerEntityId);
            }
            Snapshot = simulation.GetSnapshot();
            planningSnapshot = simulation.GetBotPlanningSnapshot();
            if (Snapshot.Match.Status != MatchStatus.Finished)
            {
                throw new InvalidOperationException(
                    "Rematch smoke failed to finish the first match.");
            }
        }

        public SimEvent[] Step()
        {
            return Step(null, null);
        }

        public SimEvent[] Step(
            IReadOnlyDictionary<int, PlayerIntent> externalIntents,
            ISet<int> externallyControlledEntityIds)
        {
            if (planningSnapshot.Match.Status == MatchStatus.Finished)
            {
                return Array.Empty<SimEvent>();
            }

            var planning = planningSnapshot;
            for (var index = 0;
                index < competitorEntityIds.Length;
                index += 1)
            {
                var entityId = competitorEntityIds[index];
                if (externallyControlledEntityIds != null &&
                    externallyControlledEntityIds.Contains(entityId))
                {
                    if (externalIntents != null &&
                        externalIntents.TryGetValue(
                            entityId,
                            out var externalIntent))
                    {
                        var applied = simulation.SubmitIntent(
                            entityId,
                            WithInternalSequence(
                                entityId,
                                externalIntent));
                        if (applied)
                        {
                            AppliedExternalInputCount += 1;
                            LastAppliedExternalInputSequence =
                                Math.Max(
                                    LastAppliedExternalInputSequence,
                                    externalIntent.Sequence);
                        }
                    }
                    continue;
                }

                simulation.SubmitIntent(
                    entityId,
                    BotIntentPlanner.Create(
                        planning,
                        entityId,
                        NextInternalSequence(entityId)));
            }

            simulation.Step();
            planningSnapshot = simulation.GetBotPlanningSnapshot();
            if (!PveEnabled ||
                simulation.Tick % FullSnapshotCadenceTicks == 0 ||
                planningSnapshot.Match.FinishedAtTick.HasValue)
            {
                Snapshot = simulation.GetSnapshot();
            }
            return simulation.DrainEvents();
        }

        private PlayerIntent WithInternalSequence(
            int entityId,
            PlayerIntent intent)
        {
            return PlayerIntent.Create(
                NextInternalSequence(entityId),
                intent.Movement.X,
                intent.Movement.Z,
                intent.Aim.X,
                intent.Aim.Z,
                intent.Attack,
                intent.TargetEntityId,
                intent.CastActive,
                intent.Interact);
        }

        private int NextInternalSequence(int entityId)
        {
            var sequence = checked(sequences[entityId] + 1);
            sequences[entityId] = sequence;
            return sequence;
        }

        public SimEvent[] DrainEvents()
        {
            return simulation.DrainEvents();
        }

        private void EliminateForSmoke(
            int targetEntityId,
            int winnerEntityId)
        {
            const int maximumAttempts = 10_000;
            for (var attempt = 0;
                attempt < maximumAttempts;
                attempt += 1)
            {
                var snapshot = simulation.GetBotPlanningSnapshot();
                PlayerSnapshot target = null;
                for (var index = 0;
                    index < snapshot.Players.Length;
                    index += 1)
                {
                    if (snapshot.Players[index].EntityId ==
                        targetEntityId)
                    {
                        target = snapshot.Players[index];
                        break;
                    }
                }
                if (target == null)
                {
                    throw new InvalidOperationException(
                        $"Rematch smoke target {targetEntityId} is missing.");
                }
                if (target.LifeState == LifeState.Eliminated)
                {
                    return;
                }
                if (target.LifeState == LifeState.Alive)
                {
                    simulation.Damage(
                        targetEntityId,
                        100_000,
                        winnerEntityId);
                }
                else
                {
                    simulation.Step();
                }
            }
            throw new InvalidOperationException(
                $"Rematch smoke could not eliminate {targetEntityId}.");
        }
    }
}
