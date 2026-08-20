using System;
using System.Text;
using Jwgb.Content;

namespace Jwgb.Netcode
{
    public static class NetworkClientJoinOptions
    {
        private static string requestedHeroId =
            GameplayIds.SunWukong;
        private static string reconnectTicket;
        private static int lastEventMatchSequence;
        private static int lastEventCursor;

        public static string RequestedHeroId => requestedHeroId;

        public static string ReconnectTicket => reconnectTicket;

        public static int LastEventMatchSequence =>
            lastEventMatchSequence;

        public static int LastEventCursor => lastEventCursor;

        public static void Configure(
            string heroId,
            string requestedReconnectTicket,
            int requestedEventMatchSequence = 0,
            int requestedEventCursor = 0)
        {
            HeroCatalog.Get(heroId);
            if (requestedReconnectTicket != null &&
                Encoding.UTF8.GetByteCount(
                    requestedReconnectTicket) > 60)
            {
                throw new ArgumentException(
                    "Reconnect ticket is too long.",
                    nameof(requestedReconnectTicket));
            }
            if (requestedEventMatchSequence < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(requestedEventMatchSequence));
            }
            if (requestedEventCursor < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(requestedEventCursor));
            }

            requestedHeroId = heroId;
            reconnectTicket = requestedReconnectTicket;
            lastEventMatchSequence =
                requestedEventMatchSequence;
            lastEventCursor = requestedEventCursor;
        }

        public static void Reset()
        {
            requestedHeroId = GameplayIds.SunWukong;
            reconnectTicket = null;
            lastEventMatchSequence = 0;
            lastEventCursor = 0;
        }
    }
}
