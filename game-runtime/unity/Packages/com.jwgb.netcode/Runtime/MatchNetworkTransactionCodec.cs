using System;
using Jwgb.Sim.Deterministic;
using Unity.Collections;

namespace Jwgb.Netcode
{
    public static class MatchNetworkTransactionCodec
    {
        public static MatchTransactionRpc Encode(
            int transactionId,
            SimulationTransactionRequest request,
            int matchSequence = 0)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }
            if (transactionId <= 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(transactionId));
            }

            return new MatchTransactionRpc
            {
                MatchSequence = matchSequence,
                TransactionId = transactionId,
                Kind = (byte)request.Kind,
                ShopId = Text64(request.ShopId),
                ListingId = Text64(request.ListingId),
                ExpectedVersion = request.ExpectedVersion,
                Destination = Text32(request.Destination),
                InstanceId = request.InstanceId,
                HasReplacementInstanceId =
                    request.ReplacementInstanceId.HasValue,
                ReplacementInstanceId =
                    request.ReplacementInstanceId ?? 0,
                PassiveId = Text32(request.PassiveId),
                LootEntityId = request.LootEntityId,
                Confirm = request.Confirm,
                HeroId = Text64(request.HeroId),
                WagerGold = request.WagerGold,
                Mode = Text32(request.Mode),
                AirdropId = Text64(request.AirdropId)
            };
        }

        public static SimulationTransactionRequest Decode(
            MatchTransactionRpc rpc,
            int playerEntityId)
        {
            if (!IsKnownKind(rpc.Kind))
            {
                throw new ArgumentOutOfRangeException(nameof(rpc));
            }

            return new SimulationTransactionRequest
            {
                Kind = (SimulationTransactionKind)rpc.Kind,
                PlayerEntityId = playerEntityId,
                ShopId = Optional(rpc.ShopId.ToString()),
                ListingId = Optional(rpc.ListingId.ToString()),
                ExpectedVersion = rpc.ExpectedVersion,
                Destination =
                    Optional(rpc.Destination.ToString()),
                InstanceId = rpc.InstanceId,
                ReplacementInstanceId =
                    rpc.HasReplacementInstanceId
                        ? rpc.ReplacementInstanceId
                        : null,
                PassiveId = Optional(rpc.PassiveId.ToString()),
                LootEntityId = rpc.LootEntityId,
                Confirm = rpc.Confirm,
                HeroId = Optional(rpc.HeroId.ToString()),
                WagerGold = rpc.WagerGold,
                Mode = Optional(rpc.Mode.ToString()),
                AirdropId = Optional(rpc.AirdropId.ToString())
            };
        }

        public static MatchTransactionResultRpc EncodeResult(
            int transactionId,
            SimulationTransactionResult result,
            int matchSequence = 0)
        {
            if (result == null)
            {
                throw new ArgumentNullException(nameof(result));
            }
            if (result.Snapshot == null)
            {
                throw new ArgumentException(
                    "Transaction result has no authoritative snapshot.",
                    nameof(result));
            }

            return new MatchTransactionResultRpc
            {
                MatchSequence = matchSequence,
                TransactionId = transactionId,
                Kind = (byte)result.Kind,
                Accepted = result.Accepted,
                Code = Text64(result.Code),
                HasLootEntityId = result.LootEntityId.HasValue,
                LootEntityId = result.LootEntityId ?? 0,
                CommitTick = result.Snapshot.Tick,
                StateHash = StateHashOf(result.Snapshot)
            };
        }

        public static bool IsKnownKind(byte kind)
        {
            return kind >=
                    (byte)SimulationTransactionKind.ShopPurchase &&
                kind <=
                    (byte)SimulationTransactionKind.AirdropOpen;
        }

        public static uint StateHashOf(WorldSnapshot snapshot)
        {
            return snapshot == null ||
                string.IsNullOrEmpty(snapshot.StateHash)
                    ? 0
                    : Convert.ToUInt32(snapshot.StateHash, 16);
        }

        private static FixedString64Bytes Text64(string value)
        {
            return new FixedString64Bytes(value ?? string.Empty);
        }

        private static FixedString32Bytes Text32(string value)
        {
            return new FixedString32Bytes(value ?? string.Empty);
        }

        private static string Optional(string value)
        {
            return string.IsNullOrEmpty(value) ? null : value;
        }
    }
}
