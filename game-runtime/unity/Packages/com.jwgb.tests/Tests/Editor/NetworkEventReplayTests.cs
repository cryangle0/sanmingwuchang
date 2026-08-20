using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class NetworkEventReplayTests
    {
        [SetUp]
        public void SetUp()
        {
            MatchNetworkRuntimeState.ResetProcessState();
        }

        [TearDown]
        public void TearDown()
        {
            MatchNetworkRuntimeState.ResetProcessState();
        }

        [Test]
        public void ServerBuffersOnlyHudEventsWithStableCursors()
        {
            MatchNetworkRuntimeState.PublishServerEvents(
                new[]
                {
                    Event("damage-applied", 10),
                    Event("critical-hit", 11),
                    Event("active-cast", 12)
                },
                matchSequence: 0);

            var replay =
                MatchNetworkRuntimeState.CaptureServerEventsSince(
                    matchSequence: 0,
                    eventCursor: 0);

            Assert.That(replay, Has.Length.EqualTo(2));
            Assert.That(replay[0].EventCursor, Is.EqualTo(1));
            Assert.That(replay[1].EventCursor, Is.EqualTo(2));
            Assert.That(replay[0].IsReplay, Is.True);
            Assert.That(
                MatchNetworkRuntimeState.BufferedServerEventCount,
                Is.EqualTo(2));
        }

        [Test]
        public void ReconnectOnlyReceivesEventsAfterItsCursor()
        {
            MatchNetworkRuntimeState.PublishServerEvents(
                new[]
                {
                    Event("critical-hit", 10),
                    Event("true-death", 11),
                    Event("eliminated", 12)
                },
                matchSequence: 3);

            var replay =
                MatchNetworkRuntimeState.CaptureServerEventsSince(
                    matchSequence: 3,
                    eventCursor: 1);

            Assert.That(replay, Has.Length.EqualTo(2));
            Assert.That(replay[0].EventCursor, Is.EqualTo(2));
            Assert.That(replay[1].EventCursor, Is.EqualTo(3));
            Assert.That(
                MatchNetworkRuntimeState
                    .ResolveServerEventReplayCursor(3, 99),
                Is.EqualTo(3));
        }

        [Test]
        public void EventWindowExpiresAtTheReconnectBoundary()
        {
            MatchNetworkRuntimeState.PublishServerEvents(
                new[] { Event("critical-hit", 0) },
                matchSequence: 0);

            MatchNetworkRuntimeState.PublishServerSnapshot(
                Snapshot(
                    MatchNetworkDefaults.ReconnectGraceTicks + 1),
                matchSequence: 0);

            Assert.That(
                MatchNetworkRuntimeState.BufferedServerEventCount,
                Is.Zero);
            Assert.That(
                MatchNetworkRuntimeState.CaptureServerEventsSince(
                    0,
                    0),
                Is.Empty);
        }

        [Test]
        public void ClientDeduplicatesReplayAndTracksConsumedCursor()
        {
            MatchNetworkRuntimeState.InitializeClientEventCursor(
                matchSequence: 0,
                eventCursor: 1);
            var rpc = Encode(
                Event("critical-hit", 20),
                matchSequence: 0,
                cursor: 2,
                replay: true);

            MatchNetworkRuntimeState.RecordClientEvent(rpc);
            rpc.IsReplay = false;
            MatchNetworkRuntimeState.RecordClientEvent(rpc);

            Assert.That(
                MatchNetworkRuntimeState.TryDequeueClientEvent(
                    0,
                    out var simEvent),
                Is.True);
            Assert.That(simEvent.Type, Is.EqualTo("critical-hit"));
            Assert.That(
                MatchNetworkRuntimeState.ClientLastEventCursor,
                Is.EqualTo(2));
            Assert.That(
                MatchNetworkRuntimeState.ReceivedEventRpcCount,
                Is.EqualTo(1));
            Assert.That(
                MatchNetworkRuntimeState
                    .ReceivedReplayEventRpcCount,
                Is.EqualTo(1));
            Assert.That(
                MatchNetworkRuntimeState.IgnoredEventRpcCount,
                Is.EqualTo(1));
        }

        [Test]
        public void RematchClearsOldServerAndClientEventScopes()
        {
            MatchNetworkRuntimeState.PublishServerEvents(
                new[] { Event("critical-hit", 20) },
                matchSequence: 0);
            MatchNetworkRuntimeState.PublishServerSnapshot(
                Snapshot(1),
                matchSequence: 1);
            MatchNetworkRuntimeState.PublishServerEvents(
                new[] { Event("true-death", 2) },
                matchSequence: 1);

            var replay =
                MatchNetworkRuntimeState.CaptureServerEventsSince(
                    1,
                    0);

            Assert.That(replay, Has.Length.EqualTo(1));
            Assert.That(replay[0].EventCursor, Is.EqualTo(1));
            MatchNetworkRuntimeState.InitializeClientEventCursor(1, 0);
            MatchNetworkRuntimeState.RecordClientEvent(
                Encode(
                    Event("critical-hit", 20),
                    matchSequence: 0,
                    cursor: 1,
                    replay: true));
            Assert.That(
                MatchNetworkRuntimeState.TryDequeueClientEvent(
                    1,
                    out _),
                Is.False);
            Assert.That(
                MatchNetworkRuntimeState.IgnoredEventRpcCount,
                Is.EqualTo(1));
        }

        [Test]
        public void ActiveCastRoundTripsByCatalogId()
        {
            var source = Event("active-cast", 40);
            source.ActiveAbilityId = "A009";

            var decoded = MatchNetworkEventCodec.Decode(
                Encode(
                    source,
                    matchSequence: 2,
                    cursor: 7,
                    replay: false));

            Assert.That(decoded.Type, Is.EqualTo("active-cast"));
            Assert.That(
                decoded.ActiveAbilityId,
                Is.EqualTo("A009"));
        }

        [Test]
        public void CoreBossCastRoundTripsAnimationFields()
        {
            var source = Event("core-boss-cast", 41);
            source.EntityId = 101;
            source.SourceEntityId = 123;
            source.ActiveAbilityId = "meteor";
            source.Reason = "warning";

            var decoded = MatchNetworkEventCodec.Decode(
                Encode(
                    source,
                    matchSequence: 2,
                    cursor: 8,
                    replay: false));

            Assert.That(decoded.Type, Is.EqualTo("core-boss-cast"));
            Assert.That(decoded.EntityId, Is.EqualTo(101));
            Assert.That(decoded.SourceEntityId, Is.EqualTo(123));
            Assert.That(decoded.ActiveAbilityId, Is.EqualTo("meteor"));
            Assert.That(decoded.Reason, Is.EqualTo("warning"));
        }

        private static MatchEventRpc Encode(
            SimEvent simEvent,
            int matchSequence,
            int cursor,
            bool replay)
        {
            Assert.That(
                MatchNetworkEventCodec.TryEncode(
                    simEvent,
                    matchSequence,
                    cursor,
                    replay,
                    out var rpc),
                Is.True);
            return rpc;
        }

        private static SimEvent Event(string type, int tick)
        {
            return new SimEvent
            {
                Type = type,
                Tick = tick,
                EntityId = 7,
                SourceEntityId = 8
            };
        }

        private static WorldSnapshot Snapshot(int tick)
        {
            return new WorldSnapshot
            {
                Tick = tick,
                StateHash = "1234abcd",
                Match = new MatchSnapshot
                {
                    Status = MatchStatus.Running
                }
            };
        }
    }
}
