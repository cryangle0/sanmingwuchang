using System.Collections.Generic;
using Jwgb.Client.Presentation;
using Jwgb.Content;
using NUnit.Framework;
using UnityEngine.UIElements;

namespace Jwgb.Tests
{
    public sealed class HeroSelectionPickerTests
    {
        [Test]
        public void PickerExposesEveryGeneratedHeroInOrder()
        {
            var root = new VisualElement();
            var picker = new HeroSelectionPicker(root);

            Assert.That(
                picker.ChoiceCount,
                Is.EqualTo(GeneratedGameplayCatalog.HeroCount));
            Assert.That(picker.Selector.choices, Has.Count.EqualTo(38));
            Assert.That(
                picker.Selector.choices[0],
                Does.StartWith("H001"));
            Assert.That(
                picker.Selector.choices[37],
                Does.StartWith("H038"));
            Assert.That(
                picker.SelectedHeroId,
                Is.EqualTo(GameplayIds.SunWukong));
        }

        [Test]
        public void PickerSelectionRaisesOneStableHeroId()
        {
            var root = new VisualElement();
            var picker = new HeroSelectionPicker(root);
            var observed = new List<string>();
            picker.SelectedHeroChanged += observed.Add;

            picker.Select("H038");
            Assert.That(observed, Is.Empty);

            picker.Select("H038", notify: true);

            Assert.That(picker.SelectedHeroId, Is.EqualTo("H038"));
            Assert.That(observed, Has.Count.EqualTo(1));
            Assert.That(observed[0], Is.EqualTo("H038"));
            Assert.That(
                root.Q<DropdownField>("jwgb-hero-selector").value,
                Does.StartWith("H038"));
        }

        [Test]
        public void HeroNameUsesGeneratedCatalogForAllIds()
        {
            for (var index = 0;
                index < GeneratedGameplayCatalog.Heroes.Length;
                index += 1)
            {
                var hero = GeneratedGameplayCatalog.Heroes[index];
                Assert.That(
                    MatchHudText.HeroName(hero.Id),
                    Is.EqualTo(hero.Name.ToUpperInvariant()),
                    hero.Id);
            }
        }
    }
}
