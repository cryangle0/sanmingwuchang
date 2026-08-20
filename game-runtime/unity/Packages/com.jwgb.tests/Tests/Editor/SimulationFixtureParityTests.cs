using System;
using System.Collections.Generic;
using System.IO;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using UnityEngine;

namespace Jwgb.Tests
{
    public sealed class SimulationFixtureParityTests
    {
        private SimulationFixtureDocument fixture;

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
                    "sim-v1.json"));
            Assert.That(File.Exists(fixturePath), Is.True, fixturePath);
            fixture = JsonUtility.FromJson<SimulationFixtureDocument>(
                File.ReadAllText(fixturePath));
        }

        [Test]
        public void DeterministicSliceMatchesEveryOracleAction()
        {
            Assert.That(fixture.schema, Is.EqualTo("jwgb.sim.fixture.v1"));
            Assert.That(
                fixture.ruleset,
                Is.EqualTo(SimulationConstants.RulesetVersion));
            foreach (var scenario in fixture.scenarios)
            {
                RunScenario(scenario);
            }
        }

        [Test]
        [Explicit(
            "Debug aid: dumps the canonical hash JSON for diffing " +
            "against tools/migration/dump-sim-hash-input.ts.")]
        public void DumpInitialCanonicalHashJson()
        {
            foreach (var scenario in fixture.scenarios)
            {
                var simulation = CreateSimulation(scenario);
                AddRoster(simulation, scenario);
                var outputPath = Path.GetFullPath(
                    Path.Combine(
                        Application.dataPath,
                        "..",
                        "..",
                        "artifacts",
                        $"sim-hash-{scenario.name}.json"));
                Directory.CreateDirectory(
                    Path.GetDirectoryName(outputPath));
                File.WriteAllText(
                    outputPath,
                    simulation.GetStateHashCanonicalJson());
            }
        }

        private static void RunScenario(SimulationFixtureScenario scenario)
        {
            var simulation = CreateSimulation(scenario);
            AddRoster(simulation, scenario);
            Assert.That(
                simulation.GetStateHash(),
                Is.EqualTo(scenario.initialStateHash),
                $"{scenario.name}: initial state");

            for (var index = 0; index < scenario.actions.Length; index += 1)
            {
                var action = scenario.actions[index];
                Execute(simulation, action, scenario.name, index);
                Assert.That(
                    simulation.GetStateHash(),
                    Is.EqualTo(action.expectedStateHash),
                    $"{scenario.name}: action {index} ({action.kind})");
            }

            var events = simulation.DrainEvents();
            if (scenario.verifyEvents)
            {
                AssertEvents(
                    scenario.name,
                    scenario.expectedEvents,
                    events);
            }
        }

        private static GameSimulation CreateSimulation(
            SimulationFixtureScenario scenario)
        {
            return new GameSimulation(
                new GameSimulationOptions
                {
                    RootSeed = scenario.rootSeed,
                    StaticSolids =
                        BuildSolids(scenario.staticSolids).ToArray(),
                    MapEnabled = scenario.mapEnabled,
                    PveEnabled = scenario.pveEnabled,
                    PvePopulation = scenario.pvePopulation == "full"
                        ? PvePopulation.Full
                        : PvePopulation.Demo
                });
        }

        private static List<StaticSolidRect> BuildSolids(
            SimulationSolidFixture[] fixtures)
        {
            var solids = new List<StaticSolidRect>(fixtures.Length);
            for (var index = 0; index < fixtures.Length; index += 1)
            {
                var solid = fixtures[index];
                solids.Add(
                    new StaticSolidRect(
                        solid.solidId,
                        solid.minimumX,
                        solid.maximumX,
                        solid.minimumZ,
                        solid.maximumZ));
            }

            return solids;
        }

        private static void AddRoster(
            GameSimulation simulation,
            SimulationFixtureScenario scenario)
        {
            for (var index = 0; index < scenario.roster.Length; index += 1)
            {
                var entry = scenario.roster[index];
                var passives =
                    new PassiveLoadoutEntry[entry.passives.Length];
                for (var passiveIndex = 0;
                    passiveIndex < passives.Length;
                    passiveIndex += 1)
                {
                    var passive = entry.passives[passiveIndex];
                    passives[passiveIndex] = new PassiveLoadoutEntry(
                        passive.passiveId,
                        passive.level);
                }

                var actualEntityId = simulation.AddPlayer(
                    new AddPlayerOptions
                    {
                        PlayerId = entry.playerId,
                        HeroId = entry.heroId,
                        HasPosition = entry.hasPosition,
                        Position = new Int2Mm(
                            entry.position.x,
                            entry.position.z),
                        ActiveAbilityId = entry.activeAbilityId,
                        Passives = passives,
                        EquipmentIds = entry.equipmentIds
                    });
                Assert.That(
                    actualEntityId,
                    Is.EqualTo(entry.entityId),
                    $"{scenario.name}: roster {index}");
            }
        }

        private static void Execute(
            GameSimulation simulation,
            SimulationActionFixture action,
            string scenarioName,
            int actionIndex)
        {
            switch (action.kind)
            {
                case "intent":
                    var accepted = simulation.SubmitIntent(
                        action.entityId,
                        PlayerIntent.Create(
                            action.sequence,
                            action.moveX,
                            action.moveZ,
                            action.aimX,
                            action.aimZ,
                            action.attack,
                            action.targetEntityId == 0
                                ? null
                                : action.targetEntityId,
                            action.castActive,
                            action.interact));
                    Assert.That(
                        accepted,
                        Is.EqualTo(action.expectedAccepted),
                        $"{scenarioName}: action {actionIndex} accepted");
                    break;
                case "damage":
                    var applied = simulation.Damage(
                        action.entityId,
                        action.amount,
                        action.sourceEntityId == 0
                            ? null
                            : action.sourceEntityId,
                        ParseDamageForm(action.damageForm));
                    Assert.That(
                        applied,
                        Is.EqualTo(action.expectedAppliedDamage),
                        $"{scenarioName}: action {actionIndex} damage");
                    break;
                case "hard-control":
                    var controlled = simulation.HardControl(
                        action.entityId,
                        action.durationTicks);
                    Assert.That(
                        controlled,
                        Is.EqualTo(action.expectedAccepted),
                        $"{scenarioName}: action {actionIndex} control");
                    break;
                case "step":
                    simulation.Step(
                        action.stepCount > 0 ? action.stepCount : 1);
                    break;
                case "transaction":
                    var code = ExecuteTransaction(simulation, action);
                    Assert.That(
                        code,
                        Is.EqualTo(action.expectedCode),
                        $"{scenarioName}: action {actionIndex} " +
                        $"({action.op}) code");
                    break;
                default:
                    throw new InvalidOperationException(
                        $"Unknown fixture action {action.kind}.");
            }
        }


        private static string ExecuteTransaction(
            GameSimulation simulation,
            SimulationActionFixture action)
        {
            switch (action.op)
            {
                case "hero-swap":
                    return simulation.StartHeroSwapResult(
                        action.entityId,
                        action.shopId,
                        action.version,
                        action.heroId);
                case "gamble-gold":
                    return simulation.GambleGoldResult(
                        action.entityId,
                        action.shopId,
                        action.version,
                        action.wagerGold,
                        string.IsNullOrEmpty(action.mode)
                            ? "double"
                            : action.mode);
                case "gamble-passive":
                    return simulation.GamblePassiveResult(
                        action.entityId,
                        action.shopId,
                        action.version,
                        action.passiveId);
                case "gamble-active":
                    return simulation.GambleActiveResult(
                        action.entityId,
                        action.shopId,
                        action.version);
                case "gamble-equipment":
                    return simulation.GambleEquipmentResult(
                        action.entityId,
                        action.shopId,
                        action.version,
                        action.instanceId);
                case "pickup-equipment":
                    return simulation.PickupEquipmentLootResult(
                        action.entityId,
                        action.lootEntityId,
                        action.destination,
                        action.instanceId == 0
                            ? (int?)null
                            : action.instanceId);
                case "replace-active":
                    return simulation.ReplaceActiveLootResult(
                        action.entityId,
                        action.lootEntityId,
                        action.confirm);
                default:
                    throw new InvalidOperationException(
                        $"Unknown transaction op {action.op}.");
            }
        }

        private static DamageForm ParseDamageForm(string value)
        {
            return value switch
            {
                "basic" => DamageForm.Basic,
                "skill" => DamageForm.Skill,
                "dot" => DamageForm.Dot,
                "percent" => DamageForm.Percent,
                "reflect" => DamageForm.Reflect,
                "true" => DamageForm.True,
                "storm" => DamageForm.Storm,
                _ => throw new ArgumentOutOfRangeException(nameof(value))
            };
        }

        private static void AssertEvents(
            string scenarioName,
            SimulationEventFixture[] expected,
            SimEvent[] actual)
        {
            Assert.That(
                actual.Length,
                Is.EqualTo(expected.Length),
                $"{scenarioName}: event count");
            for (var index = 0; index < expected.Length; index += 1)
            {
                AssertEvent(
                    scenarioName,
                    index,
                    expected[index],
                    actual[index]);
            }
        }

        private static void AssertEvent(
            string scenarioName,
            int index,
            SimulationEventFixture expected,
            SimEvent actual)
        {
            var label = $"{scenarioName}: event {index} ({expected.type})";
            Assert.That(actual.Type, Is.EqualTo(expected.type), label);
            Assert.That(actual.Tick, Is.EqualTo(expected.tick), label);
            Assert.That(
                actual.EntityId,
                Is.EqualTo(expected.entityId),
                label);
            Assert.That(
                actual.SourceEntityId ?? 0,
                Is.EqualTo(expected.sourceEntityId),
                label);
            Assert.That(
                actual.TargetEntityId,
                Is.EqualTo(expected.targetEntityId),
                label);
            Assert.That(
                actual.ProjectileEntityId,
                Is.EqualTo(expected.projectileEntityId),
                label);
            Assert.That(
                actual.WallEntityId,
                Is.EqualTo(expected.wallEntityId),
                label);
            Assert.That(
                actual.PlayerId ?? string.Empty,
                Is.EqualTo(expected.playerId),
                label);
            Assert.That(
                actual.HeroId ?? string.Empty,
                Is.EqualTo(expected.heroId),
                label);
            Assert.That(
                actual.CompetitorCount,
                Is.EqualTo(expected.competitorCount),
                label);
            Assert.That(
                actual.TrueDeaths,
                Is.EqualTo(expected.trueDeaths),
                label);
            Assert.That(
                actual.LivesRemaining,
                Is.EqualTo(expected.livesRemaining),
                label);
            Assert.That(actual.Amount, Is.EqualTo(expected.amount), label);
            Assert.That(
                actual.ShieldDamage,
                Is.EqualTo(expected.shieldDamage),
                label);
            Assert.That(
                actual.HpDamage,
                Is.EqualTo(expected.hpDamage),
                label);
            Assert.That(
                actual.ShieldBypassHpDamage,
                Is.EqualTo(expected.shieldBypassHpDamage),
                label);
            Assert.That(
                actual.RemainingHp,
                Is.EqualTo(expected.remainingHp),
                label);
            Assert.That(
                actual.RemainingShield,
                Is.EqualTo(expected.remainingShield),
                label);
            Assert.That(
                actual.Cause ?? string.Empty,
                Is.EqualTo(expected.cause),
                label);
            Assert.That(
                actual.Form ?? string.Empty,
                Is.EqualTo(expected.form),
                label);
            Assert.That(
                actual.IsCritical,
                Is.EqualTo(expected.isCritical),
                label);
            Assert.That(
                actual.Reason ?? string.Empty,
                Is.EqualTo(expected.reason),
                label);
            Assert.That(
                actual.Outcome ?? string.Empty,
                Is.EqualTo(expected.outcome),
                label);
            Assert.That(
                actual.WinnerEntityId ?? 0,
                Is.EqualTo(expected.winnerEntityId),
                label);
            Assert.That(
                actual.Placements ?? Array.Empty<int>(),
                Is.EqualTo(expected.placements),
                label);
            Assert.That(
                actual.ActiveAbilityId ?? string.Empty,
                Is.EqualTo(expected.activeAbilityId),
                label);
            Assert.That(
                actual.ActiveName ?? string.Empty,
                Is.EqualTo(expected.activeName),
                label);
            Assert.That(
                actual.PassiveId ?? string.Empty,
                Is.EqualTo(expected.passiveId),
                label);
            Assert.That(
                actual.CriticalDamagePercent,
                Is.EqualTo(expected.criticalDamagePercent),
                label);
            Assert.That(
                actual.ShieldBypassPercent,
                Is.EqualTo(expected.shieldBypassPercent),
                label);
            Assert.That(
                actual.DurationTicks,
                Is.EqualTo(expected.durationTicks),
                label);
            Assert.That(
                actual.ProjectileKind ?? string.Empty,
                Is.EqualTo(expected.projectileKind),
                label);
            if (expected.hasPosition)
            {
                Assert.That(
                    actual.Position.X,
                    Is.EqualTo(expected.position.x),
                    label);
                Assert.That(
                    actual.Position.Z,
                    Is.EqualTo(expected.position.z),
                    label);
            }
            Assert.That(
                actual.PreviousPosition.X,
                Is.EqualTo(expected.previousPosition.x),
                label);
            Assert.That(
                actual.PreviousPosition.Z,
                Is.EqualTo(expected.previousPosition.z),
                label);
            Assert.That(
                actual.NewPosition.X,
                Is.EqualTo(expected.newPosition.x),
                label);
            Assert.That(
                actual.NewPosition.Z,
                Is.EqualTo(expected.newPosition.z),
                label);
            Assert.That(
                actual.RequestedDistanceMm,
                Is.EqualTo(expected.requestedDistanceMm),
                label);
            Assert.That(
                actual.ActualDistanceMm,
                Is.EqualTo(expected.actualDistanceMm),
                label);
            Assert.That(
                actual.BlockingSolidId ?? string.Empty,
                Is.EqualTo(expected.blockingSolidId),
                label);
            Assert.That(
                actual.Protection ?? string.Empty,
                Is.EqualTo(expected.protection),
                label);
            Assert.That(
                actual.HpRestored,
                Is.EqualTo(expected.hpRestored),
                label);
            Assert.That(
                actual.DidBlink,
                Is.EqualTo(expected.didBlink),
                label);
            Assert.That(
                actual.BuffTicks,
                Is.EqualTo(expected.buffTicks),
                label);
            Assert.That(
                actual.ConsumedEquipmentInstanceId,
                Is.EqualTo(expected.consumedEquipmentInstanceId),
                label);
            Assert.That(
                actual.InvulnerableTicks,
                Is.EqualTo(expected.invulnerableTicks),
                label);
        }
    }
}
