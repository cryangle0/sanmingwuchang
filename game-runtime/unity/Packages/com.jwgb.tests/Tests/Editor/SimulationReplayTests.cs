using System;
using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class SimulationReplayTests
    {
        [Test]
        public void ReplaysStaticGeometryAcceptedInputsAndLateJoins()
        {
            var solids = new[]
            {
                new StaticSolidRect(
                    "replay-wall",
                    30_000,
                    31_000,
                    -1_000,
                    1_000)
            };
            var simulation = new GameSimulation(
                0x1a7e,
                solids,
                true);
            var attacker = AddPlayer(
                simulation,
                "late-join-attacker",
                GameplayIds.IronFanPrincess,
                0,
                0);
            var target = AddPlayer(
                simulation,
                "late-join-target",
                GameplayIds.BullDemonKing,
                12_000,
                0);
            Assert.That(
                simulation.SubmitIntent(
                    attacker,
                    PlayerIntent.Create(
                        1,
                        0,
                        0,
                        attack: true,
                        targetEntityId: target)),
                Is.True);
            Assert.That(
                simulation.SubmitIntent(
                    attacker,
                    PlayerIntent.Create(1, 1_000, 0)),
                Is.False);

            simulation.Step();
            Assert.That(
                simulation.GetSnapshot().Projectiles,
                Has.Length.EqualTo(1));
            var latePlayer = AddPlayer(
                simulation,
                "late-join-player",
                GameplayIds.SunWukong,
                -10_000,
                0);
            Assert.That(latePlayer, Is.GreaterThan(3));
            Assert.That(
                simulation.SubmitIntent(
                    latePlayer,
                    PlayerIntent.Create(
                        1,
                        750,
                        250,
                        targetEntityId: target)),
                Is.True);
            simulation.Step(12);

            var tape = simulation.ExportReplay();
            Assert.That(tape.StaticSolids, Has.Length.EqualTo(1));
            Assert.That(tape.Roster, Has.Length.EqualTo(3));
            Assert.That(tape.Inputs, Has.Length.EqualTo(2));
            Assert.That(tape.Checkpoints, Has.Length.GreaterThan(1));
            Assert.That(tape.FinalTick, Is.EqualTo(13));

            var result = SimulationReplayRunner.Verify(tape);
            Assert.That(
                result.IsMatch,
                Is.True,
                FormatDrift(result.FirstDrift));
            Assert.That(
                result.Simulation.GetStateHash(),
                Is.EqualTo(tape.ExpectedStateHash));
        }

        [Test]
        public void ReportsTheFirstCheckpointDrift()
        {
            var simulation = new GameSimulation(77, null, true);
            var entity = AddPlayer(
                simulation,
                "drift-player",
                GameplayIds.SunWukong,
                0,
                0);
            simulation.SubmitIntent(
                entity,
                PlayerIntent.Create(1, 1_000, 0));
            simulation.Step(5);

            var tape = simulation.ExportReplay();
            var checkpoint = Array.Find(
                tape.Checkpoints,
                entry => entry.Tick == 2);
            Assert.That(checkpoint, Is.Not.Null);
            checkpoint.StateHash = "00000000";

            var result = SimulationReplayRunner.Verify(tape);
            Assert.That(result.IsMatch, Is.False);
            Assert.That(result.FirstDrift.Tick, Is.EqualTo(2));
            Assert.That(
                result.FirstDrift.Reason,
                Is.EqualTo("checkpoint"));
            Assert.That(
                result.FirstDrift.ExpectedStateHash,
                Is.EqualTo("00000000"));
            Assert.That(
                result.FirstDrift.ActualStateHash,
                Is.Not.EqualTo("00000000"));
        }

        [Test]
        public void RejectsReplayExportAfterDirectDebugMutation()
        {
            var simulation = new GameSimulation(9);
            var entity = AddPlayer(
                simulation,
                "debug-damage-player",
                GameplayIds.SunWukong,
                0,
                0);
            simulation.Damage(entity, 1);

            Assert.That(
                () => simulation.ExportReplay(),
                Throws.InvalidOperationException);
        }

        [Test]
        public void ReplaysOneThousandCombatProcSeeds()
        {
            for (var rootSeed = 1; rootSeed <= 1_000; rootSeed += 1)
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
                simulation.Step(32);

                var result = SimulationReplayRunner.Verify(
                    simulation.ExportReplay());
                Assert.That(
                    result.IsMatch,
                    Is.True,
                    $"root seed {rootSeed}: {FormatDrift(result.FirstDrift)}");
            }
        }

        private static int AddPlayer(
            GameSimulation simulation,
            string playerId,
            string heroId,
            int positionX,
            int positionZ)
        {
            return simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = playerId,
                    HeroId = heroId,
                    HasPosition = true,
                    Position = new Int2Mm(positionX, positionZ)
                });
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
