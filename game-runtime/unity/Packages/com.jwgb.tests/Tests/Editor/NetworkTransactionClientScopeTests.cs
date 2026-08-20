using Jwgb.Content;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using Unity.Collections;

namespace Jwgb.Tests
{
    public sealed class NetworkTransactionClientScopeTests
    {
        [SetUp]
        public void SetUp()
        {
            MatchNetworkRuntimeState.ResetProcessState();
        }

        [TearDown]
        public void TearDown()
        {
            MatchNetworkRuntimeState.ResetProcessState();
        }

        [Test]
        public void ClientContinuesTransactionSequenceAfterReconnect()
        {
            MatchNetworkRuntimeState.RecordClientAccepted(
                7,
                0,
                7,
                new FixedString64Bytes("ticket"),
                new FixedString32Bytes("H038"),
                resumedSession: true);

            var transactionId =
                MatchNetworkRuntimeState.QueueClientTransaction(
                    SpendGemRequest());

            Assert.That(transactionId, Is.EqualTo(8));
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueClientTransaction(
                    out var rpc),
                Is.True);
            Assert.That(rpc.TransactionId, Is.EqualTo(8));
            Assert.That(rpc.MatchSequence, Is.Zero);
        }

        [Test]
        public void ClientDropsResultsFromAnotherMatch()
        {
            MatchNetworkRuntimeState.RecordClientAccepted(
                7,
                1,
                0,
                new FixedString64Bytes("ticket"),
                new FixedString32Bytes("H038"),
                resumedSession: false);

            MatchNetworkRuntimeState.RecordClientTransactionResult(
                new MatchTransactionResultRpc
                {
                    MatchSequence = 0,
                    TransactionId = 1,
                    Kind = (byte)SimulationTransactionKind.SpendGem
                });

            Assert.That(
                MatchNetworkRuntimeState.IgnoredTransactionResultRpcCount,
                Is.EqualTo(1));
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueClientTransactionResult(
                    out _),
                Is.False);
        }

        private static SimulationTransactionRequest SpendGemRequest()
        {
            return new SimulationTransactionRequest
            {
                Kind = SimulationTransactionKind.SpendGem,
                PassiveId = GameplayIds.Critical
            };
        }
    }
}
