using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class CombatSystem
    {
        public static void ResolveBasicAttacks(
            SimulationState state,
            List<SimEvent> events)
        {
            foreach (var attacker in state.Players.Values)
            {
                if (attacker.LifeState != LifeState.Alive ||
                    !attacker.Intent.Attack ||
                    attacker.AttackCooldownTicks > 0 ||
                    attacker.HardControlTicks > 0 ||
                    attacker.WhirlwindTicks > 0 ||
                    attacker.IceCoffinTicks > 0)
                {
                    continue;
                }

                var target = SelectTarget(state, attacker);
                if (!target.HasValue)
                {
                    continue;
                }
                var selectedTarget = target.Value;

                var active = ActiveCatalog.Get(
                    attacker.ActiveAbilityId);
                var attackSpeedPercent =
                    attacker.ActiveBuffTicks > 0 &&
                    active.Effect == ActiveEffect.SelfCombatBuff
                        ? active.AttackSpeedPercent
                        : 0;
                var attacksPerSecondMilli = checked(
                    attacker.AttacksPerSecondMilli *
                    (100 + attackSpeedPercent) /
                    100);
                attacker.AttackCooldownTicks = DivideCeiling(
                    SimulationConstants.TicksPerSecond * 1_000,
                    attacksPerSecondMilli);
                var attack = BasicHitSystem.CreateSnapshot(
                    attacker,
                    LethalProtectionSystem
                        .GetOutgoingDamageBasisPoints(attacker));
                if (attacker.BasicAttackKind ==
                    BasicAttackKind.RangedProjectile)
                {
                    var projectile = HeroCatalog.Get(
                        attacker.HeroId).BasicProjectile;
                    if (projectile == null)
                    {
                        throw new InvalidOperationException(
                            $"Hero {attacker.HeroId} has no projectile.");
                    }

                    ProjectileSystem.Launch(
                        state,
                        attacker,
                        selectedTarget,
                        projectile,
                        attack,
                        attacker.AttackRangeMm);
                }
                else if (selectedTarget.IsPlayer)
                {
                    BasicHitSystem.Resolve(
                        state,
                        events,
                        attacker,
                        selectedTarget.Player,
                        attack);
                }
                else if (selectedTarget.IsMonster)
                {
                    BasicHitSystem.ResolveMonster(
                        state,
                        events,
                        attacker,
                        selectedTarget.Monster,
                        attack);
                }
                else
                {
                    SummonHealthSystem.Apply(
                        state,
                        events,
                        attacker.EntityId,
                        selectedTarget.Summon,
                        Math.Max(
                            1,
                            checked(
                                attack.BaseDamage *
                                attack.OutgoingDamageBasisPoints /
                                10_000)));
                }
            }
        }

        private static CombatTarget? SelectTarget(
            SimulationState state,
            PlayerState attacker)
        {
            if (attacker.Intent.TargetEntityId.HasValue)
            {
                if (state.Players.TryGetValue(
                        attacker.Intent.TargetEntityId.Value,
                        out var requestedPlayer))
                {
                    return IsLegalTarget(attacker, requestedPlayer)
                        ? new CombatTarget(requestedPlayer)
                        : null;
                }

                if (state.Monsters.TryGetValue(
                        attacker.Intent.TargetEntityId.Value,
                        out var requestedMonster))
                {
                    return IsLegalTarget(attacker, requestedMonster)
                        ? new CombatTarget(requestedMonster)
                        : null;
                }

                if (state.Summons.TryGetValue(
                        attacker.Intent.TargetEntityId.Value,
                        out var requestedSummon))
                {
                    return IsLegalTarget(attacker, requestedSummon)
                        ? new CombatTarget(requestedSummon)
                        : null;
                }

                return null;
            }

            CombatTarget? best = null;
            var bestDistance = long.MaxValue;
            foreach (var candidate in state.Players.Values)
            {
                if (!IsLegalTarget(attacker, candidate))
                {
                    continue;
                }

                var distance = IntegerMath.DistanceSquared(
                    attacker.Position,
                    candidate.Position);
                if (distance < bestDistance ||
                    (distance == bestDistance &&
                     (!best.HasValue ||
                      candidate.EntityId < best.Value.EntityId)))
                {
                    best = new CombatTarget(candidate);
                    bestDistance = distance;
                }
            }

            foreach (var candidate in state.Monsters.Values)
            {
                if (!IsLegalTarget(attacker, candidate))
                {
                    continue;
                }

                var distance = IntegerMath.DistanceSquared(
                    attacker.Position,
                    candidate.Position);
                if (distance < bestDistance ||
                    (distance == bestDistance &&
                     (!best.HasValue ||
                      candidate.EntityId < best.Value.EntityId)))
                {
                    best = new CombatTarget(candidate);
                    bestDistance = distance;
                }
            }

            foreach (var candidate in state.Summons.Values)
            {
                if (!IsLegalTarget(attacker, candidate))
                {
                    continue;
                }

                var distance = IntegerMath.DistanceSquared(
                    attacker.Position,
                    candidate.Position);
                if (distance < bestDistance ||
                    (distance == bestDistance &&
                     (!best.HasValue ||
                      candidate.EntityId < best.Value.EntityId)))
                {
                    best = new CombatTarget(candidate);
                    bestDistance = distance;
                }
            }

            return best;
        }

        private static bool IsLegalTarget(
            PlayerState attacker,
            PlayerState target)
        {
            return
                attacker.EntityId != target.EntityId &&
                target.LifeState == LifeState.Alive &&
                IntegerMath.DistanceSquared(
                    attacker.Position,
                    target.Position) <=
                (long)attacker.AttackRangeMm *
                attacker.AttackRangeMm;
        }

        private static bool IsLegalTarget(
            PlayerState attacker,
            MonsterState target)
        {
            return target.Hp > 0 &&
                target.InvulnerableTicks <= 0 &&
                IntegerMath.DistanceSquared(
                    attacker.Position,
                    target.Position) <=
                (long)attacker.AttackRangeMm *
                attacker.AttackRangeMm;
        }

        private static bool IsLegalTarget(
            PlayerState attacker,
            SummonState target)
        {
            return target.Targetable &&
                target.Hp > 0 &&
                target.OwnerEntityId != attacker.EntityId &&
                IntegerMath.DistanceSquared(
                    attacker.Position,
                    target.Position) <=
                (long)attacker.AttackRangeMm *
                attacker.AttackRangeMm;
        }

        private static int DivideCeiling(int numerator, int denominator)
        {
            return checked((numerator + denominator - 1) / denominator);
        }
    }
}
