using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal static partial class MatchHudBuilder
    {
        private static void AddMainMenu(
            VisualElement root,
            MatchHudElements elements)
        {
            elements.MenuOverlay = AbsoluteBand(0, 0, 0, 0);
            elements.MenuOverlay.name = "jwgb-main-menu";
            elements.MenuOverlay.pickingMode = PickingMode.Position;
            elements.MenuOverlay.style.backgroundColor =
                new Color(0.018f, 0.024f, 0.026f, 0.97f);
            elements.MenuOverlay.style.alignItems = Align.Center;
            elements.MenuOverlay.style.justifyContent = Justify.Center;

            var content = new VisualElement();
            content.style.width = 720;
            content.style.maxWidth = Length.Percent(94);
            content.style.alignItems = Align.Center;
            content.Add(Label(
                "JOURNEY WEST GREAT BRAWL",
                38,
                FontStyle.Bold));
            var prompt = Label(
                "CHOOSE YOUR HERO",
                15,
                FontStyle.Normal);
            prompt.style.marginTop = 10;
            prompt.style.marginBottom = 18;
            prompt.style.color = new Color(0.68f, 0.74f, 0.72f);
            content.Add(prompt);

            AddModeSelector(content, elements);
            elements.HeroPicker = new HeroSelectionPicker(content);
            AddLocalSettings(content, elements);
            AddOnlineSettings(content, elements);
            AddReconnectPanel(content, elements);

            elements.MenuStatus = Label(
                string.Empty,
                12,
                FontStyle.Bold);
            elements.MenuStatus.name = "jwgb-menu-status";
            elements.MenuStatus.style.minHeight = 20;
            elements.MenuStatus.style.marginTop = 8;
            elements.MenuStatus.style.marginBottom = 8;
            elements.MenuStatus.style.color =
                new Color(0.95f, 0.72f, 0.32f);
            elements.MenuStatus.style.unityTextAlign =
                TextAnchor.MiddleCenter;
            content.Add(elements.MenuStatus);

            elements.StartMatchButton = CommandButton(
                "START LOCAL MATCH",
                240,
                58);
            elements.StartMatchButton.name = "jwgb-start-match";
            elements.StartMatchButton.style.backgroundColor =
                new Color(0.92f, 0.45f, 0.12f);
            elements.StartMatchButton.style.color =
                new Color(0.04f, 0.045f, 0.04f);
            content.Add(elements.StartMatchButton);
            elements.MenuOverlay.Add(content);
            root.Add(elements.MenuOverlay);
        }

        private static void AddModeSelector(
            VisualElement content,
            MatchHudElements elements)
        {
            var row = new VisualElement();
            row.style.flexDirection = FlexDirection.Row;
            row.style.flexWrap = Wrap.Wrap;
            row.style.justifyContent = Justify.Center;
            row.style.marginBottom = 16;
            elements.LocalModeButton = CommandButton(
                "LOCAL",
                180,
                44);
            elements.LocalModeButton.name = "jwgb-mode-local";
            elements.OnlineModeButton = CommandButton(
                "ONLINE",
                180,
                44);
            elements.OnlineModeButton.name = "jwgb-mode-online";
            row.Add(elements.LocalModeButton);
            row.Add(elements.OnlineModeButton);
            content.Add(row);
        }

        private static void AddLocalSettings(
            VisualElement content,
            MatchHudElements elements)
        {
            elements.LocalSettings = new VisualElement
            {
                name = "jwgb-local-settings"
            };
            elements.LocalSettings.style.width =
                Length.Percent(100);
            elements.LocalSettings.style.alignItems = Align.Center;
            elements.CompetitorValue = Label(
                "8 COMPETITORS",
                14,
                FontStyle.Bold);
            elements.LocalSettings.Add(elements.CompetitorValue);
            elements.CompetitorSlider = new SliderInt(2, 30)
            {
                value = 8,
                showInputField = true,
                name = "jwgb-competitor-slider"
            };
            elements.CompetitorSlider.style.width = 420;
            elements.CompetitorSlider.style.maxWidth =
                Length.Percent(80);
            elements.CompetitorSlider.style.marginTop = 8;
            elements.CompetitorSlider.style.marginBottom = 16;
            elements.LocalSettings.Add(
                elements.CompetitorSlider);
            content.Add(elements.LocalSettings);
        }

        private static void AddOnlineSettings(
            VisualElement content,
            MatchHudElements elements)
        {
            elements.OnlineSettings = new VisualElement
            {
                name = "jwgb-online-settings"
            };
            elements.OnlineSettings.style.width =
                Length.Percent(100);
            elements.OnlineSettings.style.flexDirection =
                FlexDirection.Row;
            elements.OnlineSettings.style.flexWrap = Wrap.Wrap;
            elements.OnlineSettings.style.justifyContent =
                Justify.Center;
            elements.OnlineSettings.style.display =
                DisplayStyle.None;
            elements.ServerAddress = new TextField("SERVER ADDRESS")
            {
                value = "127.0.0.1",
                name = "jwgb-server-address"
            };
            elements.ServerAddress.style.width = 300;
            elements.ServerAddress.style.marginLeft = 6;
            elements.ServerAddress.style.marginRight = 6;
            elements.ServerPort = new IntegerField("PORT")
            {
                value = 7979,
                name = "jwgb-server-port"
            };
            elements.ServerPort.style.width = 180;
            elements.ServerPort.style.marginLeft = 6;
            elements.ServerPort.style.marginRight = 6;
            elements.OnlineSettings.Add(
                elements.ServerAddress);
            elements.OnlineSettings.Add(elements.ServerPort);
            content.Add(elements.OnlineSettings);
        }

        private static void AddReconnectPanel(
            VisualElement content,
            MatchHudElements elements)
        {
            elements.ReconnectPanel = new VisualElement
            {
                name = "jwgb-reconnect-panel"
            };
            elements.ReconnectPanel.style.width =
                Length.Percent(100);
            elements.ReconnectPanel.style.alignItems = Align.Center;
            elements.ReconnectPanel.style.display = DisplayStyle.None;
            elements.ReconnectStatus = Label(
                "SESSION RESERVED",
                14,
                FontStyle.Bold);
            elements.ReconnectStatus.name = "jwgb-reconnect-status";
            elements.ReconnectStatus.style.color =
                new Color(0.95f, 0.72f, 0.32f);
            elements.ReconnectPanel.Add(elements.ReconnectStatus);
            elements.AbandonReconnectButton = CommandButton(
                "ABANDON SESSION",
                180,
                36);
            elements.AbandonReconnectButton.name =
                "jwgb-abandon-reconnect";
            elements.AbandonReconnectButton.style.marginTop = 8;
            elements.ReconnectPanel.Add(
                elements.AbandonReconnectButton);
            content.Add(elements.ReconnectPanel);
        }

        private static void AddConnecting(
            VisualElement root,
            MatchHudElements elements)
        {
            elements.ConnectingOverlay = AbsoluteBand(0, 0, 0, 0);
            elements.ConnectingOverlay.style.backgroundColor =
                new Color(0.018f, 0.024f, 0.026f, 0.94f);
            elements.ConnectingOverlay.style.alignItems = Align.Center;
            elements.ConnectingOverlay.style.justifyContent =
                Justify.Center;
            elements.ConnectingStatus = Label(
                "CONNECTING TO MATCH SERVER",
                22,
                FontStyle.Bold);
            elements.ConnectingOverlay.Add(elements.ConnectingStatus);
            elements.CancelConnectionButton = CommandButton(
                "CANCEL",
                160,
                46);
            elements.CancelConnectionButton.name =
                "jwgb-cancel-connection";
            elements.CancelConnectionButton.style.marginTop = 18;
            elements.ConnectingOverlay.Add(
                elements.CancelConnectionButton);
            root.Add(elements.ConnectingOverlay);
        }
    }
}
