using System.IO;
using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using UnityEngine;

namespace Jwgb.Tests
{
    public sealed class SeedFixtureParityTests
    {
        private SeedFixtureDocument fixture;

        [OneTimeSetUp]
        public void LoadFixture()
        {
            var fixturePath = Path.GetFullPath(
                Path.Combine(
                    Application.dataPath,
                    "..",
                    "..",
                    "migration",
                    "fixtures",
                    "seeds-v1.json"));
            Assert.That(File.Exists(fixturePath), Is.True, fixturePath);
            fixture = JsonUtility.FromJson<SeedFixtureDocument>(
                File.ReadAllText(fixturePath));
        }

        [Test]
        public void MatchesTheOracleHashForOneThousandRootSeeds()
        {
            Assert.That(
                fixture.schema,
                Is.EqualTo("jwgb.seeds.fixture.v1"));
            Assert.That(
                fixture.ruleset,
                Is.EqualTo(SimulationConstants.RulesetVersion));
            Assert.That(fixture.seeds, Has.Length.EqualTo(1_000));

            foreach (var seed in fixture.seeds)
            {
                var simulation = RunScriptedCombat(
                    seed.rootSeed,
                    fixture.stepCount);
                Assert.That(
                    simulation.Tick,
                    Is.EqualTo(seed.finalTick),
                    $"root seed {seed.rootSeed}: final tick");
                Assert.That(
                    simulation.GetStateHash(),
                    Is.EqualTo(seed.finalStateHash),
                    $"root seed {seed.rootSeed}: final state hash");
            }
        }

        internal static GameSimulation RunScriptedCombat(
            int rootSeed,
            int stepCount)
        {
            var simulation = new GameSimulation(rootSeed);
            var attacker = simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = $"seed-{rootSeed}-attacker",
                    HeroId = GameplayIds.SunWukong,
                    HasPosition = true,
                    Position = new Int2Mm(0, 0),
                    Passives = new[]
                    {
                        new PassiveLoadoutEntry(
                            GameplayIds.Critical,
                            5)
                    },
                    EquipmentIds = new[]
                    {
                        GameplayIds.RefinedIronStaff,
                        GameplayIds.GoldenCudgel
                    }
                });
            var target = simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = $"seed-{rootSeed}-target",
                    HeroId = GameplayIds.BullDemonKing,
                    HasPosition = true,
                    Position = new Int2Mm(4_000, 0),
                    Passives = new[]
                    {
                        new PassiveLoadoutEntry(
                            GameplayIds.ReactiveShield,
                            5)
                    },
                    EquipmentIds = new[]
                    {
                        GameplayIds.CoarseClothArmor
                    }
                });
            simulation.SubmitIntent(
                attacker,
                PlayerIntent.Create(
                    1,
                    0,
                    0,
                    attack: true,
                    targetEntityId: target));
            simulation.Step(stepCount);
            return simulation;
        }
    }
}
