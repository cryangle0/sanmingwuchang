using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveRuntimeSystem
    {
        public static void AdvanceDamageOverTime(
            SimulationState state,
            List<SimEvent> events)
        {
            var targetStates = new List<PassiveTargetState>(
                state.PassiveTargetStates.Values);
            targetStates.Sort(
                (left, right) =>
                {
                    var result = left.SourceEntityId.CompareTo(
                        right.SourceEntityId);
                    return result != 0
                        ? result
                        : left.TargetEntityId.CompareTo(
                            right.TargetEntityId);
                });
            for (var index = 0; index < targetStates.Count; index += 1)
            {
                AdvancePoison(state, events, targetStates[index]);
            }
            for (var index = 0; index < targetStates.Count; index += 1)
            {
                AdvanceFireBurn(state, events, targetStates[index]);
            }
        }

        private static void AdvancePoison(
            SimulationState state,
            List<SimEvent> events,
            PassiveTargetState targetState)
        {
            if (targetState.PoisonStacks <= 0 ||
                targetState.PoisonNextTick <= 0 ||
                state.Tick < targetState.PoisonNextTick ||
                state.Tick >= targetState.PoisonExpiresAtTick)
            {
                return;
            }

            if (!state.Players.TryGetValue(
                    targetState.SourceEntityId,
                    out var source) ||
                !TryFind(
                    source,
                    GameplayIds.Poison,
                    out var poison) ||
                !TryGetLivingTarget(
                    state,
                    targetState.TargetEntityId,
                    out var target))
            {
                targetState.PoisonStacks = 0;
                targetState.PoisonNextTick = 0;
                return;
            }

            var definition = PassiveCatalog.Get(GameplayIds.Poison);
            var damagePerStack = PassiveCatalog.LevelValue(
                definition.DamagePerSecondByLevel,
                poison.Level);
            if (poison.Level == 5 &&
                targetState.PoisonStacks >= PassiveCatalog.LevelValue(
                    definition.MaxStacksByLevel,
                    poison.Level))
            {
                damagePerStack = damagePerStack *
                    definition.Level5FullStackMultiplierBasisPoints /
                    10_000;
            }

            var amount = Math.Max(
                1,
                targetState.PoisonStacks * damagePerStack);
            ApplyDot(
                state,
                events,
                source,
                target,
                amount,
                false);
            AddDotProc(
                state,
                events,
                GameplayIds.Poison,
                source.EntityId,
                target.EntityId,
                "poison-tick",
                amount,
                targetState.PoisonExpiresAtTick - state.Tick);
            targetState.PoisonNextTick +=
                SimulationConstants.TicksPerSecond;
        }

        private static void AdvanceFireBurn(
            SimulationState state,
            List<SimEvent> events,
            PassiveTargetState targetState)
        {
            if (targetState.FireBurnDamagePerSecond <= 0 ||
                !targetState.FireBurnSourceEntityId.HasValue ||
                targetState.FireBurnNextTick <= 0 ||
                state.Tick < targetState.FireBurnNextTick ||
                state.Tick >= targetState.FireBurnExpiresAtTick)
            {
                return;
            }

            if (!state.Players.TryGetValue(
                    targetState.FireBurnSourceEntityId.Value,
                    out var source) ||
                !TryGetLivingTarget(
                    state,
                    targetState.TargetEntityId,
                    out var target))
            {
                targetState.FireBurnDamagePerSecond = 0;
                targetState.FireBurnNextTick = 0;
                targetState.FireBurnSourceEntityId = null;
                return;
            }

            var amount = targetState.FireBurnDamagePerSecond;
            ApplyDot(
                state,
                events,
                source,
                target,
                amount,
                true);
            AddDotProc(
                state,
                events,
                GameplayIds.FireSpirit,
                source.EntityId,
                target.EntityId,
                "fire-spirit-burn",
                amount,
                targetState.FireBurnExpiresAtTick - state.Tick);
            targetState.FireBurnNextTick +=
                SimulationConstants.TicksPerSecond;
        }

        private static void ApplyDot(
            SimulationState state,
            List<SimEvent> events,
            PlayerState source,
            CombatTarget target,
            int amount,
            bool ignoreSourceBonuses)
        {
            if (target.IsPlayer)
            {
                DamageSystem.Apply(
                    state,
                    events,
                    new DamageRequest(
                        source.EntityId,
                        target.EntityId,
                        amount,
                        DamageCause.Passive,
                        DamageForm.Dot,
                        null,
                        false,
                        0,
                        true,
                        ignoreSourceBonuses,
                        ignoreSourceBonuses));
            }
            else
            {
                MonsterDamageSystem.Apply(
                    state,
                    events,
                    source.EntityId,
                    target.Monster,
                    amount,
                    source.Element,
                    null,
                    ignoreSourceBonuses,
                    ignoreSourceBonuses);
            }
        }

        private static bool TryGetLivingTarget(
            SimulationState state,
            int entityId,
            out CombatTarget target)
        {
            if (state.Players.TryGetValue(entityId, out var player) &&
                player.LifeState == LifeState.Alive)
            {
                target = new CombatTarget(player);
                return true;
            }

            if (state.Monsters.TryGetValue(entityId, out var monster) &&
                monster.Hp > 0)
            {
                target = new CombatTarget(monster);
                return true;
            }

            target = default;
            return false;
        }

        private static void AddDotProc(
            SimulationState state,
            List<SimEvent> events,
            string passiveId,
            int sourceEntityId,
            int targetEntityId,
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
                    TargetEntityId = targetEntityId,
                    Detail = detail,
                    Amount = amount,
                    DurationTicks = durationTicks
                });
        }
    }
}
