using System;
using System.Text;
using Jwgb.Content;

namespace Jwgb.Netcode
{
    public readonly struct MatchNetworkConfiguration
    {
        public MatchNetworkConfiguration(
            bool clientEnabled,
            bool serverEnabled,
            string serverAddress,
            ushort port,
            string clientSmokeReportPath,
            string reconnectTicket,
            string clientHeroId,
            int lastEventMatchSequence,
            int lastEventCursor)
        {
            ClientEnabled = clientEnabled;
            ServerEnabled = serverEnabled;
            ServerAddress = serverAddress;
            Port = port;
            ClientSmokeReportPath = clientSmokeReportPath;
            ReconnectTicket = reconnectTicket;
            ClientHeroId = clientHeroId;
            LastEventMatchSequence = lastEventMatchSequence;
            LastEventCursor = lastEventCursor;
        }

        public bool ClientEnabled { get; }

        public bool ServerEnabled { get; }

        public string ServerAddress { get; }

        public ushort Port { get; }

        public string ClientSmokeReportPath { get; }

        public string ReconnectTicket { get; }

        public string ClientHeroId { get; }

        public int LastEventMatchSequence { get; }

        public int LastEventCursor { get; }
    }

    public static class NetworkRuntimeOptions
    {
        public const string ClientArgument = "-jwgbNetworkClient";
        public const string ServerArgument = "-jwgbNetworkServer";
        public const string AddressArgument = "-jwgbServerAddress";
        public const string PortArgument = "-jwgbServerPort";
        public const string ClientSmokeReportArgument =
            "-jwgbNetworkSmokeReport";
        public const string ReconnectTicketArgument =
            "-jwgbReconnectTicket";
        public const string HeroIdArgument = "-jwgbHeroId";
        public const string LastEventMatchSequenceArgument =
            "-jwgbLastEventMatchSequence";
        public const string LastEventCursorArgument =
            "-jwgbLastEventCursor";

        public static MatchNetworkConfiguration Configuration =>
            Parse(Environment.GetCommandLineArgs());

        public static MatchNetworkConfiguration Parse(string[] arguments)
        {
            if (arguments == null)
            {
                throw new ArgumentNullException(nameof(arguments));
            }

            var clientEnabled =
                Array.IndexOf(arguments, ClientArgument) >= 0;
            var serverEnabled =
                Array.IndexOf(arguments, ServerArgument) >= 0;
            var address = ReadValue(arguments, AddressArgument) ??
                "127.0.0.1";
            var portText = ReadValue(arguments, PortArgument);
            var port = MatchNetworkDefaults.Port;
            if (portText != null &&
                (!ushort.TryParse(portText, out port) || port == 0))
            {
                throw new ArgumentException(
                    $"Invalid value for {PortArgument}: {portText}");
            }

            var reconnectTicket = ReadValue(
                arguments,
                ReconnectTicketArgument);
            if (reconnectTicket != null &&
                Encoding.UTF8.GetByteCount(reconnectTicket) > 60)
            {
                throw new ArgumentException(
                    $"Value for {ReconnectTicketArgument} is too long.");
            }
            var clientHeroId =
                ReadValue(arguments, HeroIdArgument) ??
                GameplayIds.SunWukong;
            HeroCatalog.Get(clientHeroId);
            var lastEventMatchSequence = ReadNonNegativeInt(
                arguments,
                LastEventMatchSequenceArgument);
            var lastEventCursor = ReadNonNegativeInt(
                arguments,
                LastEventCursorArgument);

            return new MatchNetworkConfiguration(
                clientEnabled,
                serverEnabled,
                address,
                port,
                ReadValue(arguments, ClientSmokeReportArgument),
                reconnectTicket,
                clientHeroId,
                lastEventMatchSequence,
                lastEventCursor);
        }

        private static int ReadNonNegativeInt(
            string[] arguments,
            string argument)
        {
            var value = ReadValue(arguments, argument);
            if (value == null)
            {
                return 0;
            }
            if (!int.TryParse(value, out var result) ||
                result < 0)
            {
                throw new ArgumentException(
                    $"Invalid value for {argument}: {value}");
            }
            return result;
        }

        private static string ReadValue(
            string[] arguments,
            string argument)
        {
            var index = Array.IndexOf(arguments, argument);
            if (index < 0)
            {
                return null;
            }
            if (index + 1 >= arguments.Length ||
                string.IsNullOrWhiteSpace(arguments[index + 1]))
            {
                throw new ArgumentException(
                    $"Missing value for {argument}.");
            }
            return arguments[index + 1];
        }
    }
}
