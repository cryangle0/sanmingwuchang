using System.Collections.Generic;
using Jwgb.Client;
using Jwgb.Content;
using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    [DisallowMultipleComponent]
    [RequireComponent(typeof(UIDocument))]
    public sealed partial class MatchHud : MonoBehaviour
    {
        private enum HudScreen : byte
        {
            MainMenu = 0,
            Connecting = 1,
            InMatch = 2,
            Results = 3
        }

        [SerializeField]
        private LocalMatchRuntime runtime;

        private ClientBootstrap clientBootstrap;
        private NetworkMatchRuntime networkRuntime;
        private readonly Queue<string> feed = new Queue<string>();
        private readonly MatchHudOutcomeController outcomeController =
            new MatchHudOutcomeController();
        private MatchHudElements elements;
        private MinimapView minimap;
        private TouchControlsOverlay touchControls;
        private string selectedHeroId = GameplayIds.SunWukong;
        private bool onlineSelected;
        private HudScreen screen;

        private void Start()
        {
            elements = MatchHudBuilder.Build(
                GetComponent<UIDocument>().rootVisualElement);
            ConfigureControls();
            minimap = new MinimapView(elements.InMatchLayer);
            if (TouchControlsOverlay.ShouldEnable)
            {
                touchControls = new TouchControlsOverlay(
                    elements.InMatchLayer,
                    TouchControlState.Shared);
            }

            clientBootstrap =
                FindFirstObjectByType<ClientBootstrap>();
            networkRuntime =
                FindFirstObjectByType<NetworkMatchRuntime>();
            if (runtime == null)
            {
                runtime = FindFirstObjectByType<LocalMatchRuntime>();
            }

            if (clientBootstrap != null)
            {
                clientBootstrap.SessionStateChanged +=
                    OnClientSessionStateChanged;
            }
            if (networkRuntime != null)
            {
                networkRuntime.SnapshotChanged +=
                    OnNetworkSnapshotChanged;
                networkRuntime.EventsReceived +=
                    OnNetworkEventsReceived;
            }
            if (runtime != null)
            {
                runtime.FrameAdvanced += OnFrameAdvanced;
                runtime.SessionStarted += OnSessionStarted;
                runtime.SessionStopped += OnSessionStopped;
                elements.CompetitorSlider.value =
                    runtime.DefaultCompetitorCount;
            }
            InitializeTransactionPanel();

            var configuration = NetworkRuntimeOptions.Configuration;
            elements.ServerAddress.value =
                configuration.ServerAddress;
            elements.ServerPort.value = configuration.Port;
            onlineSelected = configuration.ClientEnabled;
            SelectHero(configuration.ClientEnabled
                ? configuration.ClientHeroId
                : runtime?.SelectedHeroId ??
                    GameplayIds.SunWukong);
            UpdateMenuMode();

            if (clientBootstrap != null)
            {
                switch (clientBootstrap.SessionState)
                {
                    case ClientSessionState.Connecting:
                    case ClientSessionState.Disconnecting:
                        ShowConnecting(
                            clientBootstrap.StatusMessage);
                        return;
                    case ClientSessionState.InMatch:
                        ShowInMatch();
                        return;
                }
            }
            if (runtime != null && runtime.HasSession)
            {
                ShowInMatch();
                Refresh(runtime.Snapshot);
            }
            else
            {
                ShowMainMenu();
            }
        }

        private void LateUpdate()
        {
            var snapshot = IsNetworkMode
                ? networkRuntime?.Snapshot
                : runtime?.Snapshot;
            Refresh(snapshot);
            UpdateReconnectPresentation();
            if (screen == HudScreen.InMatch ||
                screen == HudScreen.Results)
            {
                minimap?.Update(
                    snapshot,
                    LocalEntityId,
                    Time.unscaledDeltaTime);
            }
            interactionPanel?.Refresh(snapshot, LocalEntityId);
        }

        private void OnDestroy()
        {
            minimap?.Dispose();
            minimap = null;
            touchControls?.Dispose();
            touchControls = null;
            if (runtime != null)
            {
                runtime.FrameAdvanced -= OnFrameAdvanced;
                runtime.SessionStarted -= OnSessionStarted;
                runtime.SessionStopped -= OnSessionStopped;
            }
            if (networkRuntime != null)
            {
                networkRuntime.SnapshotChanged -=
                    OnNetworkSnapshotChanged;
                networkRuntime.EventsReceived -=
                    OnNetworkEventsReceived;
            }
            if (clientBootstrap != null)
            {
                clientBootstrap.SessionStateChanged -=
                    OnClientSessionStateChanged;
            }
            DisposeTransactionPanel();
        }

        private void OnFrameAdvanced(LocalMatchFrame frame)
        {
            if (IsNetworkMode)
            {
                return;
            }
            AppendEvents(frame.Snapshot, frame.Events);
            Refresh(frame.Snapshot);
        }

        private void OnNetworkSnapshotChanged(WorldSnapshot snapshot)
        {
            if (!IsNetworkMode)
            {
                return;
            }
            if (screen == HudScreen.Connecting)
            {
                ShowInMatch();
            }
            Refresh(snapshot);
        }

        private void OnClientSessionStateChanged(
            ClientSessionState state,
            string status)
        {
            switch (state)
            {
                case ClientSessionState.Connecting:
                case ClientSessionState.Disconnecting:
                    ShowConnecting(status);
                    break;
                case ClientSessionState.InMatch:
                    ShowInMatch();
                    break;
                default:
                    outcomeController.ResetRequest();
                    feed.Clear();
                    elements.Feed.text = string.Empty;
                    ShowMainMenu(status);
                    break;
            }
        }

        private void OnSessionStarted()
        {
            if (IsNetworkMode)
            {
                return;
            }
            feed.Clear();
            elements.Feed.text = string.Empty;
            ShowInMatch();
            Refresh(runtime.Snapshot);
        }

        private void OnSessionStopped()
        {
            if (IsNetworkMode)
            {
                return;
            }
            feed.Clear();
            elements.Feed.text = string.Empty;
            ShowMainMenu();
        }

        private void Refresh(WorldSnapshot snapshot)
        {
            if (snapshot == null || elements == null)
            {
                return;
            }

            UpdateMatchStatus(snapshot);
            var local = FindLocalPlayer(snapshot, out var remaining);
            elements.Remaining.text = $"{remaining} REMAIN";
            if (local != null)
            {
                UpdatePlayerStatus(local);
            }
            UpdateOutcome(snapshot);
        }

        private void UpdateMatchStatus(WorldSnapshot snapshot)
        {
            var totalSeconds =
                snapshot.Tick / SimulationConstants.TicksPerSecond;
            elements.Clock.text =
                $"{totalSeconds / 60:00}:{totalSeconds % 60:00}";
            elements.StormPhase.text =
                MatchHudText.StormPhase(snapshot);
        }

    }
}
