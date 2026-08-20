using System;
using System.Collections.Generic;
using Jwgb.Sim.Deterministic;
using Unity.Collections;

namespace Jwgb.Netcode
{
    public static partial class MatchNetworkRuntimeState
    {
        private static readonly Queue<AcceptedNetworkTransaction>
            serverTransactions =
                new Queue<AcceptedNetworkTransaction>();
        private static readonly Queue<PendingNetworkTransactionResult>
            serverTransactionResults =
                new Queue<PendingNetworkTransactionResult>();
        private static readonly Dictionary<int, int>
            lastTransactionByEntityId =
                new Dictionary<int, int>();
        private static readonly Dictionary<
            NetworkTransactionKey,
            MatchTransactionResultRpc> transactionResultCache =
                new Dictionary<
                    NetworkTransactionKey,
                    MatchTransactionResultRpc>();
        private static readonly HashSet<NetworkTransactionKey>
            inFlightTransactions =
                new HashSet<NetworkTransactionKey>();
        private static readonly List<NetworkTransactionKey>
            transactionKeys =
                new List<NetworkTransactionKey>();
        public static int AcceptedTransactionRpcCount {
            get;
            private set;
        }

        public static int RejectedTransactionRpcCount {
            get;
            private set;
        }

        public static int ReplayedTransactionRpcCount {
            get;
            private set;
        }

        public static int SentTransactionResultRpcCount {
            get;
            private set;
        }

        public static bool TryAcceptTransaction(
            int networkId,
            MatchTransactionRpc rpc,
            out MatchTransactionResultRpc immediateResult)
        {
            immediateResult = default;
            if (rpc.TransactionId <= 0 ||
                !MatchNetworkTransactionCodec.IsKnownKind(rpc.Kind))
            {
                RejectedTransactionRpcCount += 1;
                immediateResult = Rejection(
                    rpc,
                    "invalid-transaction");
                return false;
            }

            if (!entityByNetworkId.TryGetValue(
                    networkId,
                    out var entityId))
            {
                RejectedTransactionRpcCount += 1;
                immediateResult = Rejection(
                    rpc,
                    "connection-not-assigned");
                return false;
            }

            if (rpc.MatchSequence != ServerMatchSequence)
            {
                RejectedTransactionRpcCount += 1;
                immediateResult = Rejection(
                    rpc,
                    "stale-match");
                return false;
            }

            var key = new NetworkTransactionKey(
                rpc.MatchSequence,
                entityId,
                rpc.TransactionId);
            if (transactionResultCache.TryGetValue(
                    key,
                    out immediateResult))
            {
                ReplayedTransactionRpcCount += 1;
                return false;
            }
            if (inFlightTransactions.Contains(key))
            {
                ReplayedTransactionRpcCount += 1;
                return false;
            }
            if (lastTransactionByEntityId.TryGetValue(
                    entityId,
                    out var lastTransactionId) &&
                rpc.TransactionId <= lastTransactionId)
            {
                RejectedTransactionRpcCount += 1;
                immediateResult = Rejection(
                    rpc,
                    "transaction-sequence-rejected");
                return false;
            }

            lastTransactionByEntityId[entityId] =
                rpc.TransactionId;
            inFlightTransactions.Add(key);
            serverTransactions.Enqueue(
                new AcceptedNetworkTransaction(
                    rpc.MatchSequence,
                    networkId,
                    entityId,
                    rpc.TransactionId,
                    MatchNetworkTransactionCodec.Decode(
                        rpc,
                        entityId)));
            AcceptedTransactionRpcCount += 1;
            return true;
        }

        public static bool TryDequeueServerTransaction(
            out AcceptedNetworkTransaction transaction)
        {
            if (serverTransactions.Count == 0)
            {
                transaction = default;
                return false;
            }

            transaction = serverTransactions.Dequeue();
            return true;
        }

        public static bool IsCurrentTransactionOwner(
            AcceptedNetworkTransaction transaction)
        {
            return entityByNetworkId.TryGetValue(
                    transaction.NetworkId,
                    out var entityId) &&
                entityId == transaction.EntityId &&
                transaction.MatchSequence == ServerMatchSequence;
        }

        public static void RecordServerTransactionResult(
            AcceptedNetworkTransaction transaction,
            MatchTransactionResultRpc result)
        {
            var key = new NetworkTransactionKey(
                transaction.MatchSequence,
                transaction.EntityId,
                result.TransactionId);
            result.MatchSequence = transaction.MatchSequence;
            inFlightTransactions.Remove(key);
            transactionResultCache[key] = result;
            if (IsCurrentTransactionOwner(transaction))
            {
                QueueServerTransactionResult(
                    transaction.NetworkId,
                    result);
            }
        }

        public static int GetLastAcceptedTransactionId(int entityId)
        {
            return lastTransactionByEntityId.TryGetValue(
                entityId,
                out var transactionId)
                    ? transactionId
                    : 0;
        }

        public static void QueueServerTransactionResult(
            int networkId,
            MatchTransactionResultRpc result)
        {
            serverTransactionResults.Enqueue(
                new PendingNetworkTransactionResult(
                    networkId,
                    result));
        }

        public static bool TryDequeueServerTransactionResult(
            out PendingNetworkTransactionResult result)
        {
            if (serverTransactionResults.Count == 0)
            {
                result = default;
                return false;
            }

            result = serverTransactionResults.Dequeue();
            return true;
        }

        public static void RecordTransactionResultRpcSent()
        {
            SentTransactionResultRpcCount += 1;
        }

        private static MatchTransactionResultRpc Rejection(
            MatchTransactionRpc rpc,
            string code)
        {
            return new MatchTransactionResultRpc
            {
                MatchSequence = ServerMatchSequence,
                TransactionId = rpc.TransactionId,
                Kind = rpc.Kind,
                Accepted = false,
                Code = new FixedString64Bytes(code),
                CommitTick = latestServerSnapshot?.Tick ?? 0,
                StateHash =
                    MatchNetworkTransactionCodec.StateHashOf(
                        latestServerSnapshot)
            };
        }

        private static void ResetServerTransactionState()
        {
            serverTransactions.Clear();
            serverTransactionResults.Clear();
            lastTransactionByEntityId.Clear();
            transactionResultCache.Clear();
            inFlightTransactions.Clear();
            transactionKeys.Clear();
            AcceptedTransactionRpcCount = 0;
            RejectedTransactionRpcCount = 0;
            ReplayedTransactionRpcCount = 0;
            SentTransactionResultRpcCount = 0;
        }

    }
}
