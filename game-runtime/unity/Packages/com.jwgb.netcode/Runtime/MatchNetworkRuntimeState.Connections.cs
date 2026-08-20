using System;
using Jwgb.Content;
using Unity.Collections;

namespace Jwgb.Netcode
{
    public static partial class MatchNetworkRuntimeState
    {
        public static bool TryAssignPlayer(
            int networkId,
            FixedString64Bytes requestedReconnectTicket,
            FixedString32Bytes requestedHeroId,
            out int entityId,
            out FixedString64Bytes reconnectTicket,
            out FixedString32Bytes assignedHeroId,
            out bool resumedSession)
        {
            ReceivedJoinRpcCount += 1;
            resumedSession = false;
            if (entityByNetworkId.TryGetValue(networkId, out entityId))
            {
                reconnectTicket = new FixedString64Bytes(
                    ticketByNetworkId[networkId]);
                assignedHeroId = new FixedString32Bytes(
                    GetHeroId(entityId));
                return true;
            }

            var requestedTicket =
                requestedReconnectTicket.ToString();
            if (!string.IsNullOrEmpty(requestedTicket))
            {
                var currentTick = latestServerSnapshot?.Tick ?? 0;
                ExpireReconnectReservations(currentTick);
                if (!reconnectReservations.Remove(
                        requestedTicket,
                        out var reservation))
                {
                    entityId = 0;
                    reconnectTicket = default;
                    assignedHeroId = default;
                    return false;
                }

                entityId = reservation.EntityId;
                entityByNetworkId.Add(networkId, entityId);
                expiredReconnectEntityIds.Remove(entityId);
                lastInputByNetworkId.Add(networkId, 0);
                ticketByNetworkId.Add(networkId, requestedTicket);
                assignments.Enqueue(
                    new NetworkPlayerAssignment(entityId, true));
                resumedSession = true;
                ResumedJoinRpcCount += 1;
                reconnectTicket =
                    new FixedString64Bytes(requestedTicket);
                assignedHeroId = new FixedString32Bytes(
                    GetHeroId(entityId));
                return true;
            }

            if (latestServerSnapshot?.Match.Status ==
                Jwgb.Sim.Deterministic.MatchStatus.Finished)
            {
                entityId = 0;
                reconnectTicket = default;
                assignedHeroId = default;
                return false;
            }

            var requestedHero = requestedHeroId.ToString();
            HeroCatalog.Get(requestedHero);
            var availableIndex =
                FindAvailableSlot(requestedHero);
            if (availableIndex >= 0)
            {
                assignedSlots[availableIndex] = true;
                heroBySlot[availableIndex] = requestedHero;
                entityId = competitorEntityIds[availableIndex];
                expiredReconnectEntityIds.Remove(entityId);
                var issuedTicket = CreateReconnectTicket();
                entityByNetworkId.Add(networkId, entityId);
                lastInputByNetworkId.Add(networkId, 0);
                ticketByNetworkId.Add(networkId, issuedTicket);
                assignments.Enqueue(
                    new NetworkPlayerAssignment(
                        entityId,
                        connected: true,
                        heroId: requestedHero,
                        applyHero: true));
                IssuedReconnectTicketCount += 1;
                reconnectTicket =
                    new FixedString64Bytes(issuedTicket);
                assignedHeroId =
                    new FixedString32Bytes(requestedHero);
                return true;
            }

            entityId = 0;
            reconnectTicket = default;
            assignedHeroId = default;
            return false;
        }

        public static void ReleasePlayer(int networkId)
        {
            serverRematchVotes.Remove(networkId);
            if (!entityByNetworkId.Remove(networkId, out var entityId))
            {
                return;
            }

            CancelTransactionConnection(networkId, entityId);
            lastInputByNetworkId.Remove(networkId);
            if (ticketByNetworkId.Remove(
                    networkId,
                    out var reconnectTicket) &&
                !string.IsNullOrEmpty(reconnectTicket))
            {
                var currentTick = latestServerSnapshot?.Tick ?? 0;
                reconnectReservations[reconnectTicket] =
                    new ReconnectReservation(
                        entityId,
                        checked(
                            currentTick +
                            MatchNetworkDefaults
                                .ReconnectGraceTicks));
            }
            else
            {
                MarkReconnectExpired(entityId);
            }
            assignments.Enqueue(
                new NetworkPlayerAssignment(entityId, false));
        }

        public static bool TryAcceptInput(
            int networkId,
            MatchInputRpc input)
        {
            if (!entityByNetworkId.TryGetValue(
                    networkId,
                    out var entityId) ||
                input.Sequence <= lastInputByNetworkId[networkId])
            {
                RejectedInputRpcCount += 1;
                return false;
            }

            lastInputByNetworkId[networkId] = input.Sequence;
            serverInputs.Enqueue(
                new AcceptedNetworkInput(entityId, input));
            AcceptedInputRpcCount += 1;
            return true;
        }

        public static bool TryDequeueServerInput(
            out AcceptedNetworkInput input)
        {
            if (serverInputs.Count == 0)
            {
                input = default;
                return false;
            }
            input = serverInputs.Dequeue();
            return true;
        }

        public static bool TryDequeueAssignment(
            out NetworkPlayerAssignment assignment)
        {
            if (assignments.Count == 0)
            {
                assignment = default;
                return false;
            }
            assignment = assignments.Dequeue();
            return true;
        }

        private static string CreateReconnectTicket()
        {
            string ticket;
            do
            {
                ticket = Guid.NewGuid().ToString("N");
            } while (reconnectReservations.ContainsKey(ticket) ||
                ticketByNetworkId.ContainsValue(ticket));
            return ticket;
        }

        private static void ExpireReconnectReservations(
            int currentTick)
        {
            expiredReconnectTickets.Clear();
            foreach (var pair in reconnectReservations)
            {
                if (pair.Value.ExpiresAtTick <= currentTick)
                {
                    MarkReconnectExpired(pair.Value.EntityId);
                    expiredReconnectTickets.Add(pair.Key);
                }
            }
            for (var index = 0;
                index < expiredReconnectTickets.Count;
                index += 1)
            {
                reconnectReservations.Remove(
                    expiredReconnectTickets[index]);
            }
        }

        private static void MarkReconnectExpired(int entityId)
        {
            expiredReconnectEntityIds.Add(entityId);
            ReleaseTransactionEntity(entityId);
        }

        private static int FindAvailableSlot(string requestedHero)
        {
            var fallback = -1;
            for (var index = 0;
                index < assignedSlots.Length;
                index += 1)
            {
                if (assignedSlots[index])
                {
                    continue;
                }
                if (fallback < 0)
                {
                    fallback = index;
                }
                if (string.Equals(
                        heroBySlot[index],
                        requestedHero,
                        StringComparison.Ordinal))
                {
                    return index;
                }
            }
            return fallback;
        }

        private static string GetHeroId(int entityId)
        {
            for (var index = 0;
                index < competitorEntityIds.Length;
                index += 1)
            {
                if (competitorEntityIds[index] == entityId)
                {
                    return heroBySlot[index] ?? string.Empty;
                }
            }
            return string.Empty;
        }
    }
}
