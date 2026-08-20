using System;
using Jwgb.Client;
using Jwgb.Netcode;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class ClientReconnectWindowTests
    {
        [Test]
        public void WindowCountsDownAndExpiresWithoutRoundingToZero()
        {
            var window = new ClientReconnectWindow(
                MatchNetworkDefaults.ReconnectGraceSeconds);

            window.Open(100f);

            Assert.That(window.IsOpen(100f), Is.True);
            Assert.That(
                window.SecondsRemaining(100f),
                Is.EqualTo(MatchNetworkDefaults.ReconnectGraceSeconds));
            Assert.That(window.SecondsRemaining(219.1f), Is.EqualTo(1));
            Assert.That(window.IsOpen(220f), Is.False);
            Assert.That(window.SecondsRemaining(220f), Is.Zero);
        }

        [Test]
        public void ClosingWindowImmediatelyRemovesAvailability()
        {
            var window = new ClientReconnectWindow(
                MatchNetworkDefaults.ReconnectGraceSeconds);
            window.Open(10f);

            window.Close();

            Assert.That(window.IsOpen(10f), Is.False);
            Assert.That(window.SecondsRemaining(10f), Is.Zero);
        }

        [Test]
        public void DurationMustBePositive()
        {
            Assert.Throws<ArgumentOutOfRangeException>(
                () => new ClientReconnectWindow(0f));
        }
    }
}
