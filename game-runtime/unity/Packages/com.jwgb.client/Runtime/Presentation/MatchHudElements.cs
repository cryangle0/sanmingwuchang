using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal sealed class MatchHudElements
    {
        public VisualElement InMatchLayer { get; set; }

        public VisualElement MenuOverlay { get; set; }

        public VisualElement ConnectingOverlay { get; set; }

        public Label ConnectingStatus { get; set; }

        public Button CancelConnectionButton { get; set; }

        public Button LocalModeButton { get; set; }

        public Button OnlineModeButton { get; set; }

        public HeroSelectionPicker HeroPicker { get; set; }

        public VisualElement LocalSettings { get; set; }

        public SliderInt CompetitorSlider { get; set; }

        public Label CompetitorValue { get; set; }

        public VisualElement OnlineSettings { get; set; }

        public VisualElement ReconnectPanel { get; set; }

        public Label ReconnectStatus { get; set; }

        public Button AbandonReconnectButton { get; set; }

        public TextField ServerAddress { get; set; }

        public IntegerField ServerPort { get; set; }

        public Label MenuStatus { get; set; }

        public Button StartMatchButton { get; set; }

        public Label Clock { get; set; }

        public Label Remaining { get; set; }

        public Label StormPhase { get; set; }

        public Label Gold { get; set; }

        public Label Hero { get; set; }

        public Label Hp { get; set; }

        public Label Lives { get; set; }

        public Label Ability { get; set; }

        public Label Feed { get; set; }

        public Label Outcome { get; set; }

        public Label NetworkOutcomeNote { get; set; }

        public VisualElement LocalOutcomeActions { get; set; }

        public Button PlayAgainButton { get; set; }

        public Button MainMenuButton { get; set; }

        public VisualElement HpFill { get; set; }

        public VisualElement ShieldFill { get; set; }

        public VisualElement OutcomeOverlay { get; set; }
    }
}
