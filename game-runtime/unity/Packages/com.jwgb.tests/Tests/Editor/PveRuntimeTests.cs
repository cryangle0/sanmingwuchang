using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class PveRuntimeTests
    {
        [Test]
        public void DemoPopulationSpawnsAndDropsCanBeCollected()
        {
            var simulation = new GameSimulation(
                new GameSimulationOptions
                {
                    RootSeed = 0x4d31,
                    PveEnabled = true,
                    PvePopulation = PvePopulation.Demo
                });
            var initial = simulation.GetSnapshot();
            Assert.That(initial.Monsters, Has.Length.EqualTo(8));
            var spawnEvents = 0;
            foreach (var value in simulation.DrainEvents())
            {
                if (value.Type == "monster-spawned")
                {
                    spawnEvents += 1;
                }
            }
            Assert.That(spawnEvents, Is.EqualTo(8));

            var monster = initial.Monsters[0];
            var player = simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = "pve-hunter",
                    HeroId = GameplayIds.SunWukong,
                    HasPosition = true,
                    Position = monster.Position
                });
            simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = "pve-observer",
                    HeroId = GameplayIds.IronFanPrincess,
                    HasPosition = true,
                    Position = new Jwgb.Core.Int2Mm(0, 0)
                });
            simulation.DrainEvents();
            simulation.SubmitIntent(
                player,
                PlayerIntent.Create(
                    1,
                    0,
                    0,
                    attack: true,
                    targetEntityId: monster.EntityId));
            simulation.Step(150);

            var killed = false;
            foreach (var value in simulation.DrainEvents())
            {
                if (value.Type == "monster-killed")
                {
                    killed = true;
                }
            }

            Assert.That(killed, Is.True);
            Assert.That(simulation.GetSnapshot().LootDrops, Is.Not.Empty);
            simulation.SubmitIntent(
                player,
                PlayerIntent.Create(2, 0, 0, interact: true));
            simulation.Step();
            var playerSnapshot = simulation.GetSnapshot().Players[0];
            Assert.That(playerSnapshot.Gold, Is.GreaterThan(500));
            Assert.That(playerSnapshot.Experience, Is.GreaterThan(0));
        }

        [Test]
        public void FullMapPopulationUsesTheAuthoritativeCatalog()
        {
            var simulation = new GameSimulation(
                new GameSimulationOptions
                {
                    RootSeed = 77,
                    MapEnabled = true,
                    PveEnabled = true,
                    PvePopulation = PvePopulation.Full
                });
            var snapshot = simulation.GetSnapshot();
            Assert.That(snapshot.MapGeometryHash,
                Is.EqualTo(MapGeometryCatalog.GeometryHash));
            Assert.That(snapshot.Monsters, Has.Length.EqualTo(123));
            Assert.That(snapshot.Monsters[0].Position.X,
                Is.Not.EqualTo(0));
            Assert.That(snapshot.RootSeed, Is.EqualTo(77u));
        }

        [Test]
        public void MapDragonsUseTheElementOfTheirSelectedPalace()
        {
            var expectedByPosition =
                new System.Collections.Generic.Dictionary<Int2Mm, string>
                {
                    [new Int2Mm(153000, 229200)] = "metal",
                    [new Int2Mm(288900, 106600)] = "wood",
                    [new Int2Mm(-228100, -74600)] = "water",
                    [new Int2Mm(-100200, -165200)] = "fire",
                    [new Int2Mm(200900, -154600)] = "earth"
                };

            for (var rootSeed = 0; rootSeed < 100; rootSeed += 1)
            {
                var simulation = new GameSimulation(
                    new GameSimulationOptions
                    {
                        RootSeed = rootSeed,
                        MapEnabled = true,
                        PveEnabled = true,
                        PvePopulation = PvePopulation.Full
                    });
                var dragons = System.Array.FindAll(
                    simulation.GetSnapshot().Monsters,
                    monster => monster.Kind == "dragon-king");
                Assert.That(
                    dragons,
                    Has.Length.EqualTo(2),
                    $"root seed {rootSeed}");
                for (var index = 0; index < dragons.Length; index += 1)
                {
                    Assert.That(
                        expectedByPosition.TryGetValue(
                            dragons[index].HomePosition,
                            out var expectedElement),
                        Is.True,
                        $"root seed {rootSeed}");
                    Assert.That(
                        dragons[index].Element,
                        Is.EqualTo(expectedElement),
                        $"root seed {rootSeed}");
                }
            }
        }
    }
}
