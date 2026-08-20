using System;
using Jwgb.Content;
using Jwgb.Netcode;
using Unity.Entities;
using Unity.NetCode;
using Unity.Networking.Transport;
using UnityEngine;

namespace Jwgb.Client
{
    public sealed partial class ClientBootstrap
    {
        public bool TryConnectOnline(
            string address,
            int port,
            string heroId,
            out string error)
        {
            error = null;
            if (SessionState != ClientSessionState.Local)
            {
                error = "A NETWORK SESSION IS ALREADY ACTIVE";
                return false;
            }
            if (port < 1 || port > ushort.MaxValue)
            {
                error = "SERVER PORT MUST BE BETWEEN 1 AND 65535";
                return false;
            }

            NetworkEndpoint endpoint;
            try
            {
                HeroCatalog.Get(heroId);
                endpoint = NetworkEndpoint.Parse(
                    address?.Trim(),
                    (ushort)port);
            }
            catch (Exception exception)
            {
                error = exception.Message.ToUpperInvariant();
                return false;
            }
            if (!endpoint.IsValid)
            {
                error =
                    "SERVER ADDRESS MUST BE A VALID IPV4 OR IPV6 ADDRESS";
                return false;
            }

            localRuntime?.ReturnToMenu();
            EnsureNetworkRuntime();
            networkRuntime.ResetSession();
            Transactions.Reset();

            var trimmedAddress = address.Trim();
            var canReconnect = CanReconnectTo(
                trimmedAddress,
                port,
                heroId);
            var reconnectTicket = canReconnect
                ? resumableTicket
                : null;
            var reconnectEventMatchSequence = canReconnect
                ? resumableEventMatchSequence
                : 0;
            var reconnectEventCursor = canReconnect
                ? resumableEventCursor
                : 0;
            MatchNetworkRuntimeState.ResetClientConnectionState();
            NetworkClientJoinOptions.Configure(
                heroId,
                reconnectTicket,
                reconnectEventMatchSequence,
                reconnectEventCursor);
            EnsureClientWorld();
            ConfigureConnectionQuery();
            if (connectionQuery.CalculateEntityCount() > 0)
            {
                error =
                    "PREVIOUS NETWORK CONNECTION IS STILL CLOSING";
                return false;
            }

            var request = clientWorld.EntityManager.CreateEntity(
                typeof(NetworkStreamRequestConnect));
            clientWorld.EntityManager.SetComponentData(
                request,
                new NetworkStreamRequestConnect
                {
                    Endpoint = endpoint
                });
            lastServerAddress = trimmedAddress;
            lastServerPort = (ushort)port;
            lastHeroId = heroId;
            hasSeenConnectionEntity = false;
            connectDeadline =
                Time.realtimeSinceStartup + ConnectTimeoutSeconds;
            SetState(
                ClientSessionState.Connecting,
                reconnectTicket == null
                    ? $"CONNECTING TO {lastServerAddress}:{lastServerPort}"
                    : $"RECONNECTING TO {lastServerAddress}:{lastServerPort}");
            return true;
        }

        public void RequestReturnToMenu()
        {
            BeginDisconnect(
                string.Empty,
                preserveReconnectTicket: false);
        }

        public void AbandonReconnect()
        {
            if (SessionState != ClientSessionState.Local)
            {
                return;
            }
            resumableTicket = null;
            resumableEventMatchSequence = 0;
            resumableEventCursor = 0;
            reconnectWindow.Close();
            SetState(
                ClientSessionState.Local,
                "PREVIOUS SESSION ABANDONED");
        }

        public bool TryRequestRematch(out string error)
        {
            error = null;
            if (SessionState != ClientSessionState.InMatch ||
                networkRuntime?.Snapshot?.Match.Status !=
                    Jwgb.Sim.Deterministic.MatchStatus.Finished)
            {
                error = "REMATCH IS ONLY AVAILABLE AFTER MATCH END";
                return false;
            }
            MatchNetworkRuntimeState.QueueClientRematch();
            return true;
        }

        private void EnsureClientWorld()
        {
            var world = ClientServerBootstrap.ClientWorld;
            if (world == null || !world.IsCreated)
            {
                world = ClientServerBootstrap.CreateClientWorld(
                    "JWGB Client World");
            }
            if (clientWorld == world)
            {
                return;
            }
            clientWorld = world;
            connectionQueryCreated = false;
        }

        private void ConfigureConnectionQuery()
        {
            if (clientWorld == null || !clientWorld.IsCreated ||
                connectionQueryCreated)
            {
                return;
            }
            connectionQuery =
                clientWorld.EntityManager.CreateEntityQuery(
                    ComponentType.ReadOnly<
                        NetworkStreamConnection>());
            connectionQueryCreated = true;
        }

        private void EnsureNetworkRuntime()
        {
            if (networkRuntime != null)
            {
                return;
            }
            networkRuntime = GetComponent<NetworkMatchRuntime>();
            if (networkRuntime == null)
            {
                networkRuntime =
                    gameObject.AddComponent<NetworkMatchRuntime>();
            }
            if (!networkRuntimeEventsSubscribed)
            {
                networkRuntime.MatchRestarted +=
                    OnNetworkMatchRestarted;
                networkRuntimeEventsSubscribed = true;
            }
        }
    }
}
