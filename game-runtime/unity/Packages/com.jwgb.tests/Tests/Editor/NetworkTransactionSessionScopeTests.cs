using Jwgb.Content;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using Unity.Collections;

namespace Jwgb.Tests
{
    public sealed class NetworkTransactionSessionScopeTests
    {
        [SetUp]
        public void SetUp()
        {
            MatchNetworkRuntimeState.ResetProcessState();
            MatchNetworkRuntimeState.ConfigureServerRoster(
                new[]
                {
                    Player(7, GameplayIds.SunWukong)
                });
        }

        [TearDown]
        public void TearDown()
        {
            MatchNetworkRuntimeState.ResetProcessState();
        }

        [Test]
        public void CompletedTransactionReplaysAfterReconnect()
        {
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    10,
                    default,
                    new FixedString32Bytes("H038"),
                    out var entityId,
                    out var ticket,
                    out _,
                    out _),
                Is.True);
            var request = SpendGemRequest();
            var rpc = MatchNetworkTransactionCodec.Encode(
                1,
                request,
                matchSequence: 0);

            Assert.That(
                MatchNetworkRuntimeState.TryAcceptTransaction(
                    10,
                    rpc,
                    out _),
                Is.True);
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueServerTransaction(
                    out var accepted),
                Is.True);
            Assert.That(accepted.EntityId, Is.EqualTo(entityId));
            MatchNetworkRuntimeState.RecordServerTransactionResult(
                accepted,
                MatchNetworkTransactionCodec.EncodeResult(
                    accepted.TransactionId,
                    Result(),
                    matchSequence: 0));
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueServerTransactionResult(
                    out _),
                Is.True);

            MatchNetworkRuntimeState.ReleasePlayer(10);
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    11,
                    ticket,
                    new FixedString32Bytes("H001"),
                    out var resumedEntityId,
                    out _,
                    out _,
                    out var resumed),
                Is.True);
            Assert.That(resumed, Is.True);
            Assert.That(resumedEntityId, Is.EqualTo(entityId));
            Assert.That(
                MatchNetworkRuntimeState.GetLastAcceptedTransactionId(
                    entityId),
                Is.EqualTo(1));

            Assert.That(
                MatchNetworkRuntimeState.TryAcceptTransaction(
                    11,
                    rpc,
                    out var replay),
                Is.False);
            Assert.That(replay.Code.ToString(), Is.EqualTo("no-gems"));
            Assert.That(
                MatchNetworkRuntimeState.ReplayedTransactionRpcCount,
                Is.EqualTo(1));
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueServerTransaction(
                    out _),
                Is.False);
        }

        [Test]
        public void DisconnectCancelsQueuedTransactionWithoutReusingIt()
        {
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    10,
                    default,
                    new FixedString32Bytes("H038"),
                    out _,
                    out var ticket,
                    out _,
                    out _),
                Is.True);
            var rpc = MatchNetworkTransactionCodec.Encode(
                1,
                SpendGemRequest());
            Assert.That(
                MatchNetworkRuntimeState.TryAcceptTransaction(
                    10,
                    rpc,
                    out _),
                Is.True);

            MatchNetworkRuntimeState.ReleasePlayer(10);
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    10,
                    ticket,
                    new FixedString32Bytes("H038"),
                    out _,
                    out _,
                    out _,
                    out var resumed),
                Is.True);
            Assert.That(resumed, Is.True);
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueServerTransaction(
                    out _),
                Is.False);
        }

        [Test]
        public void ExpiredReconnectEntityKeepsItsSlotAndDropsTransactionCache()
        {
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    10,
                    default,
                    new FixedString32Bytes("H038"),
                    out var entityId,
                    out var ticket,
                    out _,
                    out _),
                Is.True);
            MatchNetworkRuntimeState.ReleasePlayer(10);

            MatchNetworkRuntimeState.PublishServerSnapshot(
                RunningSnapshot(
                    MatchNetworkDefaults.ReconnectGraceTicks),
                matchSequence: 0);

            Assert.That(
                MatchNetworkRuntimeState.ActiveReconnectReservationCount,
                Is.Zero);
            Assert.That(
                MatchNetworkRuntimeState.ExpiredReconnectSessionCount,
                Is.EqualTo(1));
            Assert.That(
                MatchNetworkRuntimeState.GetLastAcceptedTransactionId(
                    entityId),
                Is.Zero);
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    11,
                    default,
                    new FixedString32Bytes("H001"),
                    out _,
                    out _,
                    out _,
                    out _),
                Is.False);
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    11,
                    ticket,
                    new FixedString32Bytes("H001"),
                    out _,
                    out _,
                    out _,
                    out _),
                Is.False);
        }

        [Test]
        public void OldMatchTransactionIsRejectedAfterRematch()
        {
            Assign(10, "H038");
            MatchNetworkRuntimeState.PublishServerSnapshot(
                RunningSnapshot(20),
                matchSequence: 0);
            MatchNetworkRuntimeState.ConfigureServerRematchRoster(
                new[]
                {
                    Player(7, "H038")
                });
            MatchNetworkRuntimeState.PublishServerSnapshot(
                RunningSnapshot(1),
                matchSequence: 1);

            var oldRpc = MatchNetworkTransactionCodec.Encode(
                1,
                SpendGemRequest(),
                matchSequence: 0);
            Assert.That(
                MatchNetworkRuntimeState.TryAcceptTransaction(
                    10,
                    oldRpc,
                    out var rejection),
                Is.False);
            Assert.That(
                rejection.Code.ToString(),
                Is.EqualTo("stale-match"));

            var currentRpc = MatchNetworkTransactionCodec.Encode(
                1,
                SpendGemRequest(),
                matchSequence: 1);
            Assert.That(
                MatchNetworkRuntimeState.TryAcceptTransaction(
                    10,
                    currentRpc,
                    out _),
                Is.True);
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

        private static SimulationTransactionRequest SpendGemRequest()
        {
            return new SimulationTransactionRequest
            {
                Kind = SimulationTransactionKind.SpendGem,
                PassiveId = GameplayIds.Critical
            };
        }

        private static SimulationTransactionResult Result()
        {
            return new SimulationTransactionResult
            {
                Kind = SimulationTransactionKind.SpendGem,
                Accepted = false,
                Code = "no-gems",
                Snapshot = RunningSnapshot(12)
            };
        }

        private static WorldSnapshot RunningSnapshot(int tick)
        {
            return new WorldSnapshot
            {
                Tick = tick,
                StateHash = "1234abcd",
                Match = new MatchSnapshot
                {
                    Status = MatchStatus.Running
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
