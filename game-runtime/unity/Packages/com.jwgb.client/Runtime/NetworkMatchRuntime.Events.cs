using Jwgb.Netcode;

namespace Jwgb.Client
{
    public sealed partial class NetworkMatchRuntime
    {
        private void DrainNetworkEvents()
        {
            if (Snapshot == null)
            {
                return;
            }

            receivedEvents.Clear();
            while (MatchNetworkRuntimeState.TryDequeueClientEvent(
                lastMatchSequence,
                out var simEvent))
            {
                receivedEvents.Add(simEvent);
            }
            if (receivedEvents.Count > 0)
            {
                EventsReceived?.Invoke(receivedEvents.ToArray());
            }
        }
    }
}
