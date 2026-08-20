using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveKillSystem
    {
        private static void ResolveGreed(
            SimulationState state,
            List<SimEvent> events,
            PlayerState killer,
            PassiveKillContext context)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    killer,
                    GameplayIds.Greed,
                    out var loadout))
            {
                return;
            }

            var definition = PassiveCatalog.Get(GameplayIds.Greed);
            var gold = context.VictimKind ==
                PassiveKillVictimKind.Monster
                    ? PassiveCatalog.LevelValue(
                        definition.MonsterGoldByLevel,
                        loadout.Level)
                    : loadout.Level == 5
                        ? definition.HeroKillGold
                        : 0;
            if (gold <= 0)
            {
                return;
            }

            killer.Gold = checked(killer.Gold + gold);
            Emit(
                state,
                events,
                killer,
                GameplayIds.Greed,
                "kill-gold",
                gold,
                context.VictimEntityId);
        }

        private static void ResolveTenacity(
            SimulationState state,
            List<SimEvent> events,
            PlayerState killer,
            PassiveKillContext context)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    killer,
                    GameplayIds.Tenacity,
                    out var loadout))
            {
                return;
            }

            var definition = PassiveCatalog.Get(
                GameplayIds.Tenacity);
            killer.B40KillCount += 1;
            var growth = PassiveCatalog.LevelValue(
                definition.HpPerKillByLevel,
                loadout.Level);
            if (killer.B40KillCount % definition.MilestoneKills == 0)
            {
                growth = checked(
                    growth + definition.MilestoneHpBonus);
            }

            killer.B40BonusMaxHp = checked(
                killer.B40BonusMaxHp + growth);
            killer.MaxHp = checked(killer.MaxHp + growth);
            killer.Hp = checked(killer.Hp + growth);
            Emit(
                state,
                events,
                killer,
                GameplayIds.Tenacity,
                "kill-growth",
                growth,
                context.VictimEntityId);
        }

        private static void ResolveExecuteHeal(
            SimulationState state,
            List<SimEvent> events,
            PlayerState creditedKiller,
            PassiveKillContext context)
        {
            if (!state.Players.TryGetValue(
                    context.SourceEntityId,
                    out var directKiller) ||
                !ReferenceEquals(directKiller, creditedKiller) ||
                !PassiveRuntimeSystem.TryFind(
                    directKiller,
                    GameplayIds.Execute,
                    out var loadout) ||
                loadout.Level != 5)
            {
                return;
            }

            var definition = PassiveCatalog.Get(GameplayIds.Execute);
            var threshold = PassiveCatalog.LevelValue(
                definition.ThresholdPercentByLevel,
                loadout.Level);
            if ((long)context.VictimHpBefore * 100 >
                (long)context.VictimMaxHp * threshold)
            {
                return;
            }

            var before = directKiller.Hp;
            directKiller.Hp = Math.Min(
                directKiller.MaxHp,
                checked(
                    directKiller.Hp +
                    Math.Max(
                        1,
                        directKiller.MaxHp *
                        definition.Level5KillHealPercent /
                        100)));
            Emit(
                state,
                events,
                directKiller,
                GameplayIds.Execute,
                "execute-heal",
                directKiller.Hp - before,
                context.VictimEntityId);
        }

        private static void RemoveMarksForTarget(
            SimulationState state,
            int targetEntityId)
        {
            for (var index = state.BountyMarks.Count - 1;
                index >= 0;
                index -= 1)
            {
                if (state.BountyMarks[index].TargetEntityId ==
                    targetEntityId)
                {
                    state.BountyMarks.RemoveAt(index);
                }
            }
        }

        private static void Emit(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            string passiveId,
            string detail,
            int amount,
            int targetEntityId,
            int durationTicks = 0)
        {
            events.Add(
                new SimEvent
                {
                    Type = "passive-proc",
                    Tick = state.Tick,
                    PassiveId = passiveId,
                    SourceEntityId = player.EntityId,
                    TargetEntityId = targetEntityId,
                    Detail = detail,
                    Amount = amount,
                    DurationTicks = durationTicks
                });
        }
    }
}
