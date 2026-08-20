using Jwgb.Content;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using Unity.Collections;

namespace Jwgb.Tests
{
    public sealed class MatchNetworkRuntimeStateTests
    {
        [SetUp]
        public void SetUp()
        {
            MatchNetworkRuntimeState.ResetProcessState();
            MatchNetworkRuntimeState.ConfigureServerRoster(
                new[]
                {
                    Player(1, GameplayIds.SunWukong),
                    Player(2, GameplayIds.IronFanPrincess),
                    Player(3, GameplayIds.BullDemonKing)
                });
        }

        [TearDown]
        public void TearDown()
        {
            MatchNetworkRuntimeState.ResetProcessState();
        }

        [Test]
        public void AssignsAnUnclaimedSlotWithTheRequestedHero()
        {
            var assigned = MatchNetworkRuntimeState.TryAssignPlayer(
                10,
                default,
                new FixedString32Bytes(
                    GameplayIds.IronFanPrincess),
                out var entityId,
                out _,
                out var assignedHeroId,
                out var resumed);

            Assert.That(assigned, Is.True);
            Assert.That(entityId, Is.EqualTo(2));
            Assert.That(
                assignedHeroId.ToString(),
                Is.EqualTo(GameplayIds.IronFanPrincess));
            Assert.That(resumed, Is.False);
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueAssignment(
                    out var assignment),
                Is.True);
            Assert.That(assignment.EntityId, Is.EqualTo(entityId));
            Assert.That(assignment.HeroId, Is.EqualTo(
                GameplayIds.IronFanPrincess));
            Assert.That(assignment.ApplyHero, Is.True);
        }

        [Test]
        public void AssignsAnyCatalogHeroToAnAvailableServerSlot()
        {
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    10,
                    default,
                    new FixedString32Bytes(
                        "H038"),
                    out var entityId,
                    out _,
                    out var assignedHeroId,
                    out _),
                Is.True);
            Assert.That(entityId, Is.EqualTo(1));
            Assert.That(
                assignedHeroId.ToString(),
                Is.EqualTo("H038"));
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueAssignment(
                    out var assignment),
                Is.True);
            Assert.That(assignment.HeroId, Is.EqualTo("H038"));
            Assert.That(assignment.ApplyHero, Is.True);
        }

        [Test]
        public void RejectsJoinOnlyAfterEveryServerSlotIsClaimed()
        {
            for (var networkId = 10; networkId < 13; networkId += 1)
            {
                Assert.That(
                    MatchNetworkRuntimeState.TryAssignPlayer(
                        networkId,
                        default,
                        new FixedString32Bytes("H038"),
                        out _,
                        out _,
                        out _,
                        out _),
                    Is.True);
            }

            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    13,
                    default,
                    new FixedString32Bytes(
                        "H038"),
                    out _,
                    out _,
                    out _,
                    out _),
                Is.False);
        }

        [Test]
        public void ReconnectRestoresTheOriginalHeroAndEntity()
        {
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    10,
                    default,
                    new FixedString32Bytes(
                        GameplayIds.BullDemonKing),
                    out var originalEntityId,
                    out var ticket,
                    out _,
                    out _),
                Is.True);
            MatchNetworkRuntimeState.ReleasePlayer(10);

            var resumed = MatchNetworkRuntimeState.TryAssignPlayer(
                11,
                ticket,
                new FixedString32Bytes(
                    GameplayIds.IronFanPrincess),
                out var resumedEntityId,
                out _,
                out var resumedHeroId,
                out var resumedSession);

            Assert.That(resumed, Is.True);
            Assert.That(resumedSession, Is.True);
            Assert.That(resumedEntityId, Is.EqualTo(originalEntityId));
            Assert.That(
                resumedHeroId.ToString(),
                Is.EqualTo(GameplayIds.BullDemonKing));
        }

        [Test]
        public void RecordsReplicatedPveGhostCountsInThePeak()
        {
            MatchNetworkRuntimeState.RecordReplicatedGhosts(
                1,
                30,
                2,
                1,
                123,
                4,
                6,
                240);

            Assert.That(
                MatchNetworkRuntimeState.ReplicatedMonsterGhostCount,
                Is.EqualTo(123));
            Assert.That(
                MatchNetworkRuntimeState.ReplicatedLootGhostCount,
                Is.EqualTo(4));
            Assert.That(
                MatchNetworkRuntimeState.ReplicatedShopGhostCount,
                Is.EqualTo(6));
            Assert.That(
                MatchNetworkRuntimeState.ReplicatedGhostSnapshotTick,
                Is.EqualTo(240));
            Assert.That(
                MatchNetworkRuntimeState.PeakReplicatedGhostCount,
                Is.EqualTo(1 + 30 + 2 + 1 + 123 + 4 + 6));
        }

        [Test]
        public void RecordsClientGhostSnapshotMapAndPveSummary()
        {
            MatchNetworkRuntimeState.RecordClientGhostSnapshot(
                1,
                30,
                0,
                0,
                123,
                2,
                6,
                mapEnabled: true,
                mapGeometryHash: "dc80a9ec2b7b9ff4",
                pveEnabled: true,
                stormRadiusMm: 260_000,
                snapshotTick: 120,
                state: default);

            Assert.That(
                MatchNetworkRuntimeState.ClientMonsterGhostCount,
                Is.EqualTo(123));
            Assert.That(
                MatchNetworkRuntimeState.ClientLootGhostCount,
                Is.EqualTo(2));
            Assert.That(
                MatchNetworkRuntimeState.ClientShopGhostCount,
                Is.EqualTo(6));
            Assert.That(
                MatchNetworkRuntimeState.ClientMapEnabled,
                Is.True);
            Assert.That(
                MatchNetworkRuntimeState.ClientMapGeometryHash,
                Is.EqualTo("dc80a9ec2b7b9ff4"));
            Assert.That(
                MatchNetworkRuntimeState.ClientPveEnabled,
                Is.True);
            Assert.That(
                MatchNetworkRuntimeState.ClientStormRadiusMm,
                Is.EqualTo(260_000));
            Assert.That(
                MatchNetworkRuntimeState.ClientCompleteSnapshotCount,
                Is.EqualTo(1));
        }

        private static PlayerSnapshot Player(
            int entityId,
            string heroId)
        {
            return new PlayerSnapshot
            {
                EntityId = entityId,
                PlayerId = $"player-{entityId}",
                HeroId = heroId
            };
        }
    }
}
