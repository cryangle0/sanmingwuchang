using Jwgb.Sim.Deterministic;

namespace Jwgb.Netcode
{
    public readonly struct AcceptedNetworkTransaction
    {
        public AcceptedNetworkTransaction(
            int matchSequence,
            int networkId,
            int entityId,
            int transactionId,
            SimulationTransactionRequest request)
        {
            MatchSequence = matchSequence;
            NetworkId = networkId;
            EntityId = entityId;
            TransactionId = transactionId;
            Request = request;
        }

        public int MatchSequence { get; }

        public int NetworkId { get; }

        public int EntityId { get; }

        public int TransactionId { get; }

        public SimulationTransactionRequest Request { get; }
    }

    internal readonly struct NetworkTransactionKey :
        System.IEquatable<NetworkTransactionKey>
    {
        public NetworkTransactionKey(
            int matchSequence,
            int entityId,
            int transactionId)
        {
            MatchSequence = matchSequence;
            EntityId = entityId;
            TransactionId = transactionId;
        }

        public int MatchSequence { get; }

        public int EntityId { get; }

        public int TransactionId { get; }

        public bool Equals(NetworkTransactionKey other)
        {
            return MatchSequence == other.MatchSequence &&
                EntityId == other.EntityId &&
                TransactionId == other.TransactionId;
        }

        public override bool Equals(object value)
        {
            return value is NetworkTransactionKey other &&
                Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                var hash = MatchSequence;
                hash = (hash * 397) ^ EntityId;
                return (hash * 397) ^ TransactionId;
            }
        }
    }

    public readonly struct PendingNetworkTransactionResult
    {
        public PendingNetworkTransactionResult(
            int networkId,
            MatchTransactionResultRpc result)
        {
            NetworkId = networkId;
            Result = result;
        }

        public int NetworkId { get; }

        public MatchTransactionResultRpc Result { get; }
    }
}
