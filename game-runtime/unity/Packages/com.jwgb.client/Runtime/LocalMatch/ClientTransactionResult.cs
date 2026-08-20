using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    public sealed class ClientTransactionResult
    {
        public int TransactionId { get; set; }

        public SimulationTransactionKind Kind { get; set; }

        public bool Accepted { get; set; }

        public string Code { get; set; }

        public int? LootEntityId { get; set; }

        public int CommitTick { get; set; }

        public string StateHash { get; set; }

        public WorldSnapshot Snapshot { get; set; }
    }
}
