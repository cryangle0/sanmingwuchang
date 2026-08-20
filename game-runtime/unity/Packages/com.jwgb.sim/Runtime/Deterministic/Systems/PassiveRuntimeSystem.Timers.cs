using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveRuntimeSystem
    {
        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            foreach (var player in state.Players.Values)
            {
                AdvancePlayerTimers(player);
                ResolveAdversity(state, events, player);
                ResolveRecovery(state, events, player);
            }

            foreach (var monster in state.Monsters.Values)
            {
                var silenceWasActive = monster.SilenceTicks > 0;
                monster.SilenceTicks = Math.Max(
                    0,
                    monster.SilenceTicks - 1);
                monster.BlindTicks = Math.Max(
                    0,
                    monster.BlindTicks - 1);
                if (monster.BlindTicks == 0)
                {
                    monster.BlindMissPercent = 0;
                }

                if (silenceWasActive && monster.SilenceTicks == 0)
                {
                    monster.SilenceCooldownPenaltyTicks = 0;
                }
            }

            foreach (var targetState in state.PassiveTargetStates.Values)
            {
                targetState.StunCooldownTicks = Math.Max(
                    0,
                    targetState.StunCooldownTicks - 1);
                targetState.CounterCooldownTicks = Math.Max(
                    0,
                    targetState.CounterCooldownTicks - 1);
                targetState.PickpocketCooldownTicks = Math.Max(
                    0,
                    targetState.PickpocketCooldownTicks - 1);
                if (targetState.PoisonExpiresAtTick <= state.Tick)
                {
                    targetState.PoisonStacks = 0;
                    targetState.PoisonNextTick = 0;
                }

                if (targetState.FireBurnExpiresAtTick <= state.Tick)
                {
                    targetState.FireBurnDamagePerSecond = 0;
                    targetState.FireBurnNextTick = 0;
                    targetState.FireBurnSourceEntityId = null;
                }
            }
        }

        private static void AdvancePlayerTimers(PlayerState player)
        {
            var silenceWasActive = player.SilenceTicks > 0;
            player.SlowTicks = Math.Max(0, player.SlowTicks - 1);
            player.SilenceTicks = Math.Max(
                0,
                player.SilenceTicks - 1);
            player.BlindTicks = Math.Max(0, player.BlindTicks - 1);
            player.B15SpeedBoostTicks = Math.Max(
                0,
                player.B15SpeedBoostTicks - 1);
            player.B25AttackSpeedBoostTicks = Math.Max(
                0,
                player.B25AttackSpeedBoostTicks - 1);
            player.B27SpeedBoostTicks = Math.Max(
                0,
                player.B27SpeedBoostTicks - 1);
            player.B38NextHealTick = Math.Max(
                0,
                player.B38NextHealTick - 1);
            player.B42SpeedBoostTicks = Math.Max(
                0,
                player.B42SpeedBoostTicks - 1);
            if (player.SlowTicks == 0)
            {
                player.SlowBasisPoints = 10_000;
            }
            if (player.BlindTicks == 0)
            {
                player.BlindMissPercent = 0;
            }
            if (silenceWasActive &&
                player.SilenceTicks == 0 &&
                player.SilenceCooldownPenaltyTicks > 0)
            {
                player.ActiveCooldownTicks = checked(
                    player.ActiveCooldownTicks +
                    player.SilenceCooldownPenaltyTicks);
                player.SilenceCooldownPenaltyTicks = 0;
            }
            if (player.B15SpeedBoostTicks == 0)
            {
                player.B15SpeedBonusPercent = 0;
            }
            if (player.B27SpeedBoostTicks == 0)
            {
                player.B27SpeedBonusPercent = 0;
            }
            if (player.B42SpeedBoostTicks == 0)
            {
                player.B42SpeedBonusPercent = 0;
            }
        }

        private static void ResolveAdversity(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            if (player.HardControlTicks <= 0 ||
                player.B38NextHealTick > 0 ||
                !TryFind(
                    player,
                    GameplayIds.Adversity,
                    out _))
            {
                return;
            }

            var before = player.Hp;
            player.Hp = Math.Min(
                player.MaxHp,
                player.Hp + Math.Max(1, player.MaxHp * 2 / 100));
            player.B38NextHealTick =
                SimulationConstants.TicksPerSecond;
            if (player.Hp > before)
            {
                AddRuntimeProc(
                    state,
                    events,
                    GameplayIds.Adversity,
                    player.EntityId,
                    "control-heal",
                    player.Hp - before,
                    SimulationConstants.TicksPerSecond);
            }
        }

        private static void ResolveRecovery(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            if (player.LifeState != LifeState.Alive ||
                !TryFind(
                    player,
                    GameplayIds.Recovery,
                    out var recovery))
            {
                return;
            }

            var definition = PassiveCatalog.Get(GameplayIds.Recovery);
            var threshold = PassiveCatalog.LevelValue(
                definition.OutOfCombatTicksByLevel,
                recovery.Level);
            if (recovery.Level == 5 &&
                state.Tick - player.LastCombatTick >= threshold)
            {
                player.B21FirstHitReady = true;
            }

            if (state.Tick - player.LastCombatTick < threshold ||
                state.Tick % SimulationConstants.TicksPerSecond != 0)
            {
                return;
            }

            var before = player.Hp;
            player.Hp = Math.Min(
                player.MaxHp,
                player.Hp + PassiveCatalog.LevelValue(
                    definition.HealPerSecondByLevel,
                    recovery.Level));
            if (player.Hp > before)
            {
                AddRuntimeProc(
                    state,
                    events,
                    GameplayIds.Recovery,
                    player.EntityId,
                    "recovery-heal",
                    player.Hp - before,
                    0);
            }
        }

        private static void AddRuntimeProc(
            SimulationState state,
            List<SimEvent> events,
            string passiveId,
            int sourceEntityId,
            string detail,
            int amount,
            int durationTicks)
        {
            events.Add(
                new SimEvent
                {
                    Type = "passive-proc",
                    Tick = state.Tick,
                    PassiveId = passiveId,
                    SourceEntityId = sourceEntityId,
                    TargetEntityId = 0,
                    Detail = detail,
                    Amount = amount,
                    DurationTicks = durationTicks
                });
        }
    }
}
