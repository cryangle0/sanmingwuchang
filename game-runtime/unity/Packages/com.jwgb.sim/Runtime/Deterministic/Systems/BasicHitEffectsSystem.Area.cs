using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class BasicHitEffectsSystem
    {
        private static int ApplyRawPassiveDamage(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            int amount,
            DamageForm form,
            bool ignoreExecute)
        {
            if (target.IsPlayer)
            {
                return DamageSystem.Apply(
                    state,
                    events,
                    new DamageRequest(
                        owner.EntityId,
                        target.EntityId,
                        Math.Max(1, amount),
                        DamageCause.Passive,
                        form,
                        null,
                        false,
                        0,
                        false,
                        ignoreExecute));
            }

            return MonsterDamageSystem.Apply(
                state,
                events,
                owner.EntityId,
                target.Monster,
                Math.Max(1, amount),
                owner.Element,
                null,
                ignoreExecute);
        }

        private static int ApplyElementalPassiveDamage(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            CombatTarget target,
            int amount,
            bool isCritical,
            int shieldBypassPercent)
        {
            if (target.IsPlayer)
            {
                var elementBasis =
                    GameplayRules.ElementDamageBasisPoints(
                        owner.Element,
                        target.Player.Element);
                return DamageSystem.Apply(
                    state,
                    events,
                    new DamageRequest(
                        owner.EntityId,
                        target.EntityId,
                        Math.Max(1, amount * elementBasis / 10_000),
                        DamageCause.Passive,
                        DamageForm.Skill,
                        null,
                        isCritical,
                        shieldBypassPercent * 100));
            }

            return MonsterDamageSystem.Apply(
                state,
                events,
                owner.EntityId,
                target.Monster,
                amount,
                owner.Element);
        }

        private static void ApplyAreaDamage(
            SimulationState state,
            List<SimEvent> events,
            PlayerState owner,
            Int2Mm center,
            int mainTargetEntityId,
            int radiusMm,
            int amount,
            bool elemental,
            bool includeMainTarget)
        {
            var radiusSquared = (long)radiusMm * radiusMm;
            var players = new List<PlayerState>(state.Players.Values);
            for (var index = 0; index < players.Count; index += 1)
            {
                var target = players[index];
                if (target.EntityId == owner.EntityId ||
                    (!includeMainTarget &&
                     target.EntityId == mainTargetEntityId) ||
                    target.LifeState != LifeState.Alive ||
                    IntegerMath.DistanceSquared(
                        center,
                        target.Position) > radiusSquared)
                {
                    continue;
                }

                var combatTarget = new CombatTarget(target);
                if (elemental)
                {
                    ApplyElementalPassiveDamage(
                        state,
                        events,
                        owner,
                        combatTarget,
                        amount,
                        false,
                        0);
                }
                else
                {
                    ApplyRawPassiveDamage(
                        state,
                        events,
                        owner,
                        combatTarget,
                        amount,
                        DamageForm.Dot,
                        false);
                }
            }

            var monsters = new List<MonsterState>(state.Monsters.Values);
            for (var index = 0; index < monsters.Count; index += 1)
            {
                var target = monsters[index];
                if ((!includeMainTarget &&
                     target.EntityId == mainTargetEntityId) ||
                    target.Hp <= 0 ||
                    IntegerMath.DistanceSquared(
                        center,
                        target.Position) > radiusSquared)
                {
                    continue;
                }

                var combatTarget = new CombatTarget(target);
                if (elemental)
                {
                    ApplyElementalPassiveDamage(
                        state,
                        events,
                        owner,
                        combatTarget,
                        amount,
                        false,
                        0);
                }
                else
                {
                    ApplyRawPassiveDamage(
                        state,
                        events,
                        owner,
                        combatTarget,
                        amount,
                        DamageForm.Dot,
                        false);
                }
            }

            var summonDamage = Math.Max(
                1,
                amount *
                LethalProtectionSystem
                    .GetOutgoingDamageBasisPoints(owner) /
                10_000);
            var summons = new List<SummonState>(state.Summons.Values);
            for (var index = 0; index < summons.Count; index += 1)
            {
                var summon = summons[index];
                if (summon.OwnerEntityId == owner.EntityId ||
                    (!includeMainTarget &&
                     summon.EntityId == mainTargetEntityId) ||
                    !summon.Targetable ||
                    summon.Hp <= 0 ||
                    IntegerMath.DistanceSquared(
                        center,
                        summon.Position) > radiusSquared)
                {
                    continue;
                }

                SummonHealthSystem.Apply(
                    state,
                    events,
                    owner.EntityId,
                    summon,
                    summonDamage);
            }
        }
    }
}
