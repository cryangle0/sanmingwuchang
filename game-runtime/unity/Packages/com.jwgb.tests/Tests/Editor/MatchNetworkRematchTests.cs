using Jwgb.Client;
using Jwgb.Content;
using Jwgb.Netcode;
using Jwgb.Server;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using Unity.Collections;

namespace Jwgb.Tests
{
    public sealed class MatchNetworkRematchTests
    {
        [SetUp]
        public void SetUp()
        {
            MatchNetworkRuntimeState.ResetProcessState();
            MatchNetworkRuntimeState.ConfigureServerRoster(
                new[]
                {
                    Player(1, GameplayIds.SunWukong),
                    Player(2, GameplayIds.IronFanPrincess)
                });
        }

        [TearDown]
        public void TearDown()
        {
            MatchNetworkRuntimeState.ResetProcessState();
        }

        [Test]
        public void RematchStartsOnlyAfterEveryConnectedPlayerVotes()
        {
            Assign(10, "H038");
            Assign(11, GameplayIds.SunWukong);
            MatchNetworkRuntimeState.PublishServerSnapshot(
                FinishedSnapshot());

            Assert.That(
                MatchNetworkRuntimeState.RecordServerRematchVote(10),
                Is.True);
            Assert.That(
                MatchNetworkRuntimeState.IsServerRematchReady,
                Is.False);
            Assert.That(
                MatchNetworkRuntimeState.RecordServerRematchVote(11),
                Is.True);
            Assert.That(
                MatchNetworkRuntimeState.IsServerRematchReady,
                Is.True);
        }

        [Test]
        public void RematchRosterPreservesConnectedHeroesAndClaims()
        {
            Assign(10, "H038");
            Assign(11, GameplayIds.SunWukong);
            var connected = MatchNetworkRuntimeState
                .CaptureConnectedPlayersForRematch();

            Assert.That(connected, Has.Length.EqualTo(2));
            Assert.That(connected[0].HeroId, Is.EqualTo("H038"));
            MatchNetworkRuntimeState.ConfigureServerRematchRoster(
                new[]
                {
                    Player(1, "H038"),
                    Player(2, GameplayIds.SunWukong)
                });

            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    12,
                    default,
                    new FixedString32Bytes(GameplayIds.BullDemonKing),
                    out _,
                    out _,
                    out _,
                    out _),
                Is.False);
            Assert.That(
                MatchNetworkRuntimeState.ServerRematchVoteCount,
                Is.Zero);
        }

        [Test]
        public void FinishedMatchRejectsNewJoinButKeepsRematchRoster()
        {
            MatchNetworkRuntimeState.PublishServerSnapshot(
                FinishedSnapshot());

            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    12,
                    default,
                    new FixedString32Bytes("H038"),
                    out _,
                    out _,
                    out _,
                    out _),
                Is.False);
        }

        [Test]
        public void ClientRematchQueueIsOneShotAndMatchScoped()
        {
            MatchNetworkRuntimeState.RecordClientAccepted(
                1,
                0,
                0,
                new FixedString64Bytes("ticket"),
                new FixedString32Bytes("H038"),
                resumedSession: false);

            MatchNetworkRuntimeState.QueueClientRematch();

            Assert.That(
                MatchNetworkRuntimeState.TryConsumeClientRematch(
                    out var sequence),
                Is.True);
            Assert.That(sequence, Is.EqualTo(1));
            Assert.That(
                MatchNetworkRuntimeState.TryConsumeClientRematch(
                    out _),
                Is.False);

            MatchNetworkRuntimeState.QueueClientRematch();
            MatchNetworkRuntimeState.ResetClientMatchScopedState();
            Assert.That(
                MatchNetworkRuntimeState.TryConsumeClientRematch(
                    out _),
                Is.False);
        }

        [TestCase(120, 2, true)]
        [TestCase(120, 120, false)]
        [TestCase(120, 121, false)]
        [TestCase(0, 2, false)]
        public void ClientDetectsOnlyBackwardPositiveTickAsNewMatch(
            int previousTick,
            int incomingTick,
            bool expected)
        {
            Assert.That(
                NetworkMatchRuntime.IsNewMatchTick(
                    previousTick,
                    incomingTick),
                Is.EqualTo(expected));
        }

        [Test]
        public void SmokeFinishUsesRealLifeAndMatchSystems()
        {
            var session = new AuthoritativeMatchSession(
                20260724,
                competitorCount: 2,
                mapEnabled: false,
                pveEnabled: false);
            session.Step();

            session.FinishForSmoke();

            Assert.That(
                session.Snapshot.Match.Status,
                Is.EqualTo(MatchStatus.Finished));
            Assert.That(
                session.Snapshot.Match.WinnerEntityId,
                Is.EqualTo(session.Snapshot.Players[0].EntityId));
        }

        private static void Assign(int networkId, string heroId)
        {
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    networkId,
                    default,
                    new FixedString32Bytes(heroId),
                    out _,
                    out _,
                    out _,
                    out _),
                Is.True);
        }

        private static WorldSnapshot FinishedSnapshot()
        {
            return new WorldSnapshot
            {
                Tick = 120,
                Match = new MatchSnapshot
                {
                    Status = MatchStatus.Finished,
                    FinishedAtTick = 120
                }
            };
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
