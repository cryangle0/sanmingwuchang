using System.IO;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using UnityEngine;

namespace Jwgb.Tests
{
    public sealed class MatchFixtureParityTests
    {
        private MatchFixtureDocument fixture;

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
                    "match-v1.json"));
            Assert.That(File.Exists(fixturePath), Is.True, fixturePath);
            fixture = JsonUtility.FromJson<MatchFixtureDocument>(
                File.ReadAllText(fixturePath));
        }

        [Test]
        public void ReplaysTheFullBotMatchAgainstEveryCheckpoint()
        {
            Assert.That(
                fixture.schema,
                Is.EqualTo("jwgb.match.fixture.v1"));
            Assert.That(
                fixture.ruleset,
                Is.EqualTo(SimulationConstants.RulesetVersion));
            Assert.That(fixture.checkpoints, Has.Length.GreaterThan(1));
            Assert.That(fixture.inputs, Has.Length.GreaterThan(0));

            var result = SimulationReplayRunner.Verify(BuildTape(fixture));
            Assert.That(
                result.IsMatch,
                Is.True,
                FormatDrift(result.FirstDrift));

            var simulation = result.Simulation;
            Assert.That(simulation.Tick, Is.EqualTo(fixture.finalTick));
            Assert.That(
                simulation.GetStateHash(),
                Is.EqualTo(fixture.expectedStateHash));

            var match = simulation.GetSnapshot().Match;
            Assert.That(match.Status, Is.EqualTo(MatchStatus.Finished));
            Assert.That(fixture.outcome.outcome, Is.EqualTo("winner"));
            Assert.That(
                match.FinishedAtTick,
                Is.EqualTo(fixture.outcome.finishedAtTick));
            Assert.That(
                match.WinnerEntityId,
                Is.EqualTo(fixture.outcome.winnerEntityId));
            Assert.That(
                match.Placements,
                Is.EqualTo(fixture.outcome.placements));
        }

        internal static SimulationReplay BuildTape(
            MatchFixtureDocument document)
        {
            var solids =
                new StaticSolidRect[document.staticSolids.Length];
            for (var index = 0; index < solids.Length; index += 1)
            {
                var solid = document.staticSolids[index];
                solids[index] = new StaticSolidRect(
                    solid.solidId,
                    solid.minimumX,
                    solid.maximumX,
                    solid.minimumZ,
                    solid.maximumZ);
            }

            var roster =
                new ReplayRosterEntry[document.roster.Length];
            for (var index = 0; index < roster.Length; index += 1)
            {
                var entry = document.roster[index];
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

                roster[index] = new ReplayRosterEntry
                {
                    EntityId = entry.entityId,
                    JoinedAtTick = entry.joinedAtTick,
                    PlayerId = entry.playerId,
                    HeroId = entry.heroId,
                    ActiveAbilityId = entry.activeAbilityId,
                    HasPosition = entry.hasPosition,
                    Position = new Int2Mm(
                        entry.position.x,
                        entry.position.z),
                    Passives = passives,
                    EquipmentIds = entry.equipmentIds
                };
            }

            var inputs =
                new ReplayInputEntry[document.inputs.Length];
            for (var index = 0; index < inputs.Length; index += 1)
            {
                var entry = document.inputs[index];
                inputs[index] = new ReplayInputEntry
                {
                    AtTick = entry.atTick,
                    EntityId = entry.entityId,
                    Intent = PlayerIntent.Create(
                        entry.sequence,
                        entry.moveX,
                        entry.moveZ,
                        entry.aimX,
                        entry.aimZ,
                        entry.attack,
                        entry.targetEntityId == 0
                            ? (int?)null
                            : entry.targetEntityId,
                        entry.castActive,
                        entry.interact)
                };
            }

            var checkpoints =
                new ReplayCheckpoint[document.checkpoints.Length];
            for (var index = 0; index < checkpoints.Length; index += 1)
            {
                var entry = document.checkpoints[index];
                checkpoints[index] = new ReplayCheckpoint
                {
                    Tick = entry.tick,
                    StateHash = entry.stateHash
                };
            }

            return new SimulationReplay
            {
                RootSeed = document.rootSeed,
                StaticSolids = solids,
                MapEnabled = document.mapEnabled,
                PveEnabled = document.pveEnabled,
                PvePopulation = PvePopulation.Demo,
                Roster = roster,
                Inputs = inputs,
                Checkpoints = checkpoints,
                FinalTick = document.finalTick,
                ExpectedStateHash = document.expectedStateHash
            };
        }

        private static string FormatDrift(ReplayDrift drift)
        {
            return drift == null
                ? "no replay drift"
                : $"tick {drift.Tick}: {drift.Reason}; " +
                  $"expected {drift.ExpectedStateHash}, " +
                  $"actual {drift.ActualStateHash}";
        }
    }
}
