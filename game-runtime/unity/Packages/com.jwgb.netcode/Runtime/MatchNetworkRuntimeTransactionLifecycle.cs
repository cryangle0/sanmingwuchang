using System.Collections.Generic;

namespace Jwgb.Netcode
{
    public static partial class MatchNetworkRuntimeState
    {
        private static readonly Queue<AcceptedNetworkTransaction>
            retainedTransactions =
                new Queue<AcceptedNetworkTransaction>();

        private static void CancelTransactionConnection(
            int networkId,
            int entityId)
        {
            retainedTransactions.Clear();
            while (serverTransactions.Count > 0)
            {
                var transaction = serverTransactions.Dequeue();
                if (transaction.NetworkId == networkId &&
                    transaction.EntityId == entityId)
                {
                    inFlightTransactions.Remove(
                        TransactionKey(transaction));
                    continue;
                }
                retainedTransactions.Enqueue(transaction);
            }
            while (retainedTransactions.Count > 0)
            {
                serverTransactions.Enqueue(
                    retainedTransactions.Dequeue());
            }
            CancelInFlightTransactionsForEntity(entityId);
        }

        private static void CancelInFlightTransactionsForEntity(
            int entityId)
        {
            transactionKeys.Clear();
            foreach (var key in inFlightTransactions)
            {
                if (key.EntityId == entityId)
                {
                    transactionKeys.Add(key);
                }
            }
            for (var index = 0;
                index < transactionKeys.Count;
                index += 1)
            {
                inFlightTransactions.Remove(transactionKeys[index]);
            }
            transactionKeys.Clear();
        }

        private static void ReleaseTransactionEntity(int entityId)
        {
            lastTransactionByEntityId.Remove(entityId);
            transactionKeys.Clear();
            foreach (var pair in transactionResultCache)
            {
                if (pair.Key.EntityId == entityId)
                {
                    transactionKeys.Add(pair.Key);
                }
            }
            for (var index = 0;
                index < transactionKeys.Count;
                index += 1)
            {
                transactionResultCache.Remove(
                    transactionKeys[index]);
            }
            CancelInFlightTransactionsForEntity(entityId);
            transactionKeys.Clear();
        }

        private static NetworkTransactionKey TransactionKey(
            AcceptedNetworkTransaction transaction)
        {
            return new NetworkTransactionKey(
                transaction.MatchSequence,
                transaction.EntityId,
                transaction.TransactionId);
        }
    }
}
