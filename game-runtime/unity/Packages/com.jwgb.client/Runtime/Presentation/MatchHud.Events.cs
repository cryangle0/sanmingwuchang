using Jwgb.Sim.Deterministic;

namespace Jwgb.Client.Presentation
{
    public sealed partial class MatchHud
    {
        private void OnNetworkEventsReceived(SimEvent[] events)
        {
            if (!IsNetworkMode)
            {
                return;
            }
            AppendEvents(networkRuntime?.Snapshot, events);
        }

        private void AppendEvents(
            WorldSnapshot snapshot,
            SimEvent[] events)
        {
            if (snapshot == null || events == null)
            {
                return;
            }
            for (var index = 0; index < events.Length; index += 1)
            {
                var text = MatchHudText.EventText(
                    snapshot,
                    events[index]);
                if (string.IsNullOrEmpty(text))
                {
                    continue;
                }
                feed.Enqueue(text);
                while (feed.Count > 5)
                {
                    feed.Dequeue();
                }
            }
            elements.Feed.text = string.Join("\n", feed);
        }
    }
}
