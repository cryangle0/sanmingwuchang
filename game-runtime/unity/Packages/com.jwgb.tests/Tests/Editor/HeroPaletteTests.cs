using System.Collections.Generic;
using Jwgb.Client.Presentation;
using Jwgb.Content;
using NUnit.Framework;
using UnityEngine;

namespace Jwgb.Tests
{
    public sealed class HeroPaletteTests
    {
        [Test]
        public void SameHeroIdAlwaysYieldsSameColor()
        {
            var heroes = AuthoritativeContentCatalog.Heroes;
            for (var index = 0; index < heroes.Length; index += 1)
            {
                var heroId = heroes[index].Id;
                Assert.That(
                    HeroPalette.GetColor32(heroId),
                    Is.EqualTo(HeroPalette.GetColor32(heroId)),
                    heroId);
            }
        }

        [Test]
        public void AllCatalogHeroesHaveDistinctColors()
        {
            var heroes = AuthoritativeContentCatalog.Heroes;
            Assert.That(heroes.Length, Is.EqualTo(38));
            var seen = new Dictionary<uint, string>();
            for (var index = 0; index < heroes.Length; index += 1)
            {
                var heroId = heroes[index].Id;
                var color = HeroPalette.GetColor32(heroId);
                var key =
                    ((uint)color.r << 16) |
                    ((uint)color.g << 8) |
                    color.b;
                Assert.That(
                    seen.ContainsKey(key),
                    Is.False,
                    $"{heroId} collides with " +
                    $"{(seen.TryGetValue(key, out var other) ? other : "?")}");
                seen.Add(key, heroId);
            }
        }

        [Test]
        public void CatalogHeroColorsAreVisuallySeparated()
        {
            var heroes = AuthoritativeContentCatalog.Heroes;
            for (var first = 0; first < heroes.Length; first += 1)
            {
                for (var second = first + 1;
                    second < heroes.Length;
                    second += 1)
                {
                    var a = HeroPalette.GetColor32(heroes[first].Id);
                    var b = HeroPalette.GetColor32(heroes[second].Id);
                    var distance =
                        Mathf.Abs(a.r - b.r) +
                        Mathf.Abs(a.g - b.g) +
                        Mathf.Abs(a.b - b.b);
                    Assert.That(
                        distance,
                        Is.GreaterThanOrEqualTo(12),
                        $"{heroes[first].Id} vs {heroes[second].Id}");
                }
            }
        }

        [Test]
        public void ImplementedHeroesMirrorWebPalette()
        {
            Assert.That(
                HeroPalette.GetColor32(GameplayIds.IronFanPrincess),
                Is.EqualTo(new Color32(0xb9, 0x4d, 0x43, 0xff)));
            Assert.That(
                HeroPalette.GetColor32(GameplayIds.SunWukong),
                Is.EqualTo(new Color32(0xd2, 0xa8, 0x44, 0xff)));
            Assert.That(
                HeroPalette.GetColor32(GameplayIds.BullDemonKing),
                Is.EqualTo(new Color32(0x3d, 0x73, 0x5c, 0xff)));
        }

        [Test]
        public void UnknownHeroIdsAreStillDeterministic()
        {
            Assert.That(
                HeroPalette.GetColor32("X999"),
                Is.EqualTo(HeroPalette.GetColor32("X999")));
            Assert.That(
                HeroPalette.GetColor32(null).a,
                Is.EqualTo(255));
        }
    }
}
