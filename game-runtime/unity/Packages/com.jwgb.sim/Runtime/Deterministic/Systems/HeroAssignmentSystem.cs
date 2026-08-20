using System;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static class HeroAssignmentSystem
    {
        public static void Apply(
            SimulationState state,
            System.Collections.Generic.List<SimEvent> events,
            PlayerState player,
            string heroId,
            bool preserveHealthRatio)
        {
            var hero = HeroCatalog.Get(heroId);
            var previousActiveId = player.ActiveAbilityId;
            var healthBasisPoints =
                preserveHealthRatio && player.MaxHp > 0
                    ? (int)((long)player.Hp * 10_000 / player.MaxHp)
                    : 10_000;

            player.HeroId = hero.Id;
            player.BasicAttackKind = hero.BasicAttackKind;
            player.Element = hero.Element;
            player.ActiveAbilityId = hero.Active.Id;
            player.ActiveCooldownTicks = 0;
            LoadoutCleanupSystem.ClearOwnedActiveStateForReplacement(
                state,
                events,
                player,
                previousActiveId);
            EquipmentInventorySystem.RebuildEquipmentStats(player);
            player.Hp = Math.Max(
                1,
                Math.Min(
                    player.MaxHp,
                    (int)((long)player.MaxHp * healthBasisPoints /
                        10_000)));
        }
    }
}
