using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of advanceMonster / nearestLivingPlayer from
    /// packages/sim/src/systems/pve.ts.
    /// </summary>
    internal static class PveAiSystem
    {
        public static void Advance(
            SimulationState state,
            List<SimEvent> events,
            MonsterState monster)
        {
            AdvanceTimers(monster);
            if (monster.HardControlTicks > 0)
            {
                return;
            }

            var scriptedSpeed = (int)(
                (long)monster.MoveSpeedMmPerSecond *
                (100 + (monster.PolymorphTicks > 0
                    ? monster.PolymorphSpeedBonusPercent
                    : 0)) /
                100);

            var target = SelectTarget(state, monster);
            monster.TargetEntityId = target?.EntityId;
            if (target == null)
            {
                Move(state, monster, monster.HomePosition, scriptedSpeed);
                return;
            }

            var range = monster.AttackRangeMm +
                GameplayRules.PlayerCapsuleRadiusMm;
            if (IntegerMath.DistanceSquared(
                    monster.Position,
                    target.Position) >
                (long)range * range)
            {
                Move(state, monster, target.Position, scriptedSpeed);
                monster.Facing = new Int2Mm(
                    SignDirection(target.Position.X - monster.Position.X),
                    SignDirection(target.Position.Z - monster.Position.Z));
                return;
            }

            if (monster.AttackCooldownTicks > 0 ||
                target.LifeState != LifeState.Alive ||
                monster.PolymorphTicks > 0 ||
                !LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    monster.Position,
                    target.Position,
                    monster.CollisionRadiusMm,
                    Traversal(monster)))
            {
                return;
            }

            monster.AttackCooldownTicks = monster.AttackPeriodTicks;
            if (PassiveRuntimeSystem.IsBasicAttackMissed(state, monster))
            {
                return;
            }

            DamageSystem.Apply(
                state,
                events,
                new DamageRequest(
                    monster.EntityId,
                    target.EntityId,
                    monster.AttackPower,
                    DamageCause.Monster,
                    DamageForm.Basic,
                    10_000));
        }

        /// <summary>
        /// Flying monsters cross flight-passable walls up to 2.5 m;
        /// everything else walks.
        /// </summary>
        internal static WallTraversal Traversal(MonsterState monster)
        {
            return WallTraversal.Flight(
                monster.Kind == MonsterKind.Flying ? 2_500 : 0);
        }

        private static void AdvanceTimers(MonsterState monster)
        {
            monster.AttackCooldownTicks = Math.Max(
                0,
                monster.AttackCooldownTicks - 1);
            monster.InvulnerableTicks = Math.Max(
                0,
                monster.InvulnerableTicks - 1);
            monster.HardControlTicks = Math.Max(
                0,
                monster.HardControlTicks - 1);
            monster.SlowTicks = Math.Max(0, monster.SlowTicks - 1);
            if (monster.SlowTicks == 0)
            {
                monster.SlowBasisPoints = 10_000;
            }
        }

        private static bool PlayerHidden(PlayerState player)
        {
            return player.StealthTicks > 0 || player.NightCloakStealthed;
        }

        private static bool CanSee(
            SimulationState state,
            MonsterState monster,
            PlayerState player)
        {
            if (PlayerHidden(player) &&
                !(monster.Kind == MonsterKind.CoreBoss &&
                  IntegerMath.DistanceSquared(
                      monster.Position,
                      player.Position) <= 10_000L * 10_000L))
            {
                return false;
            }

            return LineOfSightSystem.HasDirectLineOfSight(
                state,
                monster.Position,
                player.Position,
                monster.CollisionRadiusMm,
                Traversal(monster));
        }

        private static PlayerState SelectTarget(
            SimulationState state,
            MonsterState monster)
        {
            if (monster.TargetEntityId.HasValue &&
                state.Players.TryGetValue(
                    monster.TargetEntityId.Value,
                    out var existing) &&
                existing.LifeState == LifeState.Alive &&
                InsideLeash(monster, existing.Position) &&
                LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    monster.Position,
                    existing.Position,
                    monster.CollisionRadiusMm,
                    Traversal(monster)))
            {
                return existing;
            }

            PlayerState best = null;
            var bestDistance = long.MaxValue;
            foreach (var player in state.Players.Values)
            {
                if (player.LifeState != LifeState.Alive)
                {
                    continue;
                }

                // Distance gate first: the pure predicates commute, and
                // skipping line-of-sight for out-of-aggro players keeps
                // 123 monsters x 30 players inside the 20 Hz budget.
                // Result-identical to the TS oracle's filter chain.
                var distance = IntegerMath.DistanceSquared(
                    monster.Position,
                    player.Position);
                if (distance >
                    (long)monster.AggroRadiusMm * monster.AggroRadiusMm ||
                    !CanSee(state, monster, player))
                {
                    continue;
                }

                if (distance < bestDistance ||
                    (distance == bestDistance &&
                     (best == null || player.EntityId < best.EntityId)))
                {
                    best = player;
                    bestDistance = distance;
                }
            }

            return best;
        }

        private static bool InsideLeash(
            MonsterState monster,
            Int2Mm position)
        {
            return IntegerMath.DistanceSquared(
                    monster.HomePosition,
                    position) <=
                (long)monster.LeashRadiusMm * monster.LeashRadiusMm;
        }

        private static void Move(
            SimulationState state,
            MonsterState monster,
            Int2Mm destination,
            int scriptedSpeed)
        {
            var distance = (int)(
                (long)scriptedSpeed *
                monster.SlowBasisPoints /
                (SimulationConstants.TicksPerSecond * 10_000L));
            var candidate = IntegerMath.MoveToward(
                monster.Position,
                destination,
                distance);
            monster.Position = WorldMovement.Resolve(
                state,
                monster.Position,
                candidate,
                monster.CollisionRadiusMm,
                Traversal(monster));
        }

        private static int SignDirection(int value)
        {
            return value == 0 ? 0 : value > 0 ? 1_000 : -1_000;
        }
    }
}
