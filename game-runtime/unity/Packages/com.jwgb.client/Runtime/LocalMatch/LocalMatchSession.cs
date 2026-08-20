using System;
using System.Collections.Generic;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    public sealed class LocalMatchSession
    {
        private readonly GameSimulation simulation;
        private readonly int[] competitorEntityIds;
        private readonly Dictionary<int, int> sequences =
            new Dictionary<int, int>();

        public LocalMatchSession(
            long rootSeed,
            int competitorCount = 8,
            string localHeroId = null,
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
                "local",
                localHeroId);
            for (var index = 0;
                index < competitorEntityIds.Length;
                index += 1)
            {
                sequences.Add(competitorEntityIds[index], 0);
            }

            LocalEntityId = competitorEntityIds[0];
            Transactions = new LocalMatchTransactionService(this);
            Snapshot = simulation.GetSnapshot();
        }

        public int LocalEntityId { get; }

        public bool MapEnabled { get; }

        public bool PveEnabled { get; }

        public LocalMatchTransactionService Transactions { get; }

        public WorldSnapshot Snapshot { get; private set; }

        public string StateHash => simulation.GetStateHash();

        public SimulationTransactionResult ExecuteTransaction(
            SimulationTransactionRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }
            if (request.PlayerEntityId != LocalEntityId)
            {
                throw new InvalidOperationException(
                    "Local transactions may only target the local player.");
            }

            var result = simulation.ExecuteTransaction(request);
            Snapshot = result.Snapshot;
            return result;
        }

        public LocalMatchFrame Step(LocalMatchCommand command)
        {
            if (Snapshot.Match.Status == MatchStatus.Finished)
            {
                return new LocalMatchFrame
                {
                    Snapshot = Snapshot,
                    Events = Array.Empty<SimEvent>()
                };
            }

            SubmitLocalCommand(command);
            var planningSnapshot = Snapshot;
            for (var index = 1;
                index < competitorEntityIds.Length;
                index += 1)
            {
                var entityId = competitorEntityIds[index];
                var sequence = NextSequence(entityId);
                simulation.SubmitIntent(
                    entityId,
                    BotIntentPlanner.Create(
                        planningSnapshot,
                        entityId,
                        sequence));
            }

            simulation.Step();
            Snapshot = simulation.GetSnapshot();
            return new LocalMatchFrame
            {
                Snapshot = Snapshot,
                Events = simulation.DrainEvents()
            };
        }

        private void SubmitLocalCommand(LocalMatchCommand command)
        {
            var sequence = NextSequence(LocalEntityId);
            simulation.SubmitIntent(
                LocalEntityId,
                PlayerIntent.Create(
                    sequence,
                    command.MoveX,
                    command.MoveZ,
                    command.AimX,
                    command.AimZ,
                    command.Attack,
                    null,
                    command.CastActive,
                    command.Interact));
        }

        private int NextSequence(int entityId)
        {
            var next = checked(sequences[entityId] + 1);
            sequences[entityId] = next;
            return next;
        }
    }
}
