using System;
using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class ProjectileSystem
    {
        private static void BlockProjectile(
            SimulationState state,
            List<SimEvent> events,
            ProjectileState projectile,
            WindWallSweepHit wallHit)
        {
            state.Projectiles.Remove(projectile.EntityId);
            events.Add(
                new SimEvent
                {
                    Type = "projectile-blocked",
                    Tick = state.Tick,
                    ProjectileEntityId = projectile.EntityId,
                    SourceEntityId = projectile.OwnerEntityId,
                    TargetEntityId = projectile.TargetEntityId,
                    WallEntityId = wallHit.Wall.EntityId,
                    ProjectileKind = projectile.Kind
                });
        }

        private static void ResolveHit(
            SimulationState state,
            List<SimEvent> events,
            ProjectileState projectile,
            CombatTarget target)
        {
            state.Projectiles.Remove(projectile.EntityId);
            if (!state.Players.TryGetValue(
                    projectile.OwnerEntityId,
                    out var owner))
            {
                return;
            }

            if (target.IsSummon)
            {
                SummonHealthSystem.Apply(
                    state,
                    events,
                    owner.EntityId,
                    target.Summon,
                    Math.Max(
                        1,
                        checked(
                            projectile.BaseDamage *
                            projectile.OutgoingDamageBasisPoints /
                            10_000)));
                return;
            }

            if (projectile.Kind == "cold-arrow")
            {
                BasicHitSystem.ResolveColdArrow(
                    state,
                    events,
                    owner,
                    target,
                    projectile.BaseDamage);
                return;
            }

            var attack = new BasicAttackSnapshot(
                projectile.OwnerEntityId,
                projectile.SourceElement,
                projectile.BaseDamage,
                projectile.OutgoingDamageBasisPoints);
            if (target.IsPlayer)
            {
                BasicHitSystem.Resolve(
                    state,
                    events,
                    owner,
                    target.Player,
                    attack);
            }
            else if (target.IsMonster)
            {
                BasicHitSystem.ResolveMonster(
                    state,
                    events,
                    owner,
                    target.Monster,
                    attack);
            }
        }

        private static void BlockProjectileByMap(
            SimulationState state,
            List<SimEvent> events,
            ProjectileState projectile,
            string pieceId)
        {
            state.Projectiles.Remove(projectile.EntityId);
            events.Add(
                new SimEvent
                {
                    Type = "projectile-blocked",
                    Tick = state.Tick,
                    ProjectileEntityId = projectile.EntityId,
                    SourceEntityId = projectile.OwnerEntityId,
                    TargetEntityId = projectile.TargetEntityId,
                    BlockingSolidId = pieceId,
                    ProjectileKind = projectile.Kind
                });
        }

        private static bool WallComesFirst(
            WindWallSweepHit wallHit,
            ProjectileActorHit? actorHit,
            int sweepDistance)
        {
            return !actorHit.HasValue ||
                wallHit.FractionNumerator * sweepDistance <=
                (long)actorHit.Value.DistanceMm *
                wallHit.FractionDenominator;
        }

        private static bool TryGetTarget(
            SimulationState state,
            int entityId,
            out CombatTarget target)
        {
            if (state.Players.TryGetValue(entityId, out var player))
            {
                target = new CombatTarget(player);
                return true;
            }

            if (state.Monsters.TryGetValue(entityId, out var monster))
            {
                target = new CombatTarget(monster);
                return true;
            }

            if (state.Summons.TryGetValue(entityId, out var summon))
            {
                target = new CombatTarget(summon);
                return true;
            }

            target = default;
            return false;
        }
    }
}
