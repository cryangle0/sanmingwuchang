using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class SummonSystem
    {
        private static void AdvanceWolf(
            SimulationState state,
            List<SimEvent> events,
            SummonState summon,
            PlayerState owner)
        {
            var target = FindNearestEnemy(state, owner, summon.Position);
            if (!target.HasValue)
            {
                summon.Position = IntegerMath.MoveToward(
                    summon.Position,
                    owner.Position,
                    4_000 / SimulationConstants.TicksPerSecond);
                return;
            }

            var selected = target.Value;
            if (IntegerMath.DistanceSquared(
                    summon.Position,
                    selected.Position) > 2_000L * 2_000)
            {
                summon.Position = IntegerMath.MoveToward(
                    summon.Position,
                    selected.Position,
                    4_000 / SimulationConstants.TicksPerSecond);
                return;
            }

            if (summon.AttackCooldownTicks > 0)
            {
                return;
            }

            summon.AttackCooldownTicks =
                SimulationConstants.TicksPerSecond;
            ApplySummonAttack(
                state,
                events,
                summon,
                owner,
                selected,
                summon.AttackPower);
        }

        private static void AdvanceFireSpirit(
            SimulationState state,
            List<SimEvent> events,
            SummonState summon,
            PlayerState owner)
        {
            var offset = FireSpiritOffsets[
                state.Tick % FireSpiritOffsets.Length];
            summon.Position = new Int2Mm(
                checked(owner.Position.X + offset.X),
                checked(owner.Position.Z + offset.Z));
            summon.TouchCooldownTicks = Math.Max(
                0,
                summon.TouchCooldownTicks - 1);
            if (summon.TouchCooldownTicks > 0)
            {
                return;
            }

            var target = FindNearestEnemy(state, owner, summon.Position);
            if (!target.HasValue ||
                IntegerMath.DistanceSquared(
                    summon.Position,
                    target.Value.Position) > 1_000L * 1_000)
            {
                return;
            }

            if (!PassiveRuntimeSystem.TryFind(
                    owner,
                    GameplayIds.FireSpirit,
                    out var loadout))
            {
                return;
            }

            var definition = PassiveCatalog.Get(GameplayIds.FireSpirit);
            summon.TouchCooldownTicks = definition.ContactCooldownTicks;
            var selected = target.Value;
            ApplySummonAttack(
                state,
                events,
                summon,
                owner,
                selected,
                PassiveCatalog.LevelValue(
                    definition.ContactDamageByLevel,
                    loadout.Level));
            PassiveRuntimeSystem.ApplyFireSpiritBurn(
                state,
                owner.EntityId,
                selected.EntityId,
                definition.BurnDamagePerSecond,
                definition.BurnDurationTicks);
        }

        private static void ApplySummonAttack(
            SimulationState state,
            List<SimEvent> events,
            SummonState summon,
            PlayerState owner,
            CombatTarget target,
            int amount)
        {
            if (target.IsPlayer)
            {
                DamageSystem.Apply(
                    state,
                    events,
                    new DamageRequest(
                        summon.EntityId,
                        target.EntityId,
                        amount,
                        DamageCause.Passive,
                        DamageForm.Skill,
                        10_000));
                return;
            }

            MonsterDamageSystem.Apply(
                state,
                events,
                summon.EntityId,
                target.Monster,
                amount,
                owner.Element);
        }

        private static CombatTarget? FindNearestEnemy(
            SimulationState state,
            PlayerState owner,
            Int2Mm position)
        {
            CombatTarget? requested = null;
            CombatTarget? best = null;
            var bestDistance = long.MaxValue;
            foreach (var player in state.Players.Values)
            {
                if (player.EntityId == owner.EntityId ||
                    player.LifeState != LifeState.Alive ||
                    player.InvulnerableTicks > 0)
                {
                    continue;
                }

                ConsiderTarget(
                    owner,
                    position,
                    new CombatTarget(player),
                    ref requested,
                    ref best,
                    ref bestDistance);
            }

            foreach (var monster in state.Monsters.Values)
            {
                if (monster.Hp <= 0 || monster.InvulnerableTicks > 0)
                {
                    continue;
                }

                ConsiderTarget(
                    owner,
                    position,
                    new CombatTarget(monster),
                    ref requested,
                    ref best,
                    ref bestDistance);
            }

            return requested ?? best;
        }

        private static void ConsiderTarget(
            PlayerState owner,
            Int2Mm position,
            CombatTarget candidate,
            ref CombatTarget? requested,
            ref CombatTarget? best,
            ref long bestDistance)
        {
            var distance = IntegerMath.DistanceSquared(
                position,
                candidate.Position);
            if (distance > 50_000L * 50_000)
            {
                return;
            }

            if (owner.Intent.TargetEntityId == candidate.EntityId)
            {
                requested = candidate;
            }

            if (distance < bestDistance ||
                (distance == bestDistance &&
                 (!best.HasValue ||
                  candidate.EntityId < best.Value.EntityId)))
            {
                best = candidate;
                bestDistance = distance;
            }
        }
    }
}
