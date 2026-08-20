using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal sealed class MatchInteractionPanelElements
    {
        public VisualElement Root { get; set; }

        public Button Toggle { get; set; }

        public VisualElement Panel { get; set; }

        public Label Title { get; set; }

        public Button WorldTab { get; set; }

        public Button LoadoutTab { get; set; }

        public Button Close { get; set; }

        public Label Status { get; set; }

        public ScrollView Content { get; set; }

        public VisualElement AirdropBanner { get; set; }

        public Label AirdropTitle { get; set; }

        public Label AirdropMeta { get; set; }

        public VisualElement AirdropProgress { get; set; }

        public Button AirdropAction { get; set; }
    }
}
