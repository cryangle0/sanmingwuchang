using System;
using System.Collections.Generic;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Netcode
{
    public static partial class MatchNetworkRuntimeState
    {
        private const int MaximumBufferedMatchEvents = 1024;

        private static readonly List<MatchEventRpc> serverEventWindow =
            new List<MatchEventRpc>();
        private static readonly Queue<MatchEventRpc>
            serverEventBroadcasts = new Queue<MatchEventRpc>();
        private static readonly SortedDictionary<int, MatchEventRpc>
            clientPendingEvents =
                new SortedDictionary<int, MatchEventRpc>();
        private static int serverEventMatchSequence;
        private static int nextServerEventCursor;
        private static int clientEventMatchSequence;
        private static int clientLastEventCursor;

        public static int SentEventRpcCount { get; private set; }

        public static int SentReplayEventRpcCount { get; private set; }

        public static int ReceivedEventRpcCount { get; private set; }

        public static int ReceivedReplayEventRpcCount {
            get;
            private set;
        }

        public static int IgnoredEventRpcCount { get; private set; }

        public static int BufferedServerEventCount =>
            serverEventWindow.Count;

        public static int ClientEventMatchSequence =>
            clientEventMatchSequence;

        public static int ClientLastEventCursor =>
            clientLastEventCursor;

        public static void PublishServerEvents(
            IReadOnlyList<SimEvent> events,
            int matchSequence)
        {
            if (events == null)
            {
                throw new ArgumentNullException(nameof(events));
            }
            EnsureServerEventMatch(matchSequence);
            for (var index = 0; index < events.Count; index += 1)
            {
                var cursor = checked(nextServerEventCursor + 1);
                if (!MatchNetworkEventCodec.TryEncode(
                        events[index],
                        matchSequence,
                        cursor,
                        isReplay: false,
                        out var rpc))
                {
                    continue;
                }

                nextServerEventCursor = cursor;
                serverEventWindow.Add(rpc);
                serverEventBroadcasts.Enqueue(rpc);
                PruneServerEventWindow(rpc.Tick);
            }
        }

        public static int ResolveServerEventReplayCursor(
            int matchSequence,
            int requestedCursor)
        {
            if (matchSequence != serverEventMatchSequence)
            {
                return 0;
            }
            return Math.Max(
                0,
                Math.Min(requestedCursor, nextServerEventCursor));
        }

        public static MatchEventRpc[] CaptureServerEventsSince(
            int matchSequence,
            int eventCursor)
        {
            if (matchSequence != serverEventMatchSequence)
            {
                return Array.Empty<MatchEventRpc>();
            }

            var result = new List<MatchEventRpc>();
            for (var index = 0;
                index < serverEventWindow.Count;
                index += 1)
            {
                var rpc = serverEventWindow[index];
                if (rpc.EventCursor <= eventCursor)
                {
                    continue;
                }
                rpc.IsReplay = true;
                result.Add(rpc);
            }
            return result.ToArray();
        }

        public static bool TryDequeueServerEvent(
            out MatchEventRpc rpc)
        {
            if (serverEventBroadcasts.Count == 0)
            {
                rpc = default;
                return false;
            }
            rpc = serverEventBroadcasts.Dequeue();
            return true;
        }

        public static void RecordEventRpcsSent(
            int count,
            bool replay)
        {
            SentEventRpcCount += count;
            if (replay)
            {
                SentReplayEventRpcCount += count;
            }
        }

        public static void InitializeClientEventCursor(
            int matchSequence,
            int eventCursor)
        {
            if (matchSequence < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(matchSequence));
            }
            if (eventCursor < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(eventCursor));
            }
            if (clientEventMatchSequence != matchSequence)
            {
                clientPendingEvents.Clear();
                clientEventMatchSequence = matchSequence;
                clientLastEventCursor = 0;
            }
            clientLastEventCursor = Math.Max(
                clientLastEventCursor,
                eventCursor);
            RemoveConsumedClientEvents();
        }

        public static void RecordClientEvent(MatchEventRpc rpc)
        {
            if (rpc.EventCursor <= 0 ||
                rpc.MatchSequence < clientEventMatchSequence)
            {
                IgnoredEventRpcCount += 1;
                return;
            }
            if (rpc.MatchSequence > clientEventMatchSequence)
            {
                clientPendingEvents.Clear();
                clientEventMatchSequence = rpc.MatchSequence;
                clientLastEventCursor = 0;
            }
            if (rpc.EventCursor <= clientLastEventCursor ||
                clientPendingEvents.ContainsKey(rpc.EventCursor))
            {
                IgnoredEventRpcCount += 1;
                return;
            }

            clientPendingEvents.Add(rpc.EventCursor, rpc);
            ReceivedEventRpcCount += 1;
            if (rpc.IsReplay)
            {
                ReceivedReplayEventRpcCount += 1;
            }
        }

        public static bool TryDequeueClientEvent(
            int matchSequence,
            out SimEvent simEvent)
        {
            simEvent = null;
            if (matchSequence != clientEventMatchSequence ||
                clientPendingEvents.Count == 0)
            {
                return false;
            }

            using var enumerator =
                clientPendingEvents.GetEnumerator();
            if (!enumerator.MoveNext())
            {
                return false;
            }
            var pair = enumerator.Current;
            clientPendingEvents.Remove(pair.Key);
            clientLastEventCursor = pair.Key;
            simEvent = MatchNetworkEventCodec.Decode(pair.Value);
            return true;
        }

        internal static void PrepareClientEventMatch(
            int matchSequence)
        {
            if (clientEventMatchSequence == matchSequence)
            {
                return;
            }
            clientPendingEvents.Clear();
            clientEventMatchSequence = matchSequence;
            clientLastEventCursor = 0;
        }

        private static void EnsureServerEventMatch(int matchSequence)
        {
            if (matchSequence < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(matchSequence));
            }
            if (serverEventMatchSequence != matchSequence)
            {
                ResetServerEventMatch(matchSequence);
            }
        }

        internal static void ResetServerEventMatch(int matchSequence)
        {
            serverEventWindow.Clear();
            serverEventBroadcasts.Clear();
            serverEventMatchSequence = matchSequence;
            nextServerEventCursor = 0;
        }

        internal static void PruneServerEventWindow(int currentTick)
        {
            var minimumTick =
                currentTick -
                MatchNetworkDefaults.ReconnectGraceTicks;
            while (serverEventWindow.Count > 0 &&
                (
                    serverEventWindow[0].Tick < minimumTick ||
                    serverEventWindow.Count >
                        MaximumBufferedMatchEvents
                ))
            {
                serverEventWindow.RemoveAt(0);
            }
        }

        private static void RemoveConsumedClientEvents()
        {
            while (clientPendingEvents.Count > 0)
            {
                using var enumerator =
                    clientPendingEvents.GetEnumerator();
                if (!enumerator.MoveNext() ||
                    enumerator.Current.Key >
                        clientLastEventCursor)
                {
                    return;
                }
                clientPendingEvents.Remove(
                    enumerator.Current.Key);
            }
        }

        private static void ResetServerEventState()
        {
            ResetServerEventMatch(0);
            SentEventRpcCount = 0;
            SentReplayEventRpcCount = 0;
        }

        private static void ResetClientEventState()
        {
            clientPendingEvents.Clear();
            clientEventMatchSequence = 0;
            clientLastEventCursor = 0;
            ReceivedEventRpcCount = 0;
            ReceivedReplayEventRpcCount = 0;
            IgnoredEventRpcCount = 0;
        }
    }
}
