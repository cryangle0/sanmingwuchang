using Jwgb.Content;
using Jwgb.Server;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;

namespace Jwgb.Tests
{
    public sealed class AuthoritativeMatchHeroSelectionTests
    {
        [Test]
        public void ServerSessionAppliesAnyNetworkSelectedHero()
        {
            var session = new AuthoritativeMatchSession(
                20260724,
                2,
                mapEnabled: false,
                pveEnabled: false);
            var entityId = session.GetCompetitorEntityIds()[0];
            var hero = HeroCatalog.Get("H038");

            session.AssignNetworkHero(entityId, hero.Id);

            var player = FindPlayer(session.Snapshot, entityId);
            Assert.That(player.HeroId, Is.EqualTo(hero.Id));
            Assert.That(
                player.ActiveAbilityId,
                Is.EqualTo(hero.Active.Id));
            Assert.That(player.Hp, Is.EqualTo(player.MaxHp));
            Assert.That(
                player.AttackPower,
                Is.GreaterThanOrEqualTo(hero.Level1.Attack));
        }

        private static PlayerSnapshot FindPlayer(
            WorldSnapshot snapshot,
            int entityId)
        {
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                if (snapshot.Players[index].EntityId == entityId)
                {
                    return snapshot.Players[index];
                }
            }
            Assert.Fail($"Missing player {entityId}.");
            return null;
        }
    }
}
