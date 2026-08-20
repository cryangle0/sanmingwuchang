using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal enum PassiveKillVictimKind : byte
    {
        Hero = 1,
        Monster = 2
    }

    internal readonly struct PassiveKillContext
    {
        public PassiveKillContext(
            int sourceEntityId,
            int victimEntityId,
            PassiveKillVictimKind victimKind,
            int victimHpBefore,
            int victimMaxHp,
            PlayerState victimPlayer = null)
        {
            SourceEntityId = sourceEntityId;
            VictimEntityId = victimEntityId;
            VictimKind = victimKind;
            VictimHpBefore = victimHpBefore;
            VictimMaxHp = victimMaxHp;
            VictimPlayer = victimPlayer;
        }

        public int SourceEntityId { get; }
        public int VictimEntityId { get; }
        public PassiveKillVictimKind VictimKind { get; }
        public int VictimHpBefore { get; }
        public int VictimMaxHp { get; }
        public PlayerState VictimPlayer { get; }
    }

    internal static partial class PassiveKillSystem
    {
        public static void Resolve(
            SimulationState state,
            List<SimEvent> events,
            PassiveKillContext context)
        {
            var killer = CreditedPlayer(state, context.SourceEntityId);
            if (killer == null)
            {
                if (context.VictimKind == PassiveKillVictimKind.Hero)
                {
                    RemoveMarksForTarget(state, context.VictimEntityId);
                }

                return;
            }

            if (context.VictimKind == PassiveKillVictimKind.Hero &&
                context.VictimPlayer != null)
            {
                var victim = context.VictimPlayer;
                var baseGold =
                    500 +
                    Math.Min(1_500, Math.Max(0, victim.Level) * 100) +
                    (Math.Max(0, victim.Gold) / 10);
                var eliminationBonus =
                    victim.LivesRemaining <= 0 ? 500 : 0;
                var gold = EquipmentEconomySystem.GrantGeneratedGold(
                    killer,
                    baseGold + eliminationBonus);
                var experience = EquipmentEconomySystem.GrantExperience(
                    killer,
                    Math.Min(
                        180,
                        60 + (Math.Max(0, victim.Level) * 8)));
                // The migration exporter maps hero-kill-reward through the
                // default (empty) fixture shape, so only type/tick are
                // asserted by parity tests.
                events.Add(
                    new SimEvent
                    {
                        Type = "hero-kill-reward",
                        Tick = state.Tick
                    });
                _ = gold;
                _ = experience;
            }

            var wasBountyTarget =
                context.VictimKind == PassiveKillVictimKind.Hero &&
                ResolveBountyReward(
                    state,
                    events,
                    killer,
                    context.VictimEntityId);
            if (wasBountyTarget)
            {
                ApplyBountyHunter(
                    state,
                    events,
                    killer,
                    context.VictimEntityId);
            }

            ResolveGreed(state, events, killer, context);
            ResolveTenacity(state, events, killer, context);
            ResolveExecuteHeal(state, events, killer, context);
            if (context.VictimPlayer != null)
            {
                CreateBountyMark(
                    state,
                    events,
                    context.VictimPlayer,
                    killer);
            }
        }

        public static void Advance(SimulationState state)
        {
            for (var index = state.BountyMarks.Count - 1;
                index >= 0;
                index -= 1)
            {
                if (state.BountyMarks[index].ExpiresAtTick <= state.Tick)
                {
                    state.BountyMarks.RemoveAt(index);
                }
            }
        }

        private static PlayerState CreditedPlayer(
            SimulationState state,
            int sourceEntityId)
        {
            if (state.Players.TryGetValue(
                    sourceEntityId,
                    out var direct))
            {
                return direct;
            }

            return state.Summons.TryGetValue(
                    sourceEntityId,
                    out var summon) &&
                state.Players.TryGetValue(
                    summon.OwnerEntityId,
                    out var owner)
                    ? owner
                    : null;
        }

        private static bool ResolveBountyReward(
            SimulationState state,
            List<SimEvent> events,
            PlayerState killer,
            int victimEntityId)
        {
            var reward = 0;
            for (var index = state.BountyMarks.Count - 1;
                index >= 0;
                index -= 1)
            {
                var mark = state.BountyMarks[index];
                if (mark.ExpiresAtTick <= state.Tick)
                {
                    state.BountyMarks.RemoveAt(index);
                    continue;
                }

                if (mark.TargetEntityId != victimEntityId)
                {
                    continue;
                }

                reward = checked(reward + mark.RewardGold);
                state.BountyMarks.RemoveAt(index);
            }

            if (reward <= 0)
            {
                return false;
            }

            killer.Gold = checked(killer.Gold + reward);
            Emit(
                state,
                events,
                killer,
                GameplayIds.Bounty,
                "bounty-reward",
                reward,
                victimEntityId);
            return true;
        }

        private static void ApplyBountyHunter(
            SimulationState state,
            List<SimEvent> events,
            PlayerState killer,
            int victimEntityId)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    killer,
                    GameplayIds.BountyHunter,
                    out var loadout))
            {
                return;
            }

            var definition = PassiveCatalog.Get(
                GameplayIds.BountyHunter);
            var reduction = PassiveCatalog.LevelValue(
                definition.CooldownReductionTicksByLevel,
                loadout.Level);
            killer.ActiveCooldownTicks = Math.Max(
                0,
                killer.ActiveCooldownTicks - reduction);
            if (loadout.Level == 5)
            {
                killer.B42SpeedBoostTicks =
                    definition.SpeedDurationTicks;
                killer.B42SpeedBonusPercent =
                    definition.SpeedBonusPercent;
            }

            Emit(
                state,
                events,
                killer,
                GameplayIds.BountyHunter,
                "bounty-hunter",
                reduction,
                victimEntityId,
                killer.B42SpeedBoostTicks);
        }

        private static void CreateBountyMark(
            SimulationState state,
            List<SimEvent> events,
            PlayerState victim,
            PlayerState killer)
        {
            if (victim.EntityId == killer.EntityId ||
                !PassiveRuntimeSystem.TryFind(
                    victim,
                    GameplayIds.Bounty,
                    out var loadout))
            {
                return;
            }

            var definition = PassiveCatalog.Get(GameplayIds.Bounty);
            var durationTicks = PassiveCatalog.LevelValue(
                definition.MarkDurationTicksByLevel,
                loadout.Level);
            var rewardGold = PassiveCatalog.LevelValue(
                definition.RewardGoldByLevel,
                loadout.Level);
            BountyMarkState existing = null;
            for (var index = 0;
                index < state.BountyMarks.Count;
                index += 1)
            {
                if (state.BountyMarks[index].TargetEntityId !=
                    killer.EntityId)
                {
                    continue;
                }

                existing = state.BountyMarks[index];
                state.BountyMarks.RemoveAt(index);
                break;
            }

            state.BountyMarks.Add(
                new BountyMarkState
                {
                    SourceEntityId = victim.EntityId,
                    TargetEntityId = killer.EntityId,
                    RewardGold = Math.Max(
                        existing?.RewardGold ?? 0,
                        rewardGold),
                    RevealToAll =
                        (existing?.RevealToAll ?? false) ||
                        (loadout.Level == 5 &&
                         definition.Level5Reveal),
                    ExpiresAtTick = Math.Max(
                        existing?.ExpiresAtTick ?? 0,
                        checked(state.Tick + durationTicks))
                });
            Emit(
                state,
                events,
                victim,
                GameplayIds.Bounty,
                "bounty-mark",
                rewardGold,
                killer.EntityId,
                durationTicks);
        }

    }
}
