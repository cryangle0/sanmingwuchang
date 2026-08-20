using System;
using Jwgb.Sim.Deterministic;
using Unity.Collections;

namespace Jwgb.Netcode
{
    public static class MatchNetworkEventCodec
    {
        public static bool TryEncode(
            SimEvent simEvent,
            int matchSequence,
            int eventCursor,
            bool isReplay,
            out MatchEventRpc rpc)
        {
            if (simEvent == null)
            {
                throw new ArgumentNullException(nameof(simEvent));
            }
            if (matchSequence < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(matchSequence));
            }
            if (eventCursor <= 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(eventCursor));
            }
            if (!TryGetKind(simEvent.Type, out var kind))
            {
                rpc = default;
                return false;
            }

            rpc = new MatchEventRpc
            {
                MatchSequence = matchSequence,
                EventCursor = eventCursor,
                Tick = simEvent.Tick,
                Kind = (byte)kind,
                EntityId = simEvent.EntityId,
                HasSourceEntityId =
                    simEvent.SourceEntityId.HasValue,
                SourceEntityId =
                    simEvent.SourceEntityId ?? 0,
                ActiveAbilityId =
                    new FixedString32Bytes(
                        simEvent.ActiveAbilityId ??
                        string.Empty),
                Reason =
                    new FixedString32Bytes(
                        simEvent.Reason ??
                        string.Empty),
                IsReplay = isReplay
            };
            return true;
        }

        public static SimEvent Decode(MatchEventRpc rpc)
        {
            return new SimEvent
            {
                Type = GetType((MatchNetworkEventKind)rpc.Kind),
                Tick = rpc.Tick,
                EntityId = rpc.EntityId,
                SourceEntityId = rpc.HasSourceEntityId
                    ? rpc.SourceEntityId
                    : null,
                ActiveAbilityId =
                    rpc.ActiveAbilityId.ToString(),
                Reason = rpc.Reason.ToString()
            };
        }

        private static bool TryGetKind(
            string type,
            out MatchNetworkEventKind kind)
        {
            kind = type switch
            {
                "critical-hit" =>
                    MatchNetworkEventKind.CriticalHit,
                "active-cast" =>
                    MatchNetworkEventKind.ActiveCast,
                "true-death" =>
                    MatchNetworkEventKind.TrueDeath,
                "eliminated" =>
                    MatchNetworkEventKind.Eliminated,
                "lethal-protection" =>
                    MatchNetworkEventKind.LethalProtection,
                "projectile-blocked" =>
                    MatchNetworkEventKind.ProjectileBlocked,
                "core-boss-cast" =>
                    MatchNetworkEventKind.CoreBossCast,
                _ => 0
            };
            return kind != 0;
        }

        private static string GetType(MatchNetworkEventKind kind)
        {
            return kind switch
            {
                MatchNetworkEventKind.CriticalHit =>
                    "critical-hit",
                MatchNetworkEventKind.ActiveCast =>
                    "active-cast",
                MatchNetworkEventKind.TrueDeath =>
                    "true-death",
                MatchNetworkEventKind.Eliminated =>
                    "eliminated",
                MatchNetworkEventKind.LethalProtection =>
                    "lethal-protection",
                MatchNetworkEventKind.ProjectileBlocked =>
                    "projectile-blocked",
                MatchNetworkEventKind.CoreBossCast =>
                    "core-boss-cast",
                _ => throw new ArgumentOutOfRangeException(
                    nameof(kind),
                    kind,
                    "Unknown network match event kind.")
            };
        }
    }
}
