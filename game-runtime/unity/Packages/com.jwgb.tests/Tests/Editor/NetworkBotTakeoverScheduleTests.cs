using System;
using System.Collections.Generic;
using Jwgb.Netcode;
using Jwgb.Server;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class NetworkBotTakeoverScheduleTests
    {
        [Test]
        public void TakeoverStartsAtTheConfiguredNextTick()
        {
            var schedule = new NetworkBotTakeoverSchedule(
                MatchNetworkDefaults.BotTakeoverDelayTicks);
            var controlled = new HashSet<int> { 7 };

            schedule.Schedule(7, currentTick: 80);

            schedule.ApplyReady(139, controlled);
            Assert.That(controlled, Has.Member(7));
            Assert.That(schedule.IsScheduled(7), Is.True);

            schedule.ApplyReady(140, controlled);
            Assert.That(controlled, Has.No.Member(7));
            Assert.That(schedule.IsScheduled(7), Is.False);
        }

        [Test]
        public void ReconnectCancelsPendingTakeover()
        {
            var schedule = new NetworkBotTakeoverSchedule(60);
            var controlled = new HashSet<int> { 9 };

            schedule.Schedule(9, currentTick: 10);
            schedule.Cancel(9);
            schedule.ApplyReady(70, controlled);

            Assert.That(controlled, Has.Member(9));
            Assert.That(schedule.Count, Is.Zero);
        }

        [Test]
        public void ConstructorRejectsInvalidDelay()
        {
            Assert.Throws<ArgumentOutOfRangeException>(
                () => new NetworkBotTakeoverSchedule(0));
        }
    }
}
