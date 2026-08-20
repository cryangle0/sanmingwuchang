using Jwgb.Client;
using Jwgb.Content;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class MapModeSessionTests
    {
        private const long Seed = 20260803;
        private const int Competitors = 8;
        private const int Ticks = 60;

        [Test]
        public void MapModeSessionMatchesDirectSimulationStateHash()
        {
            var session = new LocalMatchSession(
                Seed,
                Competitors,
                null,
                mapEnabled: true,
                pveEnabled: true);
            var direct = new GameSimulation(
                new GameSimulationOptions
                {
                    RootSeed = Seed,
                    MapEnabled = true,
                    PveEnabled = true,
                    PvePopulation = PvePopulation.Full
                });
            var entityIds = M1MatchRoster.AddCompetitors(
                direct,
                Competitors,
                "local",
                null);
            var sequences = new int[entityIds.Length];

            var command = new LocalMatchCommand(
                0,
                0,
                1_000,
                0,
                attack: false,
                castActive: false);
            for (var tick = 0; tick < Ticks; tick += 1)
            {
                var planning = direct.GetSnapshot();
                sequences[0] += 1;
                direct.SubmitIntent(
                    entityIds[0],
                    PlayerIntent.Create(
                        sequences[0],
                        command.MoveX,
                        command.MoveZ,
                        command.AimX,
                        command.AimZ,
                        command.Attack,
                        null,
                        command.CastActive));
                for (var index = 1;
                    index < entityIds.Length;
                    index += 1)
                {
                    sequences[index] += 1;
                    direct.SubmitIntent(
                        entityIds[index],
                        BotIntentPlanner.Create(
                            planning,
                            entityIds[index],
                            sequences[index]));
                }
                direct.Step();
                session.Step(command);
            }

            Assert.That(session.Snapshot.Tick, Is.EqualTo(Ticks));
            Assert.That(
                session.StateHash,
                Is.EqualTo(direct.GetStateHash()));
        }

        [Test]
        public void MapModeSessionSpawnsFullPvePopulation()
        {
            var session = new LocalMatchSession(
                Seed,
                Competitors,
                null,
                mapEnabled: true,
                pveEnabled: true);

            Assert.That(session.MapEnabled, Is.True);
            Assert.That(session.PveEnabled, Is.True);
            Assert.That(
                session.Snapshot.MapGeometryHash,
                Is.EqualTo(MapGeometryCatalog.GeometryHash));
            Assert.That(
                session.Snapshot.Monsters.Length,
                Is.GreaterThan(8));
            Assert.That(session.Snapshot.StormZone, Is.Not.Null);
            Assert.That(
                session.Snapshot.StormZone.RadiusMm,
                Is.GreaterThan(0));
        }

        [Test]
        public void ClassicModeSessionRemainsAvailable()
        {
            var session = new LocalMatchSession(
                Seed,
                Competitors,
                null,
                mapEnabled: false,
                pveEnabled: false);

            Assert.That(session.MapEnabled, Is.False);
            Assert.That(
                session.Snapshot.MapGeometryHash,
                Is.Null.Or.Empty);
            Assert.That(session.Snapshot.Monsters, Is.Empty);
        }
    }
}
