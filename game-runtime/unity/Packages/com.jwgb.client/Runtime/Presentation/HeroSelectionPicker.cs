using System;
using System.Collections.Generic;
using Jwgb.Content;
using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal sealed class HeroSelectionPicker
    {
        private readonly List<HeroDefinition> heroes =
            new List<HeroDefinition>();
        private readonly Dictionary<string, string> idsByLabel =
            new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Label indexLabel;
        private readonly Label detailLabel;
        private readonly DropdownField selector;
        private readonly VisualElement root;
        private int selectedIndex;

        public HeroSelectionPicker(VisualElement parent)
        {
            root = new VisualElement
            {
                name = "jwgb-hero-picker"
            };
            root.style.width = Length.Percent(100);
            root.style.alignItems = Align.Center;

            var definitions = HeroCatalog.All;
            var choices = new List<string>(definitions.Count);
            for (var index = 0; index < definitions.Count; index += 1)
            {
                var definition = definitions[index];
                heroes.Add(definition);
                var label = FormatChoice(definition);
                choices.Add(label);
                idsByLabel.Add(label, definition.Id);
            }

            selector = new DropdownField(
                "HERO",
                choices,
                FindDefaultIndex(choices));
            selector.name = "jwgb-hero-selector";
            selector.tooltip = "Choose one of all available heroes";
            selector.style.width = 460;
            selector.style.maxWidth = Length.Percent(88);
            selector.style.marginBottom = 8;
            selector.RegisterValueChangedCallback(
                change => SelectLabel(change.newValue));
            root.Add(selector);

            var navigation = new VisualElement();
            navigation.style.flexDirection = FlexDirection.Row;
            navigation.style.alignItems = Align.Center;
            navigation.style.justifyContent = Justify.Center;
            var previous = Button("<", "Previous hero");
            previous.name = "jwgb-hero-previous";
            previous.clicked += () => SelectIndex(selectedIndex - 1);
            var next = Button(">", "Next hero");
            next.name = "jwgb-hero-next";
            next.clicked += () => SelectIndex(selectedIndex + 1);
            indexLabel = new Label();
            indexLabel.style.minWidth = 94;
            indexLabel.style.unityTextAlign = TextAnchor.MiddleCenter;
            navigation.Add(previous);
            navigation.Add(indexLabel);
            navigation.Add(next);
            root.Add(navigation);

            detailLabel = new Label();
            detailLabel.name = "jwgb-hero-detail";
            detailLabel.style.marginTop = 8;
            detailLabel.style.marginBottom = 18;
            detailLabel.style.color = new Color(0.82f, 0.86f, 0.82f);
            detailLabel.style.unityTextAlign = TextAnchor.MiddleCenter;
            detailLabel.style.whiteSpace = WhiteSpace.Normal;
            root.Add(detailLabel);
            parent.Add(root);

            selectedIndex = selector.index;
            RefreshPresentation();
        }

        public event Action<string> SelectedHeroChanged;

        public DropdownField Selector => selector;

        public string SelectedHeroId => heroes[selectedIndex].Id;

        public int ChoiceCount => heroes.Count;

        public void SetEnabled(bool enabled)
        {
            root.SetEnabled(enabled);
        }

        public void Select(string heroId, bool notify = false)
        {
            for (var index = 0; index < heroes.Count; index += 1)
            {
                if (heroes[index].Id == heroId)
                {
                    SelectIndex(index, notify);
                    return;
                }
            }
            throw new ArgumentException(
                $"Unknown hero id: {heroId}",
                nameof(heroId));
        }

        private void SelectLabel(string label)
        {
            if (!idsByLabel.TryGetValue(label, out var heroId))
            {
                return;
            }
            for (var index = 0; index < heroes.Count; index += 1)
            {
                if (heroes[index].Id == heroId)
                {
                    selectedIndex = index;
                    RefreshPresentation();
                    SelectedHeroChanged?.Invoke(heroId);
                    return;
                }
            }
        }

        private void SelectIndex(int index, bool notify = true)
        {
            if (heroes.Count == 0)
            {
                return;
            }
            selectedIndex = (index + heroes.Count) % heroes.Count;
            selector.SetValueWithoutNotify(
                FormatChoice(heroes[selectedIndex]));
            RefreshPresentation();
            if (notify)
            {
                SelectedHeroChanged?.Invoke(SelectedHeroId);
            }
        }

        private void RefreshPresentation()
        {
            var hero = heroes[selectedIndex];
            indexLabel.text =
                $"{selectedIndex + 1} / {heroes.Count}";
            detailLabel.text =
                $"{hero.Name}  |  {Role(hero)}  |  " +
                $"{hero.Element.ToString().ToUpperInvariant()}\n" +
                $"ATK {hero.Level1.Attack}   " +
                $"HP {hero.Level1.MaxHp}   " +
                $"MOVE {hero.Level1.MoveSpeedMmPerSecond / 1_000f:0.00}   " +
                $"ACTIVE {hero.Active.Name}";
        }

        private static string FormatChoice(HeroDefinition hero)
        {
            return $"{hero.Id}  |  {hero.Name}";
        }

        private static int FindDefaultIndex(List<string> choices)
        {
            for (var index = 0; index < choices.Count; index += 1)
            {
                if (choices[index].StartsWith(
                        GameplayIds.SunWukong,
                        StringComparison.Ordinal))
                {
                    return index;
                }
            }
            return 0;
        }

        private static string Role(HeroDefinition hero)
        {
            return hero.Archetype switch
            {
                HeroArchetype.Assassin => "ASSASSIN",
                HeroArchetype.Fighter => "FIGHTER",
                _ => "REPEATER"
            };
        }

        private static Button Button(string text, string tooltip)
        {
            var button = new Button { text = text, tooltip = tooltip };
            button.style.width = 42;
            button.style.height = 32;
            button.style.marginLeft = 6;
            button.style.marginRight = 6;
            button.style.backgroundColor =
                new Color(0.10f, 0.12f, 0.12f, 0.98f);
            button.style.color = new Color(0.94f, 0.96f, 0.94f);
            button.style.unityFontStyleAndWeight = FontStyle.Bold;
            return button;
        }
    }
}
