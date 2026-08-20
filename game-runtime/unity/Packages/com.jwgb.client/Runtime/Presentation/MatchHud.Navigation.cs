using Jwgb.Sim.Deterministic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    public sealed partial class MatchHud
    {
        private void UpdateOutcome(WorldSnapshot snapshot)
        {
            var finished =
                snapshot.Match.Status == MatchStatus.Finished;
            elements.OutcomeOverlay.style.display = finished
                ? DisplayStyle.Flex
                : DisplayStyle.None;
            if (!finished)
            {
                outcomeController.ResetForActiveMatch(elements);
                if (screen == HudScreen.Results)
                {
                    screen = HudScreen.InMatch;
                }
                return;
            }

            screen = HudScreen.Results;
            outcomeController.ShowFinished(
                elements,
                snapshot,
                IsNetworkMode,
                LocalEntityId);
        }

        private void ConfigureControls()
        {
            elements.LocalModeButton.clicked += () =>
                SelectMode(online: false);
            elements.OnlineModeButton.clicked += () =>
                SelectMode(online: true);
            elements.HeroPicker.SelectedHeroChanged += SelectHero;
            elements.CompetitorSlider.RegisterValueChangedCallback(
                change =>
                {
                    elements.CompetitorValue.text =
                        $"{change.newValue} COMPETITORS";
                });
            elements.StartMatchButton.clicked += StartSelectedMatch;
            elements.CancelConnectionButton.clicked +=
                ReturnToMainMenu;
            elements.AbandonReconnectButton.clicked +=
                AbandonReconnect;
            elements.PlayAgainButton.clicked += RestartMatch;
            elements.MainMenuButton.clicked += ReturnToMainMenu;
        }

        private void StartSelectedMatch()
        {
            elements.MenuStatus.text = string.Empty;
            if (!onlineSelected)
            {
                runtime?.StartLocalMatch(
                    selectedHeroId,
                    elements.CompetitorSlider.value);
                return;
            }

            if (clientBootstrap == null)
            {
                elements.MenuStatus.text =
                    "NETWORK CLIENT IS UNAVAILABLE";
                return;
            }
            if (!clientBootstrap.TryConnectOnline(
                    elements.ServerAddress.value,
                    elements.ServerPort.value,
                    selectedHeroId,
                    out var error))
            {
                elements.MenuStatus.text = error;
            }
        }

        private void RestartMatch()
        {
            if (!IsNetworkMode)
            {
                runtime?.RestartLocalMatch();
                return;
            }
            if (outcomeController.IsRematchRequested)
            {
                return;
            }
            string error = null;
            if (clientBootstrap != null &&
                clientBootstrap.TryRequestRematch(out error))
            {
                outcomeController.MarkRematchRequested(elements);
                return;
            }
            elements.NetworkOutcomeNote.text = error ??
                "REMATCH REQUEST FAILED";
        }

        private void ReturnToMainMenu()
        {
            if (IsNetworkMode)
            {
                clientBootstrap?.RequestReturnToMenu();
                return;
            }
            runtime?.ReturnToMenu();
        }

        private void AbandonReconnect()
        {
            clientBootstrap?.AbandonReconnect();
            UpdateMenuMode();
        }

        private void SelectMode(bool online)
        {
            if (screen != HudScreen.MainMenu)
            {
                return;
            }
            onlineSelected = online;
            elements.MenuStatus.text = string.Empty;
            UpdateMenuMode();
        }

        private void UpdateMenuMode()
        {
            if (elements == null)
            {
                return;
            }
            var canReconnect = CanReconnectSelectedSession;
            elements.LocalSettings.style.display = onlineSelected
                ? DisplayStyle.None
                : DisplayStyle.Flex;
            elements.OnlineSettings.style.display =
                onlineSelected && !canReconnect
                    ? DisplayStyle.Flex
                    : DisplayStyle.None;
            elements.ReconnectPanel.style.display = canReconnect
                ? DisplayStyle.Flex
                : DisplayStyle.None;
            elements.StartMatchButton.text = onlineSelected
                ? canReconnect
                    ? "RECONNECT NOW"
                    : "JOIN ONLINE MATCH"
                : "START LOCAL MATCH";
            SetSelectionButtonState(
                elements.LocalModeButton,
                !onlineSelected);
            SetSelectionButtonState(
                elements.OnlineModeButton,
                onlineSelected);
        }

        private void UpdateReconnectPresentation()
        {
            if (elements == null ||
                !CanReconnectSelectedSession)
            {
                return;
            }
            elements.ReconnectStatus.text =
                "SESSION RESERVED | " +
                $"{clientBootstrap.ReconnectSecondsRemaining}s REMAIN";
        }

        private bool CanReconnectSelectedSession =>
            onlineSelected &&
            clientBootstrap != null &&
            clientBootstrap.CanReconnectTo(
                elements.ServerAddress.value,
                elements.ServerPort.value,
                selectedHeroId);

        private void SelectHero(string heroId)
        {
            selectedHeroId = heroId;
            elements.HeroPicker.Select(heroId, notify: false);
            UpdateMenuMode();
        }

        private static void SetSelectionButtonState(
            Button button,
            bool selected)
        {
            button.style.backgroundColor = selected
                ? new Color(0.92f, 0.45f, 0.12f)
                : new Color(0.10f, 0.12f, 0.12f, 0.98f);
            button.style.color = selected
                ? new Color(0.04f, 0.045f, 0.04f)
                : new Color(0.94f, 0.96f, 0.94f);
        }

        private void ShowMainMenu(string status = null)
        {
            screen = HudScreen.MainMenu;
            elements.MenuOverlay.style.display = DisplayStyle.Flex;
            elements.ConnectingOverlay.style.display =
                DisplayStyle.None;
            elements.InMatchLayer.style.display = DisplayStyle.None;
            elements.OutcomeOverlay.style.display = DisplayStyle.None;
            if (status != null)
            {
                elements.MenuStatus.text = status;
            }
            UpdateMenuMode();
            UpdateReconnectPresentation();
        }

        private void ShowConnecting(string status = null)
        {
            screen = HudScreen.Connecting;
            elements.MenuOverlay.style.display = DisplayStyle.None;
            elements.ConnectingOverlay.style.display =
                DisplayStyle.Flex;
            elements.InMatchLayer.style.display = DisplayStyle.None;
            elements.ConnectingStatus.text =
                string.IsNullOrWhiteSpace(status)
                    ? "CONNECTING TO MATCH SERVER"
                    : status;
        }

        private void ShowInMatch()
        {
            screen = HudScreen.InMatch;
            elements.MenuOverlay.style.display = DisplayStyle.None;
            elements.ConnectingOverlay.style.display =
                DisplayStyle.None;
            elements.InMatchLayer.style.display = DisplayStyle.Flex;
            elements.OutcomeOverlay.style.display = DisplayStyle.None;
        }

        private bool IsNetworkMode =>
            clientBootstrap != null &&
            clientBootstrap.IsNetworkActive;

        private int LocalEntityId => IsNetworkMode
            ? networkRuntime?.LocalEntityId ?? 0
            : runtime == null
                ? 0
                : runtime.LocalEntityId;
    }
}
