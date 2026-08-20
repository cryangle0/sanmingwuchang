using System.Collections.Generic;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Netcode
{
    public static partial class MatchNetworkRuntimeState
    {
        private static readonly Queue<MatchTransactionRpc>
            clientTransactions = new Queue<MatchTransactionRpc>();
        private static readonly Queue<MatchTransactionResultRpc>
            clientTransactionResults =
                new Queue<MatchTransactionResultRpc>();
        private static int nextClientTransactionId;

        public static int SentTransactionRpcCount {
            get;
            private set;
        }

        public static int ReceivedTransactionResultRpcCount {
            get;
            private set;
        }

        public static int IgnoredTransactionResultRpcCount {
            get;
            private set;
        }

        public static MatchTransactionResultRpc
            LatestClientTransactionResult { get; private set; }

        public static int QueueClientTransaction(
            SimulationTransactionRequest request)
        {
            var transactionId = checked(nextClientTransactionId + 1);
            nextClientTransactionId = transactionId;
            clientTransactions.Enqueue(
                MatchNetworkTransactionCodec.Encode(
                    transactionId,
                    request,
                    ClientMatchSequence));
            return transactionId;
        }

        public static bool TryDequeueClientTransaction(
            out MatchTransactionRpc transaction)
        {
            if (clientTransactions.Count == 0)
            {
                transaction = default;
                return false;
            }

            transaction = clientTransactions.Dequeue();
            return true;
        }

        public static void RecordTransactionRpcSent()
        {
            SentTransactionRpcCount += 1;
        }

        public static void RecordClientTransactionResult(
            MatchTransactionResultRpc result)
        {
            if (result.MatchSequence != ClientMatchSequence)
            {
                IgnoredTransactionResultRpcCount += 1;
                return;
            }
            LatestClientTransactionResult = result;
            ReceivedTransactionResultRpcCount += 1;
            clientTransactionResults.Enqueue(result);
        }

        public static bool TryDequeueClientTransactionResult(
            out MatchTransactionResultRpc result)
        {
            if (clientTransactionResults.Count == 0)
            {
                result = default;
                return false;
            }

            result = clientTransactionResults.Dequeue();
            return true;
        }

        private static void ResetClientTransactionState()
        {
            clientTransactions.Clear();
            clientTransactionResults.Clear();
            nextClientTransactionId = 0;
            SentTransactionRpcCount = 0;
            ReceivedTransactionResultRpcCount = 0;
            IgnoredTransactionResultRpcCount = 0;
            LatestClientTransactionResult = default;
        }

        private static void RestoreClientTransactionSequence(
            int lastTransactionId)
        {
            if (lastTransactionId < 0)
            {
                throw new System.ArgumentOutOfRangeException(
                    nameof(lastTransactionId));
            }
            nextClientTransactionId = System.Math.Max(
                nextClientTransactionId,
                lastTransactionId);
        }
    }
}
