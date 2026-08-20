using Jwgb.Content;
using NUnit.Framework;

namespace Jwgb.Tests.Editor
{
    public sealed class AuthoritativeContentCatalogTests
    {
        [Test]
        public void FullCatalogMatchesAuthoritativeCounts()
        {
            Assert.That(AuthoritativeContentCatalog.Schema, Is.EqualTo("jwgb.authoritative-content.v1"));
            Assert.That(AuthoritativeContentCatalog.Heroes, Has.Length.EqualTo(38));
            Assert.That(AuthoritativeContentCatalog.GenericActives, Has.Length.EqualTo(19));
            Assert.That(AuthoritativeContentCatalog.Passives, Has.Length.EqualTo(44));
            Assert.That(AuthoritativeContentCatalog.Equipment, Has.Length.EqualTo(44));
            Assert.That(AuthoritativeContentCatalog.SkillCount, Is.EqualTo(101));
            Assert.That(AuthoritativeContentCatalog.PveSimultaneousPopulation, Is.EqualTo(123));
        }

        [Test]
        public void CatalogDoesNotOverstateRuntimeCoverage()
        {
            var implementedHeroActives = 0;
            for (var index = 0; index < AuthoritativeContentCatalog.Heroes.Length; index += 1)
            {
                if (AuthoritativeContentCatalog.Heroes[index].RuntimeStatus ==
                    RuntimeImplementationStatus.Implemented)
                {
                    implementedHeroActives += 1;
                }
            }

            Assert.That(implementedHeroActives, Is.EqualTo(3));
            Assert.That(
                AuthoritativeContentCatalog.Heroes[37].Name,
                Is.EqualTo("\u8d5b\u592a\u5c81"));
            Assert.That(
                AuthoritativeContentCatalog.Heroes[37].RuntimeStatus,
                Is.EqualTo(RuntimeImplementationStatus.DefinitionOnly));
        }

        [Test]
        public void GameplayCatalogContainsEveryRuntimeDefinition()
        {
            Assert.That(GeneratedGameplayCatalog.HeroCount, Is.EqualTo(38));
            Assert.That(GeneratedGameplayCatalog.HeroActiveCount, Is.EqualTo(38));
            Assert.That(GeneratedGameplayCatalog.GenericActiveCount, Is.EqualTo(19));
            Assert.That(GeneratedGameplayCatalog.ActiveCount, Is.EqualTo(57));
            Assert.That(GeneratedGameplayCatalog.PassiveCount, Is.EqualTo(44));
            Assert.That(GeneratedGameplayCatalog.EquipmentCount, Is.EqualTo(48));

            for (var index = 1; index <= 38; index += 1)
            {
                var id = $"H{index:000}";
                Assert.That(HeroCatalog.Get(id).Id, Is.EqualTo(id));
                Assert.That(ActiveCatalog.Get(id).Id, Is.EqualTo(id));
            }

            for (var index = 1; index <= 44; index += 1)
            {
                var id = $"B{index:00}";
                Assert.That(PassiveCatalog.Get(id).Id, Is.EqualTo(id));
            }

            var genericIds = new[]
            {
                "D1", "D3", "D4", "D6", "D7", "D9", "D10", "D11",
                "D12", "D13", "D14", "D15", "D16", "D17", "D18",
                "D19", "D20", "D21", "D22"
            };
            for (var index = 0; index < genericIds.Length; index += 1)
            {
                Assert.That(
                    ActiveCatalog.Get(genericIds[index]).Id,
                    Is.EqualTo(genericIds[index]));
            }

            Assert.That(GeneratedGameplayCatalog.Equipment, Has.Length.EqualTo(48));
            for (var index = 0;
                index < GeneratedGameplayCatalog.Equipment.Length;
                index += 1)
            {
                var definition = GeneratedGameplayCatalog.Equipment[index];
                Assert.That(EquipmentCatalog.Get(definition.Id), Is.SameAs(definition));
            }
        }

        [Test]
        public void EquipmentTotalsIncludeEveryStatFamily()
        {
            var totals = EquipmentCatalog.GetStatTotals(
                new[] { "W1", "W2", "W3", "G8", "G10" });
            Assert.That(totals.AttackFlat, Is.EqualTo(115));
            Assert.That(totals.MaxHpFlat, Is.EqualTo(220));
            Assert.That(totals.MoveSpeedFlat, Is.EqualTo(18));
            Assert.That(totals.AttackSpeedPercent, Is.EqualTo(40));
            Assert.That(totals.BasicAttackRangeFlatMm, Is.EqualTo(3_000));
        }
    }
}
