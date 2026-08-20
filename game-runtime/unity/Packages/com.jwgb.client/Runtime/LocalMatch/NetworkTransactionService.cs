using System;
using System.Collections.Generic;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    public sealed class NetworkTransactionService
    {
        private readonly Dictionary<int, SimulationTransactionKind>
            pending = new Dictionary<int, SimulationTransactionKind>();

        public event Action<ClientTransactionResult> Completed;

        public int Execute(SimulationTransactionRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            var localEntityId =
                MatchNetworkRuntimeState.ClientEntityId;
            if (localEntityId <= 0)
            {
                throw new InvalidOperationException(
                    "Cannot execute a network transaction before joining.");
            }
            if (request.PlayerEntityId != 0 &&
                request.PlayerEntityId != localEntityId)
            {
                throw new InvalidOperationException(
                    "Network transactions may only target the local player.");
            }

            var transactionId =
                MatchNetworkRuntimeState.QueueClientTransaction(
                    request);
            pending.Add(transactionId, request.Kind);
            return transactionId;
        }

        public void DrainCompleted(WorldSnapshot snapshot)
        {
            while (MatchNetworkRuntimeState
                .TryDequeueClientTransactionResult(out var rpc))
            {
                if (!pending.Remove(
                        rpc.TransactionId,
                        out var requestedKind))
                {
                    continue;
                }

                var stateHash = rpc.StateHash.ToString("x8");
                var matchingSnapshot =
                    snapshot != null &&
                    snapshot.Tick >= rpc.CommitTick &&
                    string.Equals(
                        snapshot.StateHash,
                        stateHash,
                        StringComparison.OrdinalIgnoreCase)
                        ? snapshot
                        : null;
                Completed?.Invoke(
                    new ClientTransactionResult
                    {
                        TransactionId = rpc.TransactionId,
                        Kind = MatchNetworkTransactionCodec.IsKnownKind(
                            rpc.Kind)
                                ? (SimulationTransactionKind)rpc.Kind
                                : requestedKind,
                        Accepted = rpc.Accepted,
                        Code = rpc.Code.ToString(),
                        LootEntityId = rpc.HasLootEntityId
                            ? rpc.LootEntityId
                            : null,
                        CommitTick = rpc.CommitTick,
                        StateHash = stateHash,
                        Snapshot = matchingSnapshot
                    });
            }
        }

        public void Reset()
        {
            pending.Clear();
        }
    }
}
