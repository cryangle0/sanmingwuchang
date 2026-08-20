using System.Collections.Generic;
using System.Linq;
using Jwgb.Client.Presentation;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class ModelVisualCatalogTests
    {
        [Test]
        public void DefaultHeroSourcesCoverAllAuthoritativeIds()
        {
            var heroes = ModelVisualCatalogDefaults.Heroes;
            Assert.That(heroes, Has.Length.EqualTo(38));
            Assert.That(
                heroes.Select(value => value.HeroId).Distinct().Count(),
                Is.EqualTo(38));
            for (var index = 0; index < heroes.Length; index += 1)
            {
                Assert.That(
                    heroes[index].HeroId,
                    Is.EqualTo($"H{index + 1:D3}"));
            }
        }

        [TestCase("铁山公主", "H001")]
        [TestCase("青狮精", "H017")]
        [TestCase("独角四大王", "H019")]
        [TestCase("如来", "H029")]
        public void DeliveryAliasesResolveToAuthoritativeHeroIds(
            string sourceName,
            string expectedHeroId)
        {
            Assert.That(
                ModelVisualCatalogDefaults.TryGetHeroIdBySourceName(
                    sourceName,
                    out var heroId),
                Is.True);
            Assert.That(heroId, Is.EqualTo(expectedHeroId));
        }

        [Test]
        public void DefaultMonsterSourcesCoverAllModelIdsAndKinds()
        {
            var monsters = ModelVisualCatalogDefaults.Monsters;
            Assert.That(monsters, Has.Length.EqualTo(38));
            Assert.That(
                monsters.Select(value => value.ModelId).Distinct().Count(),
                Is.EqualTo(38));
            for (var index = 0; index < monsters.Length; index += 1)
            {
                Assert.That(
                    monsters[index].ModelId,
                    Is.EqualTo($"M{index + 1:D3}"));
            }

            var kinds = new HashSet<string>(
                monsters.Select(value => value.Kind));
            Assert.That(
                kinds,
                Is.EquivalentTo(ModelVisualCatalogDefaults.MonsterKinds));
        }
    }
}
