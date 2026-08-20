using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class SimulationTransactionTests
    {
        [Test]
        public void RejectedTransactionStillReturnsAuthoritativeSnapshot()
        {
            var simulation = CreateSimulation();
            var player = AddPlayer(
                simulation,
                "transaction-player",
                GameplayIds.SunWukong);

            var result = simulation.ExecuteTransaction(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.SpendGem,
                    PlayerEntityId = player,
                    PassiveId = GameplayIds.Critical
                });

            Assert.That(result.Accepted, Is.False);
            Assert.That(result.Code, Is.EqualTo("no-gems"));
            Assert.That(result.Snapshot, Is.Not.Null);
            Assert.That(
                result.Snapshot.StateHash,
                Is.EqualTo(simulation.GetStateHash()));
        }

        [Test]
        public void EquipmentUnequipAndDiscardAreVisibleInTransactionResults()
        {
            var simulation = CreateSimulation();
            var player = AddPlayer(
                simulation,
                "equipment-player",
                GameplayIds.SunWukong,
                GameplayIds.RefinedIronStaff);
            var equipped = FindPlayer(
                simulation.GetSnapshot(),
                player).Equipment[0];

            var unequip = simulation.ExecuteTransaction(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.EquipmentUnequip,
                    PlayerEntityId = player,
                    InstanceId = equipped.InstanceId
                });

            Assert.That(unequip.Accepted, Is.True);
            Assert.That(
                FindPlayer(unequip.Snapshot, player).Equipment,
                Is.Empty);
            Assert.That(
                FindPlayer(
                    unequip.Snapshot,
                    player).InventoryEquipment,
                Has.Length.EqualTo(1));

            var discard = simulation.ExecuteTransaction(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.EquipmentDiscard,
                    PlayerEntityId = player,
                    InstanceId = equipped.InstanceId
                });

            Assert.That(discard.Accepted, Is.True);
            Assert.That(discard.LootEntityId, Is.Not.Null);
            Assert.That(
                discard.Snapshot.LootDrops,
                Has.Length.EqualTo(1));
            Assert.That(
                discard.Snapshot.LootDrops[0].EntityId,
                Is.EqualTo(discard.LootEntityId.Value));
            Assert.That(
                discard.Snapshot.LootDrops[0].EquipmentId,
                Is.EqualTo(GameplayIds.RefinedIronStaff));
        }

        [Test]
        public void PassiveUpgradeWithoutGemReturnsSpecificRejectionCode()
        {
            var simulation = CreateSimulation();
            var player = simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = "maxed-passive-player",
                    HeroId = GameplayIds.SunWukong,
                    Passives = new[]
                    {
                        new PassiveLoadoutEntry(
                            GameplayIds.Critical,
                            5)
                    }
                });
            var result = simulation.ExecuteTransaction(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.SpendGem,
                    PlayerEntityId = player,
                    PassiveId = GameplayIds.Critical
                });

            Assert.That(result.Accepted, Is.False);
            Assert.That(result.Code, Is.EqualTo("no-gems"));
            Assert.That(
                result.Snapshot.Players[1].Passives[0].Level,
                Is.EqualTo(5));
        }

        private static GameSimulation CreateSimulation()
        {
            var simulation = new GameSimulation(
                new GameSimulationOptions
                {
                    RootSeed = 20260806,
                    MapEnabled = false,
                    PveEnabled = false
                });
            AddPlayer(
                simulation,
                "transaction-observer",
                GameplayIds.IronFanPrincess,
                hasPosition: true,
                position: new Int2Mm(-80_000, 0));
            return simulation;
        }

        private static int AddPlayer(
            GameSimulation simulation,
            string playerId,
            string heroId,
            string equipmentId = null,
            bool hasPosition = false,
            Int2Mm position = default)
        {
            return simulation.AddPlayer(
                new AddPlayerOptions
                {
                    PlayerId = playerId,
                    HeroId = heroId,
                    EquipmentIds = equipmentId == null
                        ? System.Array.Empty<string>()
                        : new[] { equipmentId },
                    HasPosition = hasPosition,
                    Position = position
                });
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

            Assert.Fail($"Player {playerEntityId} was not found.");
            return null;
        }
    }
}
