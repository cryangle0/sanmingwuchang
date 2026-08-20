using System;
using Jwgb.Content;
using Jwgb.Netcode;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class NetworkRuntimeOptionsTests
    {
        [Test]
        public void UsesOfflineDefaultsWithoutNetworkArguments()
        {
            var configuration = NetworkRuntimeOptions.Parse(
                new[] { "JourneyWestGreatBrawl.exe" });

            Assert.That(configuration.ClientEnabled, Is.False);
            Assert.That(configuration.ServerEnabled, Is.False);
            Assert.That(configuration.ServerAddress, Is.EqualTo("127.0.0.1"));
            Assert.That(
                configuration.Port,
                Is.EqualTo(MatchNetworkDefaults.Port));
            Assert.That(
                configuration.ClientHeroId,
                Is.EqualTo(GameplayIds.SunWukong));
        }

        [Test]
        public void ParsesExplicitClientEndpointAndSmokeReport()
        {
            var configuration = NetworkRuntimeOptions.Parse(
                new[]
                {
                    "JourneyWestGreatBrawl.exe",
                    "-jwgbNetworkClient",
                    "-jwgbServerAddress",
                    "192.0.2.10",
                    "-jwgbServerPort",
                    "9001",
                    "-jwgbNetworkSmokeReport",
                    "report.json",
                    "-jwgbReconnectTicket",
                    "0123456789abcdef0123456789abcdef",
                    "-jwgbLastEventMatchSequence",
                    "3",
                    "-jwgbLastEventCursor",
                    "42",
                    "-jwgbHeroId",
                    GameplayIds.IronFanPrincess
                });

            Assert.That(configuration.ClientEnabled, Is.True);
            Assert.That(
                configuration.ServerAddress,
                Is.EqualTo("192.0.2.10"));
            Assert.That(configuration.Port, Is.EqualTo(9001));
            Assert.That(
                configuration.ClientSmokeReportPath,
                Is.EqualTo("report.json"));
            Assert.That(
                configuration.ReconnectTicket,
                Is.EqualTo(
                    "0123456789abcdef0123456789abcdef"));
            Assert.That(
                configuration.ClientHeroId,
                Is.EqualTo(GameplayIds.IronFanPrincess));
            Assert.That(
                configuration.LastEventMatchSequence,
                Is.EqualTo(3));
            Assert.That(
                configuration.LastEventCursor,
                Is.EqualTo(42));
        }

        [Test]
        public void RejectsInvalidPort()
        {
            Assert.Throws<ArgumentException>(
                () => NetworkRuntimeOptions.Parse(
                    new[]
                    {
                        "JourneyWestGreatBrawl.exe",
                        "-jwgbServerPort",
                        "0"
                    }));
        }

        [Test]
        public void RejectsUnknownHero()
        {
            Assert.Throws<ArgumentException>(
                () => NetworkRuntimeOptions.Parse(
                    new[]
                    {
                        "JourneyWestGreatBrawl.exe",
                        "-jwgbHeroId",
                        "H999"
                    }));
        }

        [Test]
        public void RuntimeJoinOptionsOverrideHeroAndReconnectTicket()
        {
            try
            {
                NetworkClientJoinOptions.Configure(
                    GameplayIds.BullDemonKing,
                    "ticket-123",
                    requestedEventMatchSequence: 2,
                    requestedEventCursor: 12);

                Assert.That(
                    NetworkClientJoinOptions.RequestedHeroId,
                    Is.EqualTo(GameplayIds.BullDemonKing));
                Assert.That(
                    NetworkClientJoinOptions.ReconnectTicket,
                    Is.EqualTo("ticket-123"));
                Assert.That(
                    NetworkClientJoinOptions.LastEventMatchSequence,
                    Is.EqualTo(2));
                Assert.That(
                    NetworkClientJoinOptions.LastEventCursor,
                    Is.EqualTo(12));
            }
            finally
            {
                NetworkClientJoinOptions.Reset();
            }
        }

        [Test]
        public void RuntimeJoinOptionsRejectUnknownHero()
        {
            Assert.Throws<ArgumentException>(
                () => NetworkClientJoinOptions.Configure(
                    "H999",
                    null));
        }
    }
}
