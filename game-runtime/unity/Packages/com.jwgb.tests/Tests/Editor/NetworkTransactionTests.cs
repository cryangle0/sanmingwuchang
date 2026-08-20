using Jwgb.Client;
using Jwgb.Content;
using Jwgb.Netcode;
using Jwgb.Server;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using Unity.Collections;

namespace Jwgb.Tests
{
    public sealed class NetworkTransactionTests
    {
        [SetUp]
        public void SetUp()
        {
            MatchNetworkRuntimeState.ResetProcessState();
            MatchNetworkRuntimeState.ConfigureServerRoster(
                new[]
                {
                    new PlayerSnapshot
                    {
                        EntityId = 7,
                        PlayerId = "network-player",
                        HeroId = GameplayIds.SunWukong
                    }
                });
        }

        [TearDown]
        public void TearDown()
        {
            MatchNetworkRuntimeState.ResetProcessState();
        }

        [Test]
        public void ServerBindsTransactionToConnectionAndReplaysResult()
        {
            Assert.That(
                MatchNetworkRuntimeState.TryAssignPlayer(
                    10,
                    default,
                    new FixedString32Bytes(GameplayIds.SunWukong),
                    out var entityId,
                    out _,
                    out _,
                    out _),
                Is.True);
            var request = new SimulationTransactionRequest
            {
                Kind = SimulationTransactionKind.SpendGem,
                PlayerEntityId = 999,
                PassiveId = GameplayIds.Critical
            };
            var rpc = MatchNetworkTransactionCodec.Encode(1, request);

            Assert.That(
                MatchNetworkRuntimeState.TryAcceptTransaction(
                    10,
                    rpc,
                    out var immediate),
                Is.True);
            Assert.That(immediate.TransactionId, Is.Zero);
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueServerTransaction(
                    out var accepted),
                Is.True);
            Assert.That(accepted.EntityId, Is.EqualTo(entityId));
            Assert.That(
                accepted.Request.PlayerEntityId,
                Is.EqualTo(entityId));
            Assert.That(
                accepted.Request.PassiveId,
                Is.EqualTo(GameplayIds.Critical));

            var result = MatchNetworkTransactionCodec.EncodeResult(
                accepted.TransactionId,
                new SimulationTransactionResult
                {
                    Kind = SimulationTransactionKind.SpendGem,
                    Accepted = false,
                    Code = "no-gems",
                    Snapshot = Snapshot(12, "1234abcd")
                });
            MatchNetworkRuntimeState.RecordServerTransactionResult(
                accepted,
                result);

            Assert.That(
                MatchNetworkRuntimeState.TryAcceptTransaction(
                    10,
                    rpc,
                    out var replay),
                Is.False);
            Assert.That(replay.TransactionId, Is.EqualTo(1));
            Assert.That(replay.Code.ToString(), Is.EqualTo("no-gems"));
            Assert.That(replay.CommitTick, Is.EqualTo(12));
            Assert.That(replay.StateHash, Is.EqualTo(0x1234abcd));
            Assert.That(
                MatchNetworkRuntimeState.ReplayedTransactionRpcCount,
                Is.EqualTo(1));
        }

        [Test]
        public void UnassignedConnectionCannotQueueTransaction()
        {
            var rpc = MatchNetworkTransactionCodec.Encode(
                1,
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.AirdropOpen,
                    AirdropId = "airdrop-1"
                });

            Assert.That(
                MatchNetworkRuntimeState.TryAcceptTransaction(
                    99,
                    rpc,
                    out var rejection),
                Is.False);
            Assert.That(
                rejection.Code.ToString(),
                Is.EqualTo("connection-not-assigned"));
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueServerTransaction(
                    out _),
                Is.False);
        }

        [Test]
        public void ClientServiceCorrelatesResultWithMatchingSnapshot()
        {
            MatchNetworkRuntimeState.RecordClientAccepted(
                7,
                0,
                0,
                new FixedString64Bytes("ticket"),
                new FixedString32Bytes(GameplayIds.SunWukong),
                resumedSession: false);
            var service = new NetworkTransactionService();
            ClientTransactionResult observed = null;
            service.Completed += result => observed = result;

            var transactionId = service.Execute(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.EquipmentDiscard,
                    InstanceId = 41
                });
            Assert.That(transactionId, Is.EqualTo(1));
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueClientTransaction(
                    out var request),
                Is.True);
            Assert.That(request.TransactionId, Is.EqualTo(1));
            Assert.That(
                request.Kind,
                Is.EqualTo(
                    (byte)SimulationTransactionKind.EquipmentDiscard));

            MatchNetworkRuntimeState.RecordClientTransactionResult(
                new MatchTransactionResultRpc
                {
                    TransactionId = 1,
                    Kind = request.Kind,
                    Accepted = true,
                    Code = new FixedString64Bytes("accepted"),
                    HasLootEntityId = true,
                    LootEntityId = 77,
                    CommitTick = 9,
                    StateHash = 0x1234abcd
                });
            var snapshot = Snapshot(9, "1234abcd");

            service.DrainCompleted(snapshot);

            Assert.That(observed, Is.Not.Null);
            Assert.That(observed.Accepted, Is.True);
            Assert.That(observed.LootEntityId, Is.EqualTo(77));
            Assert.That(observed.CommitTick, Is.EqualTo(9));
            Assert.That(observed.Snapshot, Is.SameAs(snapshot));
        }

        [Test]
        public void AuthoritativeSessionRefreshesSnapshotAfterTransaction()
        {
            var session = new AuthoritativeMatchSession(
                20260806,
                2,
                mapEnabled: false,
                pveEnabled: false);
            var entityId = session.GetCompetitorEntityIds()[0];

            var result = session.ExecuteTransaction(
                new SimulationTransactionRequest
                {
                    Kind = SimulationTransactionKind.SpendGem,
                    PlayerEntityId = entityId,
                    PassiveId = GameplayIds.Critical
                });

            Assert.That(result.Code, Is.EqualTo("no-gems"));
            Assert.That(session.Snapshot, Is.SameAs(result.Snapshot));
            Assert.That(
                session.Snapshot.StateHash,
                Is.EqualTo(result.Snapshot.StateHash));
        }

        private static WorldSnapshot Snapshot(
            int tick,
            string stateHash)
        {
            return new WorldSnapshot
            {
                Tick = tick,
                StateHash = stateHash,
                Match = new MatchSnapshot
                {
                    Status = MatchStatus.Running
                }
            };
        }
    }
}
