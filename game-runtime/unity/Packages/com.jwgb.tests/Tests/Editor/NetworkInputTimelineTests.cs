using System.Collections.Generic;
using Jwgb.Netcode;
using Jwgb.Server;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class NetworkInputTimelineTests
    {
        [Test]
        public void ConsumesEveryInputOnePerSimulationTick()
        {
            var timeline = new NetworkInputTimeline();
            timeline.SetConnected(7, connected: true);
            Assert.That(
                timeline.Enqueue(Input(7, 11)),
                Is.True);
            Assert.That(
                timeline.Enqueue(Input(7, 12)),
                Is.True);
            var intents =
                new Dictionary<int, PlayerIntent>();
            var processed = new List<int>();

            timeline.PrepareTick(
                intents,
                (_, sequence) => processed.Add(sequence));

            Assert.That(intents[7].Sequence, Is.EqualTo(11));
            Assert.That(timeline.PendingCount(7), Is.EqualTo(1));
            Assert.That(processed, Is.EqualTo(new[] { 11 }));

            timeline.PrepareTick(
                intents,
                (_, sequence) => processed.Add(sequence));

            Assert.That(intents[7].Sequence, Is.EqualTo(12));
            Assert.That(timeline.PendingCount(7), Is.Zero);
            Assert.That(processed, Is.EqualTo(new[] { 11, 12 }));
        }

        [Test]
        public void DisconnectClearsPendingInputs()
        {
            var timeline = new NetworkInputTimeline();
            timeline.SetConnected(9, connected: true);
            timeline.Enqueue(Input(9, 1));

            timeline.SetConnected(9, connected: false);

            Assert.That(timeline.PendingCount(9), Is.Zero);
            Assert.That(timeline.Enqueue(Input(9, 2)), Is.False);
        }

        [Test]
        public void RematchClearsPendingInputsButKeepsConnections()
        {
            var timeline = new NetworkInputTimeline();
            timeline.SetConnected(9, connected: true);
            timeline.Enqueue(Input(9, 1));

            timeline.ClearPending();

            Assert.That(timeline.PendingCount(9), Is.Zero);
            Assert.That(timeline.Enqueue(Input(9, 2)), Is.True);
        }

        private static AcceptedNetworkInput Input(
            int entityId,
            int sequence)
        {
            return new AcceptedNetworkInput(
                entityId,
                new MatchInputRpc
                {
                    Sequence = sequence,
                    MoveX = 1_000,
                    MoveZ = 0,
                    AimX = 1_000,
                    AimZ = 0,
                    Interact = true
                });
        }
    }
}
