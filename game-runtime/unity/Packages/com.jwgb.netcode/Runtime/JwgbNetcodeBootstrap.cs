using System;
using Unity.NetCode;
using Unity.Networking.Transport;
using UnityEngine;
using UnityEngine.Scripting;

namespace Jwgb.Netcode
{
    [Preserve]
    public sealed class JwgbNetcodeBootstrap : ClientServerBootstrap
    {
        public override bool Initialize(string defaultWorldName)
        {
            Application.runInBackground = true;
            MatchNetworkRuntimeState.ResetProcessState();
            NetworkClientJoinOptions.Reset();
            var configuration = NetworkRuntimeOptions.Configuration;
            AutoConnectPort = configuration.Port;

#if UNITY_SERVER && !UNITY_EDITOR
            CreateServerWorld("JWGB Server World");
            Debug.Log(
                $"JWGB Netcode server listening requested on " +
                $"0.0.0.0:{configuration.Port}");
#else
            if (configuration.ServerEnabled)
            {
                CreateServerWorld("JWGB Server World");
            }
            else if (configuration.ClientEnabled)
            {
                NetworkClientJoinOptions.Configure(
                    configuration.ClientHeroId,
                    configuration.ReconnectTicket,
                    configuration.LastEventMatchSequence,
                    configuration.LastEventCursor);
                var endpoint = NetworkEndpoint.Parse(
                    configuration.ServerAddress,
                    configuration.Port);
                if (!endpoint.IsValid)
                {
                    throw new ArgumentException(
                        "JWGB Netcode client requires a numeric IPv4 or " +
                        $"IPv6 address: {configuration.ServerAddress}");
                }

                DefaultConnectAddress = endpoint;
                CreateClientWorld("JWGB Client World");
            }
            else
            {
                AutoConnectPort = 0;
                CreateLocalWorld(defaultWorldName);
            }
#endif
            return true;
        }
    }
}
