using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal static partial class MatchHudBuilder
    {
        public static MatchHudElements Build(VisualElement root)
        {
            ConfigureRoot(root);
            var elements = new MatchHudElements();
            elements.InMatchLayer = AbsoluteBand(0, 0, 0, 0);
            elements.InMatchLayer.pickingMode = PickingMode.Ignore;
            AddTopStatus(elements.InMatchLayer, elements);
            AddPlayerStatus(elements.InMatchLayer, elements);
            AddAbilityStatus(elements.InMatchLayer, elements);
            AddEventFeed(elements.InMatchLayer, elements);
            AddOutcome(elements.InMatchLayer, elements);
            root.Add(elements.InMatchLayer);
            AddMainMenu(root, elements);
            AddConnecting(root, elements);
            return elements;
        }

        public static void SetPercent(VisualElement fill, float ratio)
        {
            fill.style.width =
                Length.Percent(Mathf.Clamp01(ratio) * 100f);
        }

        private static void ConfigureRoot(VisualElement root)
        {
            root.Clear();
            root.style.position = Position.Absolute;
            root.style.left = 0;
            root.style.right = 0;
            root.style.top = 0;
            root.style.bottom = 0;
            root.pickingMode = PickingMode.Ignore;
        }

        private static void AddTopStatus(
            VisualElement root,
            MatchHudElements elements)
        {
            var topBand = AbsoluteBand(0, 0, 0, null);
            topBand.style.alignItems = Align.Center;
            var top = Panel(310);
            top.style.alignItems = Align.Center;
            top.style.marginTop = 18;
            elements.Clock = Label("00:00", 28, FontStyle.Bold);
            elements.Remaining = Label(
                "8 REMAIN",
                13,
                FontStyle.Normal);
            elements.StormPhase = Label(
                string.Empty,
                12,
                FontStyle.Bold);
            elements.StormPhase.style.color =
                new Color(0.95f, 0.62f, 0.28f);
            top.Add(elements.Clock);
            top.Add(elements.Remaining);
            top.Add(elements.StormPhase);
            topBand.Add(top);
            root.Add(topBand);
        }

        private static void AddPlayerStatus(
            VisualElement root,
            MatchHudElements elements)
        {
            var status = Panel(370);
            status.style.position = Position.Absolute;
            status.style.left = 24;
            status.style.bottom = 24;
            elements.Hero = Label(
                "SUN WUKONG",
                20,
                FontStyle.Bold);
            elements.Hp = Label("0 / 0", 13, FontStyle.Normal);
            elements.Lives = Label(
                "LIVES 3",
                12,
                FontStyle.Normal);
            elements.Gold = Label(
                "GOLD 0",
                12,
                FontStyle.Bold);
            elements.Gold.style.color =
                new Color(0.98f, 0.85f, 0.35f);
            status.Add(elements.Hero);
            status.Add(CreateBar(
                new Color(0.18f, 0.78f, 0.32f),
                out var hpFill));
            status.Add(CreateBar(
                new Color(0.16f, 0.58f, 0.94f),
                out var shieldFill,
                5));
            elements.HpFill = hpFill;
            elements.ShieldFill = shieldFill;
            status.Add(elements.Hp);
            status.Add(elements.Lives);
            status.Add(elements.Gold);
            root.Add(status);
        }

        private static void AddAbilityStatus(
            VisualElement root,
            MatchHudElements elements)
        {
            var ability = Panel(190);
            ability.style.position = Position.Absolute;
            ability.style.right = 24;
            ability.style.bottom = 24;
            ability.style.alignItems = Align.Center;
            elements.Ability = Label(
                "ACTIVE READY",
                15,
                FontStyle.Bold);
            ability.Add(elements.Ability);
            root.Add(ability);
        }

        private static void AddEventFeed(
            VisualElement root,
            MatchHudElements elements)
        {
            var eventPanel = Panel(430);
            eventPanel.style.position = Position.Absolute;
            eventPanel.style.left = 24;
            eventPanel.style.top = 24;
            elements.Feed = Label(
                string.Empty,
                13,
                FontStyle.Normal);
            eventPanel.Add(elements.Feed);
            root.Add(eventPanel);
        }

        private static void AddOutcome(
            VisualElement root,
            MatchHudElements elements)
        {
            elements.OutcomeOverlay = AbsoluteBand(0, 0, 0, 0);
            elements.OutcomeOverlay.style.backgroundColor =
                new Color(0.02f, 0.025f, 0.03f, 0.7f);
            elements.OutcomeOverlay.style.alignItems = Align.Center;
            elements.OutcomeOverlay.style.justifyContent =
                Justify.Center;
            elements.OutcomeOverlay.style.display = DisplayStyle.None;
            elements.Outcome = Label(
                "VICTORY",
                64,
                FontStyle.Bold);
            elements.OutcomeOverlay.Add(elements.Outcome);
            elements.NetworkOutcomeNote = Label(
                "SERVER MATCH COMPLETE",
                14,
                FontStyle.Normal);
            elements.NetworkOutcomeNote.style.marginTop = 8;
            elements.OutcomeOverlay.Add(elements.NetworkOutcomeNote);

            elements.LocalOutcomeActions = new VisualElement();
            elements.LocalOutcomeActions.style.flexDirection =
                FlexDirection.Row;
            elements.LocalOutcomeActions.style.marginTop = 22;
            elements.PlayAgainButton = CommandButton(
                "PLAY AGAIN",
                180,
                52);
            elements.MainMenuButton = CommandButton(
                "MAIN MENU",
                180,
                52);
            elements.LocalOutcomeActions.Add(
                elements.PlayAgainButton);
            elements.LocalOutcomeActions.Add(
                elements.MainMenuButton);
            elements.OutcomeOverlay.Add(
                elements.LocalOutcomeActions);
            root.Add(elements.OutcomeOverlay);
        }

        private static Button CommandButton(
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
            button.style.marginLeft = 6;
            button.style.marginRight = 6;
            button.style.backgroundColor =
                new Color(0.10f, 0.12f, 0.12f, 0.98f);
            button.style.color = new Color(0.94f, 0.96f, 0.94f);
            button.style.fontSize = 14;
            button.style.unityFontStyleAndWeight = FontStyle.Bold;
            button.style.borderTopLeftRadius = 4;
            button.style.borderTopRightRadius = 4;
            button.style.borderBottomLeftRadius = 4;
            button.style.borderBottomRightRadius = 4;
            button.style.whiteSpace = WhiteSpace.Normal;
            return button;
        }

        private static VisualElement Panel(float width)
        {
            var panel = new VisualElement();
            panel.style.width = width;
            panel.style.paddingLeft = 16;
            panel.style.paddingRight = 16;
            panel.style.paddingTop = 12;
            panel.style.paddingBottom = 12;
            panel.style.backgroundColor =
                new Color(0.035f, 0.045f, 0.05f, 0.88f);
            panel.style.borderLeftWidth = 1;
            panel.style.borderRightWidth = 1;
            panel.style.borderTopWidth = 1;
            panel.style.borderBottomWidth = 1;
            var border = new Color(0.35f, 0.4f, 0.4f, 0.65f);
            panel.style.borderLeftColor = border;
            panel.style.borderRightColor = border;
            panel.style.borderTopColor = border;
            panel.style.borderBottomColor = border;
            return panel;
        }

        private static VisualElement CreateBar(
            Color color,
            out VisualElement fill,
            float height = 10)
        {
            var track = new VisualElement();
            track.style.height = height;
            track.style.marginTop = 7;
            track.style.backgroundColor =
                new Color(0.08f, 0.09f, 0.1f, 0.95f);
            fill = new VisualElement();
            fill.style.height = Length.Percent(100);
            fill.style.width = Length.Percent(100);
            fill.style.backgroundColor = color;
            track.Add(fill);
            return track;
        }

        private static Label Label(
            string text,
            float size,
            FontStyle fontStyle)
        {
            var label = new Label(text);
            label.style.fontSize = size;
            label.style.color = new Color(0.94f, 0.96f, 0.94f);
            label.style.unityFontStyleAndWeight = fontStyle;
            label.style.whiteSpace = WhiteSpace.Normal;
            return label;
        }

        private static VisualElement AbsoluteBand(
            float? left,
            float? right,
            float? top,
            float? bottom)
        {
            var element = new VisualElement();
            element.style.position = Position.Absolute;
            if (left.HasValue)
            {
                element.style.left = left.Value;
            }
            if (right.HasValue)
            {
                element.style.right = right.Value;
            }
            if (top.HasValue)
            {
                element.style.top = top.Value;
            }
            if (bottom.HasValue)
            {
                element.style.bottom = bottom.Value;
            }
            return element;
        }
    }
}
