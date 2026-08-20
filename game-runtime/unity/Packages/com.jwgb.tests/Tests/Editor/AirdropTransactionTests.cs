using System;
using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class AirdropTransactionTests
    {
        [Test]
        public void AirdropOpenChannelsAndCompletesWithLoot()
        {
            var simulation = CreateSimulation(out var player);
            simulation.Step(7_200);
            var airdrop = FindAvailableAirdrop(simulation);
            MoveTo(simulation, player, airdrop.Position.Value);

            var start = simulation.ExecuteTransaction(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.AirdropOpen,
                    PlayerEntityId = player,
                    AirdropId = airdrop.Id
                });

            Assert.That(start.Accepted, Is.True);
            Assert.That(start.Snapshot.AirdropChannels, Has.Length.EqualTo(1));
            Assert.That(
                start.Snapshot.AirdropChannels[0].AirdropId,
                Is.EqualTo(airdrop.Id));

            simulation.Step(3 * SimulationConstants.TicksPerSecond);
            var completed = simulation.GetSnapshot();
            var opened = FindAirdrop(completed, airdrop.Id);

            Assert.That(opened.Phase, Is.EqualTo("opened"));
            Assert.That(completed.AirdropChannels, Is.Empty);
            Assert.That(opened.LootEntityId, Is.Not.Null);
            Assert.That(completed.LootDrops, Has.Length.EqualTo(1));
            Assert.That(completed.Players[0].Gold, Is.EqualTo(1_700));
        }

        [Test]
        public void AirdropChannelCancelsWhenPlayerTakesDamage()
        {
            var simulation = CreateSimulation(out var player);
            simulation.Step(7_200);
            var airdrop = FindAvailableAirdrop(simulation);
            MoveTo(simulation, player, airdrop.Position.Value);

            var start = simulation.ExecuteTransaction(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.AirdropOpen,
                    PlayerEntityId = player,
                    AirdropId = airdrop.Id
                });
            Assert.That(start.Accepted, Is.True);

            Assert.That(simulation.Damage(player, 1), Is.EqualTo(1));
            var cancelled = simulation.GetSnapshot();

            Assert.That(cancelled.AirdropChannels, Is.Empty);
            Assert.That(
                FindAirdrop(cancelled, airdrop.Id).Phase,
                Is.EqualTo("available"));
            var cancellationObserved = false;
            foreach (var value in simulation.DrainEvents())
            {
                if (value.Type == "airdrop-channel" &&
                    value.Outcome == "cancelled")
                {
                    cancellationObserved = true;
                    break;
                }
            }
            Assert.That(
                cancellationObserved,
                Is.True);
        }

        private static GameSimulation CreateSimulation(out int player)
        {
            var simulation = new GameSimulation(
                new GameSimulationOptions
                {
                    RootSeed = 20260806,
                    MapEnabled = false,
                    PveEnabled = false
                });
            player = simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = "airdrop-player",
                    HeroId = GameplayIds.SunWukong,
                    HasPosition = true,
                    Position = new Int2Mm(0, 0)
                });
            simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = "airdrop-observer",
                    HeroId = GameplayIds.IronFanPrincess,
                    HasPosition = true,
                    Position = new Int2Mm(-80_000, 0)
                });
            simulation.DrainEvents();
            return simulation;
        }

        private static AirdropSnapshot FindAvailableAirdrop(
            GameSimulation simulation)
        {
            foreach (var airdrop in simulation.GetSnapshot().Airdrops)
            {
                if (airdrop.Phase == "available")
                {
                    return airdrop;
                }
            }
            Assert.Fail("No available airdrop was created.");
            return null;
        }

        private static AirdropSnapshot FindAirdrop(
            WorldSnapshot snapshot,
            string airdropId)
        {
            foreach (var airdrop in snapshot.Airdrops)
            {
                if (airdrop.Id == airdropId)
                {
                    return airdrop;
                }
            }
            Assert.Fail($"Airdrop {airdropId} was not found.");
            return null;
        }

        private static void MoveTo(
            GameSimulation simulation,
            int playerEntityId,
            Int2Mm target)
        {
            var sequence = 0;
            for (var tick = 0; tick < 1_000; tick += 1)
            {
                var player = FindPlayer(
                    simulation.GetSnapshot(),
                    playerEntityId);
                var dx = target.X - player.Position.X;
                var dz = target.Z - player.Position.Z;
                if ((long)dx * dx + ((long)dz * dz) <= 1_500L * 1_500L)
                {
                    simulation.SubmitIntent(
                        playerEntityId,
                        PlayerIntent.Create(++sequence, 0, 0));
                    return;
                }

                var direction = IntegerMath.NormalizeAxisPair(dx, dz);
                simulation.SubmitIntent(
                    playerEntityId,
                    PlayerIntent.Create(
                        ++sequence,
                        direction.X,
                        direction.Z,
                        direction.X,
                        direction.Z));
                simulation.Step();
            }

            Assert.Fail("Player did not reach the airdrop.");
        }

        private static PlayerSnapshot FindPlayer(
            WorldSnapshot snapshot,
            int playerEntityId)
        {
            foreach (var player in snapshot.Players)
            {
                if (player.EntityId == playerEntityId)
                {
                    return player;
                }
            }
            throw new InvalidOperationException(
                $"Player {playerEntityId} was not found.");
        }
    }
}
