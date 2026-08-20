using Jwgb.Netcode;
using Unity.Collections;
using Unity.NetCode;
using UnityEngine;

namespace Jwgb.Client
{
    public sealed partial class ClientBootstrap
    {
        private void UpdateReconnectWindow()
        {
            if (SessionState != ClientSessionState.Local ||
                string.IsNullOrWhiteSpace(resumableTicket) ||
                reconnectWindow.IsOpen(Time.realtimeSinceStartup))
            {
                return;
            }
            resumableTicket = null;
            resumableEventMatchSequence = 0;
            resumableEventCursor = 0;
            reconnectWindow.Close();
            SetState(
                ClientSessionState.Local,
                "RECONNECT WINDOW EXPIRED");
        }

        private void UpdateConnectionState()
        {
            if (SessionState == ClientSessionState.Local ||
                clientWorld == null ||
                !clientWorld.IsCreated)
            {
                return;
            }

            ConfigureConnectionQuery();
            var connectionCount =
                connectionQuery.CalculateEntityCount();
            hasSeenConnectionEntity |= connectionCount > 0;
            if (SessionState == ClientSessionState.Connecting)
            {
                UpdateConnectingState(connectionCount);
                return;
            }
            if (SessionState == ClientSessionState.InMatch &&
                connectionCount == 0)
            {
                resumableTicket =
                    MatchNetworkRuntimeState.ClientReconnectTicket;
                CaptureResumableEventCursor();
                if (!string.IsNullOrWhiteSpace(resumableTicket))
                {
                    reconnectWindow.Open(Time.realtimeSinceStartup);
                }
                CompleteReturnToLocal(
                    "CONNECTION LOST - SESSION RESERVED",
                    preserveReconnectTicket: true);
                return;
            }
            if (SessionState == ClientSessionState.Disconnecting &&
                connectionCount == 0)
            {
                CompleteReturnToLocal(
                    pendingLocalStatus,
                    preserveTicketOnDisconnect);
            }
        }

        private void UpdateConnectingState(int connectionCount)
        {
            if (MatchNetworkRuntimeState.ClientEntityId > 0)
            {
                resumableTicket =
                    MatchNetworkRuntimeState.ClientReconnectTicket;
                CaptureResumableEventCursor();
                reconnectWindow.Close();
                SetState(
                    ClientSessionState.InMatch,
                    MatchNetworkRuntimeState.ClientResumedSession
                        ? "MATCH RECONNECTED"
                        : "MATCH CONNECTED");
                return;
            }
            if (hasSeenConnectionEntity && connectionCount == 0)
            {
                CompleteReturnToLocal(
                    "MATCH SERVER REJECTED THE JOIN REQUEST",
                    preserveReconnectTicket: false);
                return;
            }
            if (Time.realtimeSinceStartup >= connectDeadline)
            {
                BeginDisconnect(
                    "CONNECTION TIMED OUT",
                    preserveReconnectTicket: true);
            }
        }

        private void BeginDisconnect(
            string localStatus,
            bool preserveReconnectTicket)
        {
            pendingLocalStatus = localStatus ?? string.Empty;
            preserveTicketOnDisconnect =
                preserveReconnectTicket;
            if (preserveReconnectTicket &&
                !string.IsNullOrWhiteSpace(
                    MatchNetworkRuntimeState
                        .ClientReconnectTicket))
            {
                resumableTicket =
                    MatchNetworkRuntimeState.ClientReconnectTicket;
            }

            if (clientWorld == null || !clientWorld.IsCreated)
            {
                CompleteReturnToLocal(
                    pendingLocalStatus,
                    preserveTicketOnDisconnect);
                return;
            }

            ConfigureConnectionQuery();
            using var connections =
                connectionQuery.ToEntityArray(Allocator.Temp);
            for (var index = 0;
                index < connections.Length;
                index += 1)
            {
                var connection = connections[index];
                if (!clientWorld.EntityManager.HasComponent<
                    NetworkStreamRequestDisconnect>(connection))
                {
                    clientWorld.EntityManager.AddComponent<
                        NetworkStreamRequestDisconnect>(connection);
                }
            }
            if (connections.Length == 0)
            {
                CompleteReturnToLocal(
                    pendingLocalStatus,
                    preserveTicketOnDisconnect);
                return;
            }
            SetState(
                ClientSessionState.Disconnecting,
                "LEAVING MATCH");
        }

        private void CompleteReturnToLocal(
            string status,
            bool preserveReconnectTicket)
        {
            if (!preserveReconnectTicket)
            {
                resumableTicket = null;
                resumableEventMatchSequence = 0;
                resumableEventCursor = 0;
                reconnectWindow.Close();
            }
            networkInput.Reset();
            networkRuntime?.ResetSession();
            Transactions.Reset();
            MatchNetworkRuntimeState.ResetClientConnectionState();
            NetworkClientJoinOptions.Reset();
            hasSeenConnectionEntity = false;
            pendingLocalStatus = string.Empty;
            preserveTicketOnDisconnect = false;
            SetState(
                ClientSessionState.Local,
                status ?? string.Empty);
        }

        private void CaptureResumableEventCursor()
        {
            resumableEventMatchSequence =
                MatchNetworkRuntimeState.ClientEventMatchSequence;
            resumableEventCursor =
                MatchNetworkRuntimeState.ClientLastEventCursor;
        }

        private void SetState(
            ClientSessionState state,
            string status)
        {
            SessionState = state;
            StatusMessage = status ?? string.Empty;
            SessionStateChanged?.Invoke(
                SessionState,
                StatusMessage);
        }
    }
}
