using Jwgb.Client;
using Jwgb.Netcode;
using NUnit.Framework;
using Unity.Collections;

namespace Jwgb.Tests
{
    public sealed class NetworkGhostSnapshotReaderTests
    {
        [Test]
        public void MonsterReaderPreservesElementForModelSelection()
        {
            var snapshot = NetworkPveGhostReaders.CreateMonster(
                new MatchMonsterGhostState
                {
                    SnapshotTick = 20,
                    EntityId = 121,
                    Kind = new FixedString32Bytes("dragon-king"),
                    Element = new FixedString32Bytes("water"),
                    PositionX = 100,
                    PositionZ = 200,
                    FacingZ = 1_000,
                    Hp = 900,
                    MaxHp = 1_000
                });

            Assert.That(snapshot.Kind, Is.EqualTo("dragon-king"));
            Assert.That(snapshot.Element, Is.EqualTo("water"));
        }

        [Test]
        public void LootReaderPreservesReplacementRuntimeFields()
        {
            var snapshot = NetworkPveGhostReaders.CreateLoot(
                new MatchLootGhostState
                {
                    SnapshotTick = 20,
                    EntityId = 91,
                    PositionX = 1_250,
                    PositionZ = -750,
                    EquipmentId =
                        new FixedString64Bytes("equipment-4"),
                    ActiveId = new FixedString64Bytes("active-9"),
                    CreatedAtTick = 12,
                    ExpiresAtTick = 480,
                    Kind = new FixedString32Bytes("equipment"),
                    HasEquipmentInstanceId = true,
                    EquipmentInstanceId = 44,
                    HasAcquiredAtTick = true,
                    AcquiredAtTick = 11,
                    PermanentAttackBonus = 35,
                    HasStormCoveredSinceTick = true,
                    StormCoveredSinceTick = 18
                });

            Assert.That(snapshot.ActiveId, Is.EqualTo("active-9"));
            Assert.That(snapshot.EquipmentInstanceId, Is.EqualTo(44));
            Assert.That(snapshot.AcquiredAtTick, Is.EqualTo(11));
            Assert.That(snapshot.PermanentAttackBonus, Is.EqualTo(35));
            Assert.That(snapshot.CreatedAtTick, Is.EqualTo(12));
            Assert.That(snapshot.ExpiresAtTick, Is.EqualTo(480));
            Assert.That(
                snapshot.StormCoveredSinceTick,
                Is.EqualTo(18));
        }

        [Test]
        public void TransactionReadersPreservePendingReplacementIdentity()
        {
            var active =
                NetworkGhostSnapshotReaders.CreateActiveReplacement(
                    new MatchPendingActiveReplacementGhost
                    {
                        PlayerEntityId = 7,
                        LootEntityId = 80,
                        ActiveId =
                            new FixedString64Bytes("active-11"),
                        RequestedAtTick = 33
                    });
            var equipment =
                NetworkGhostSnapshotReaders.CreateEquipmentPickup(
                    new MatchPendingEquipmentPickupGhost
                    {
                        PlayerEntityId = 7,
                        LootEntityId = 81,
                        EquipmentId =
                            new FixedString64Bytes("equipment-8"),
                        HasEquipmentInstanceId = true,
                        EquipmentInstanceId = 45,
                        RequestedAtTick = 34
                    });

            Assert.That(active.PlayerEntityId, Is.EqualTo(7));
            Assert.That(active.ActiveId, Is.EqualTo("active-11"));
            Assert.That(active.LootEntityId, Is.EqualTo(80));
            Assert.That(equipment.PlayerEntityId, Is.EqualTo(7));
            Assert.That(
                equipment.EquipmentInstanceId,
                Is.EqualTo(45));
            Assert.That(equipment.LootEntityId, Is.EqualTo(81));
        }

        [Test]
        public void EquipmentReaderPreservesPermanentRuntimeBonus()
        {
            var equipment =
                NetworkGhostSnapshotReaders.CreateEquipment(
                    new MatchPlayerEquipmentGhost
                    {
                        InstanceId = 45,
                        EquipmentId =
                            new FixedString64Bytes("equipment-8"),
                        AcquiredAtTick = 21,
                        PermanentAttackBonus = 75
                    });

            Assert.That(equipment.InstanceId, Is.EqualTo(45));
            Assert.That(equipment.AcquiredAtTick, Is.EqualTo(21));
            Assert.That(
                equipment.PermanentAttackBonus,
                Is.EqualTo(75));
        }
    }
}
