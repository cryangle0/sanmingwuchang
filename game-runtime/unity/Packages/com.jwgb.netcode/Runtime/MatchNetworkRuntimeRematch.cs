using System;
using System.Collections.Generic;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Netcode
{
    public static partial class MatchNetworkRuntimeState
    {
        private static readonly HashSet<int> serverRematchVotes =
            new HashSet<int>();
        private static bool clientRematchQueued;
        private static int nextClientRematchSequence;

        public static int ServerRematchVoteCount =>
            serverRematchVotes.Count;

        public static void QueueClientRematch()
        {
            if (ClientEntityId <= 0)
            {
                throw new InvalidOperationException(
                    "Cannot request a rematch before joining.");
            }
            clientRematchQueued = true;
        }

        public static bool TryConsumeClientRematch(
            out int requestSequence)
        {
            if (!clientRematchQueued)
            {
                requestSequence = 0;
                return false;
            }
            clientRematchQueued = false;
            requestSequence = checked(nextClientRematchSequence + 1);
            nextClientRematchSequence = requestSequence;
            return true;
        }

        public static bool RecordServerRematchVote(int networkId)
        {
            if (!entityByNetworkId.ContainsKey(networkId) ||
                latestServerSnapshot?.Match.Status !=
                    MatchStatus.Finished)
            {
                return false;
            }
            return serverRematchVotes.Add(networkId);
        }

        public static bool IsServerRematchReady =>
            latestServerSnapshot?.Match.Status ==
                MatchStatus.Finished &&
            entityByNetworkId.Count > 0 &&
            serverRematchVotes.Count == entityByNetworkId.Count;

        public static NetworkPlayerAssignment[]
            CaptureConnectedPlayersForRematch()
        {
            var result =
                new NetworkPlayerAssignment[entityByNetworkId.Count];
            var index = 0;
            foreach (var pair in entityByNetworkId)
            {
                result[index] = new NetworkPlayerAssignment(
                    pair.Value,
                    connected: true,
                    heroId: GetHeroId(pair.Value));
                index += 1;
            }
            Array.Sort(
                result,
                (left, right) =>
                    left.EntityId.CompareTo(right.EntityId));
            return result;
        }

        public static void ConfigureServerRematchRoster(
            PlayerSnapshot[] players)
        {
            ConfigureServerRosterArrays(
                players,
                preserveConnectedSlots: true);
            reconnectReservations.Clear();
            expiredReconnectTickets.Clear();
            expiredReconnectEntityIds.Clear();
            serverInputs.Clear();
            assignments.Clear();
            ResetServerTransactionState();
            serverRematchVotes.Clear();
        }

        public static void ResetClientMatchScopedState(
            int matchSequence)
        {
            ResetClientTransactionState();
            PrepareClientEventMatch(matchSequence);
            clientRematchQueued = false;
        }

        public static void ResetClientMatchScopedState()
        {
            ResetClientMatchScopedState(ClientMatchSequence);
        }

        private static void ResetRematchState()
        {
            serverRematchVotes.Clear();
            clientRematchQueued = false;
            nextClientRematchSequence = 0;
        }
    }
}
