using System;
using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim;
using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;
using Unity.Networking.Transport;
using UnityEngine;

namespace Jwgb.Client
{
    public enum ClientSessionState : byte
    {
        Local = 0,
        Connecting = 1,
        InMatch = 2,
        Disconnecting = 3
    }

    public sealed partial class ClientBootstrap : MonoBehaviour
    {
        public const string InteractiveAutoJoinArgument =
            "-jwgbInteractiveNetworkAutoJoin";

        private const string SmokeMoveXArgument =
            "-jwgbNetworkSmokeMoveX";
        private const string SmokeMoveZArgument =
            "-jwgbNetworkSmokeMoveZ";
        private const float ConnectTimeoutSeconds = 12f;

        [SerializeField]
        private bool enableSyntheticStress;

        private readonly LocalPlayerInputReader networkInput =
            new LocalPlayerInputReader();
        private LocalMatchRuntime localRuntime;
        private NetworkMatchRuntime networkRuntime;
        private World clientWorld;
        private EntityQuery connectionQuery;
        private bool connectionQueryCreated;
        private Int2Mm smokeMovement;
        private bool hasSmokeMovement;
        private bool hasSeenConnectionEntity;
        private float connectDeadline;
        private string lastServerAddress = "127.0.0.1";
        private ushort lastServerPort = MatchNetworkDefaults.Port;
        private string lastHeroId = GameplayIds.SunWukong;
        private string resumableTicket;
        private int resumableEventMatchSequence;
        private int resumableEventCursor;
        private string pendingLocalStatus = string.Empty;
        private bool preserveTicketOnDisconnect;
        private bool networkRuntimeEventsSubscribed;
        private readonly ClientReconnectWindow reconnectWindow =
            new ClientReconnectWindow(
                (float)MatchNetworkDefaults.ReconnectGraceTicks /
                MatchNetworkDefaults.SimulationRate);

        public event Action<ClientSessionState, string>
            SessionStateChanged;

        public ClientSessionState SessionState { get; private set; } =
            ClientSessionState.Local;

        public string StatusMessage { get; private set; } =
            string.Empty;

        public bool IsNetworkActive =>
            SessionState != ClientSessionState.Local;

        public bool CanReconnect =>
            SessionState == ClientSessionState.Local &&
            !string.IsNullOrWhiteSpace(resumableTicket) &&
            reconnectWindow.IsOpen(Time.realtimeSinceStartup);

        public int ReconnectSecondsRemaining =>
            CanReconnect
                ? reconnectWindow.SecondsRemaining(
                    Time.realtimeSinceStartup)
                : 0;

        public bool CanReconnectTo(
            string address,
            int port,
            string heroId)
        {
            return CanReconnect &&
                string.Equals(
                    address?.Trim(),
                    lastServerAddress,
                    StringComparison.OrdinalIgnoreCase) &&
                port == lastServerPort &&
                string.Equals(
                    heroId,
                    lastHeroId,
                    StringComparison.Ordinal);
        }

        public NetworkTransactionService Transactions { get; } =
            new NetworkTransactionService();

        private void Awake()
        {
            localRuntime = GetComponent<LocalMatchRuntime>();
            if (!enableSyntheticStress)
            {
                EnsureNetworkRuntime();
            }

            ReadSmokeMovement();
            var configuration = NetworkRuntimeOptions.Configuration;
            if (!string.IsNullOrWhiteSpace(
                configuration.ClientSmokeReportPath))
            {
                gameObject.AddComponent<NetworkClientSmokeCapture>();
            }

            if (!configuration.ClientEnabled)
            {
                return;
            }

            clientWorld = ClientServerBootstrap.ClientWorld;
            ConfigureConnectionQuery();
            lastServerAddress = configuration.ServerAddress;
            lastServerPort = configuration.Port;
            lastHeroId = configuration.ClientHeroId;
            resumableTicket = configuration.ReconnectTicket;
            resumableEventMatchSequence =
                configuration.LastEventMatchSequence;
            resumableEventCursor =
                configuration.LastEventCursor;
            hasSeenConnectionEntity = false;
            connectDeadline =
                Time.realtimeSinceStartup + ConnectTimeoutSeconds;
            SetState(
                ClientSessionState.Connecting,
                $"CONNECTING TO {lastServerAddress}:{lastServerPort}");
        }

