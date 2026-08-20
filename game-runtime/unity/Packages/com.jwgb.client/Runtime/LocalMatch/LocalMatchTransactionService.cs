using System;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    public sealed class LocalMatchTransactionService
    {
        private readonly LocalMatchSession session;
        private int nextTransactionId;

        internal LocalMatchTransactionService(
            LocalMatchSession session)
        {
            this.session = session ??
                throw new ArgumentNullException(nameof(session));
        }

        public event Action<ClientTransactionResult> Completed;

        public ClientTransactionResult Execute(
            SimulationTransactionRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            var transactionId = checked(nextTransactionId + 1);
            nextTransactionId = transactionId;
            var authoritative = session.ExecuteTransaction(
                CopyForLocalPlayer(request));
            var result = new ClientTransactionResult
            {
                TransactionId = transactionId,
                Kind = authoritative.Kind,
                Accepted = authoritative.Accepted,
                Code = authoritative.Code,
                LootEntityId = authoritative.LootEntityId,
                CommitTick = authoritative.Snapshot.Tick,
                StateHash = authoritative.Snapshot.StateHash,
                Snapshot = authoritative.Snapshot
            };
            Completed?.Invoke(result);
            return result;
        }

        private SimulationTransactionRequest CopyForLocalPlayer(
            SimulationTransactionRequest request)
        {
            if (request.PlayerEntityId != 0 &&
                request.PlayerEntityId != session.LocalEntityId)
            {
                throw new InvalidOperationException(
                    "Local transactions may only target the local player.");
            }

            return new SimulationTransactionRequest
            {
                Kind = request.Kind,
                PlayerEntityId = session.LocalEntityId,
                ShopId = request.ShopId,
                ListingId = request.ListingId,
                ExpectedVersion = request.ExpectedVersion,
                Destination = request.Destination,
                InstanceId = request.InstanceId,
                ReplacementInstanceId =
                    request.ReplacementInstanceId,
                PassiveId = request.PassiveId,
                LootEntityId = request.LootEntityId,
                Confirm = request.Confirm,
                HeroId = request.HeroId,
                WagerGold = request.WagerGold,
                Mode = request.Mode,
                AirdropId = request.AirdropId
            };
        }
    }
}
