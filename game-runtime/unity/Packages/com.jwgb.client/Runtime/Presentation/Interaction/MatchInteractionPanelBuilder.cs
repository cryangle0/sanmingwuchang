using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal static class MatchInteractionPanelBuilder
    {
        public static MatchInteractionPanelElements Build(
            VisualElement parent)
        {
            var elements = new MatchInteractionPanelElements();
            elements.Root = new VisualElement
            {
                name = "jwgb-interactions",
                pickingMode = PickingMode.Ignore
            };
            elements.Root.style.position = Position.Absolute;
            elements.Root.style.left = 0;
            elements.Root.style.right = 0;
            elements.Root.style.top = 0;
            elements.Root.style.bottom = 0;

            elements.Toggle = Button("GEAR", 86, 40);
            elements.Toggle.name = "jwgb-interaction-toggle";
            elements.Toggle.style.position = Position.Absolute;
            elements.Toggle.style.right = 230;
            elements.Toggle.style.bottom = 24;
            elements.Root.Add(elements.Toggle);

            elements.Panel = Panel();
            elements.Panel.name = "jwgb-interaction-panel";
            elements.Panel.style.position = Position.Absolute;
            elements.Panel.style.right = 24;
            elements.Panel.style.top = 286;
            elements.Panel.style.bottom = 100;
            elements.Panel.style.width = 420;
            elements.Panel.style.maxWidth = Length.Percent(54);
            elements.Panel.style.display = DisplayStyle.None;

            var header = new VisualElement();
            header.style.flexDirection = FlexDirection.Row;
            header.style.alignItems = Align.Center;
            elements.Title = Label("INTERACTIONS", 15, FontStyle.Bold);
            elements.Title.style.flexGrow = 1;
            elements.Close = Button("X", 36, 32);
            elements.Close.tooltip = "Close";
            header.Add(elements.Title);
            header.Add(elements.Close);
            elements.Panel.Add(header);

            var tabs = new VisualElement();
            tabs.style.flexDirection = FlexDirection.Row;
            tabs.style.marginTop = 8;
            elements.WorldTab = Button("WORLD", 112, 34);
            elements.LoadoutTab = Button("LOADOUT", 112, 34);
            tabs.Add(elements.WorldTab);
            tabs.Add(elements.LoadoutTab);
            elements.Panel.Add(tabs);

            elements.Status = Label(
                string.Empty,
                11,
                FontStyle.Bold);
            elements.Status.style.minHeight = 18;
            elements.Status.style.marginTop = 6;
            elements.Panel.Add(elements.Status);

            elements.Content = new ScrollView(
                ScrollViewMode.Vertical);
            elements.Content.style.flexGrow = 1;
            elements.Content.style.marginTop = 4;
            elements.Panel.Add(elements.Content);
            elements.Root.Add(elements.Panel);

            elements.AirdropBanner = Panel();
            elements.AirdropBanner.name = "jwgb-airdrop-banner";
            elements.AirdropBanner.style.position = Position.Absolute;
            elements.AirdropBanner.style.left = Length.Percent(50);
            elements.AirdropBanner.style.top = 112;
            elements.AirdropBanner.style.width = 360;
            elements.AirdropBanner.style.marginLeft = -180;
            elements.AirdropBanner.style.display = DisplayStyle.None;
            elements.AirdropTitle = Label(
                string.Empty,
                14,
                FontStyle.Bold);
            elements.AirdropMeta = Label(
                string.Empty,
                11,
                FontStyle.Normal);
            var progressTrack = new VisualElement();
            progressTrack.style.height = 5;
            progressTrack.style.marginTop = 6;
            progressTrack.style.backgroundColor =
                new Color(0.08f, 0.09f, 0.1f, 0.95f);
            elements.AirdropProgress = new VisualElement();
            elements.AirdropProgress.style.height =
                Length.Percent(100);
            elements.AirdropProgress.style.width = 0;
            elements.AirdropProgress.style.backgroundColor =
                new Color(0.95f, 0.62f, 0.28f);
            progressTrack.Add(elements.AirdropProgress);
            elements.AirdropAction = Button("OPEN", 88, 32);
            elements.AirdropAction.style.marginTop = 6;
            elements.AirdropBanner.Add(elements.AirdropTitle);
            elements.AirdropBanner.Add(elements.AirdropMeta);
            elements.AirdropBanner.Add(progressTrack);
            elements.AirdropBanner.Add(elements.AirdropAction);
            elements.Root.Add(elements.AirdropBanner);

            parent.Add(elements.Root);
            ApplyTouchLayout(elements);
            return elements;
        }

        private static void ApplyTouchLayout(
            MatchInteractionPanelElements elements)
        {
            if (!TouchControlsOverlay.ShouldEnable)
            {
                return;
            }

            elements.Toggle.style.right = 16;
            elements.Toggle.style.top = 158;
            elements.Toggle.style.bottom = StyleKeyword.Auto;
            elements.Panel.style.right = 12;
            elements.Panel.style.top = 204;
            elements.Panel.style.bottom = 288;
            elements.Panel.style.width = Length.Percent(56);
        }

        private static VisualElement Panel()
        {
            var panel = new VisualElement();
            panel.pickingMode = PickingMode.Position;
            panel.style.paddingLeft = 12;
            panel.style.paddingRight = 12;
            panel.style.paddingTop = 10;
            panel.style.paddingBottom = 10;
            panel.style.backgroundColor =
                new Color(0.035f, 0.045f, 0.05f, 0.94f);
            var border = new Color(0.35f, 0.4f, 0.4f, 0.7f);
            panel.style.borderLeftWidth = 1;
            panel.style.borderRightWidth = 1;
            panel.style.borderTopWidth = 1;
            panel.style.borderBottomWidth = 1;
            panel.style.borderLeftColor = border;
            panel.style.borderRightColor = border;
            panel.style.borderTopColor = border;
            panel.style.borderBottomColor = border;
            return panel;
        }

        private static Button Button(
            string text,
            float width,
            float height)
        {
            var button = new Button
            {
                text = text
            };
            button.style.width = width;
            button.style.height = height;
            button.style.marginRight = 6;
            button.style.backgroundColor =
                new Color(0.10f, 0.12f, 0.12f, 0.98f);
            button.style.color = new Color(0.94f, 0.96f, 0.94f);
            button.style.unityFontStyleAndWeight = FontStyle.Bold;
            button.style.whiteSpace = WhiteSpace.Normal;
            button.style.borderTopLeftRadius = 4;
            button.style.borderTopRightRadius = 4;
            button.style.borderBottomLeftRadius = 4;
            button.style.borderBottomRightRadius = 4;
            return button;
        }

        private static Label Label(
            string text,
            float size,
            FontStyle style)
        {
            var label = new Label(text);
            label.style.fontSize = size;
            label.style.color = new Color(0.94f, 0.96f, 0.94f);
            label.style.unityFontStyleAndWeight = style;
            label.style.whiteSpace = WhiteSpace.Normal;
            return label;
        }
    }
}