        private void Start()
        {
            Debug.Log(
                $"JWGB Unity Client | ruleset {SimulationConstants.RulesetVersion} | " +
                $"{SimulationConstants.TicksPerSecond} Hz");

            var configuration = NetworkRuntimeOptions.Configuration;
            if (configuration.ClientEnabled)
            {
                Debug.Log(
                    "JWGB Netcode client mode | " +
                    $"{configuration.ServerAddress}:" +
                    $"{configuration.Port}");
                return;
            }

            if (Array.IndexOf(
                    Environment.GetCommandLineArgs(),
                    InteractiveAutoJoinArgument) >= 0)
            {
                if (!TryConnectOnline(
                        configuration.ServerAddress,
                        configuration.Port,
                        configuration.ClientHeroId,
                        out var error))
                {
                    Debug.LogError(error);
                    Application.Quit(1);
                }
                return;
            }

            if (!enableSyntheticStress)
            {
                return;
            }

            var world = World.DefaultGameObjectInjectionWorld;
            if (world == null || !world.IsCreated)
            {
                Debug.LogError("JWGB default ECS world is unavailable.");
                return;
            }

            SimulationWorldConfigurator.ConfigureFixedRate(world);
            SyntheticStressSpawner.Spawn(
                world.EntityManager,
                SyntheticStressProfile.Baseline);
        }

        private void Update()
        {
            UpdateReconnectWindow();
            UpdateConnectionState();
            Transactions.DrainCompleted(
                networkRuntime?.Snapshot);
            if (SessionState != ClientSessionState.Connecting &&
                SessionState != ClientSessionState.InMatch)
            {
                return;
            }

            if (networkRuntime != null &&
                networkRuntime.Snapshot != null)
            {
                networkInput.Capture(
                    Camera.main,
                    networkRuntime.Snapshot,
                    networkRuntime.LocalEntityId);
            }
            else
            {
                networkInput.CaptureKeyboardOnly();
            }
            var command = networkInput.ConsumeCommand();
            MatchNetworkRuntimeState.SetClientInput(
                new NetworkInputSample(
                    hasSmokeMovement
                        ? smokeMovement.X
                        : command.MoveX,
                    hasSmokeMovement
                        ? smokeMovement.Z
                        : command.MoveZ,
                    command.AimX,
                    command.AimZ,
                    command.Attack,
                    command.CastActive,
                    command.Interact));
        }

        private void OnDestroy()
        {
            if (networkRuntimeEventsSubscribed &&
                networkRuntime != null)
            {
                networkRuntime.MatchRestarted -=
                    OnNetworkMatchRestarted;
            }
        }

        private void OnNetworkMatchRestarted()
        {
            Transactions.Reset();
        }

        private void ReadSmokeMovement()
        {
            var arguments = Environment.GetCommandLineArgs();
            var hasX = TryReadInt(
                arguments,
                SmokeMoveXArgument,
                out var moveX);
            var hasZ = TryReadInt(
                arguments,
                SmokeMoveZArgument,
                out var moveZ);
            hasSmokeMovement = hasX || hasZ;
            if (hasSmokeMovement)
            {
                smokeMovement = IntegerMath.NormalizeAxisPair(
                    moveX,
                    moveZ);
            }
        }

        private static bool TryReadInt(
            string[] arguments,
            string name,
            out int value)
        {
            value = 0;
            var index = Array.IndexOf(arguments, name);
            return index >= 0 &&
                index + 1 < arguments.Length &&
                int.TryParse(arguments[index + 1], out value);
        }
    }
}
