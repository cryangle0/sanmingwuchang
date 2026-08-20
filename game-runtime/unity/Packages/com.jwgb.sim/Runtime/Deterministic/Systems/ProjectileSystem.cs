using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class ProjectileSystem
    {
        public static ProjectileState Launch(
            SimulationState state,
            PlayerState owner,
            CombatTarget target,
            BasicProjectileDefinition definition,
            BasicAttackSnapshot attack,
            int maxTravelDistanceMm)
        {
            var projectile = new ProjectileState
            {
                EntityId = state.NextEntityId,
                OwnerEntityId = owner.EntityId,
                TargetEntityId = target.EntityId,
                Position = owner.Position,
                SpeedMmPerSecond = definition.SpeedMmPerSecond,
                CollisionRadiusMm = definition.CollisionRadiusMm,
                SourceElement = attack.SourceElement,
                BaseDamage = attack.BaseDamage,
                OutgoingDamageBasisPoints =
                    attack.OutgoingDamageBasisPoints,
                CreatedAtTick = state.Tick,
                RemainingTravelMm = maxTravelDistanceMm
            };
            state.NextEntityId += 1;
            state.Projectiles.Add(projectile.EntityId, projectile);
            return projectile;
        }

        public static ProjectileState LaunchColdArrow(
            SimulationState state,
            PlayerState owner,
            CombatTarget target,
            int baseDamage,
            int maxTravelDistanceMm)
        {
            var projectile = new ProjectileState
            {
                EntityId = state.NextEntityId,
                Kind = "cold-arrow",
                OwnerEntityId = owner.EntityId,
                TargetEntityId = target.EntityId,
                Position = owner.Position,
                SpeedMmPerSecond = 55_000,
                CollisionRadiusMm = 120,
                SourceElement = owner.Element,
                BaseDamage = baseDamage,
                OutgoingDamageBasisPoints = 10_000,
                CreatedAtTick = state.Tick,
                RemainingTravelMm = maxTravelDistanceMm
            };
            state.NextEntityId += 1;
            state.Projectiles.Add(projectile.EntityId, projectile);
            return projectile;
        }

        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            var projectiles = new List<ProjectileState>(
                state.Projectiles.Values);
            for (var index = 0; index < projectiles.Count; index += 1)
            {
                var projectile = projectiles[index];
                if (!state.Projectiles.ContainsKey(projectile.EntityId) ||
                    projectile.CreatedAtTick >= state.Tick)
                {
                    continue;
                }

                if (!TryGetTarget(
                        state,
                        projectile.TargetEntityId,
                        out var target) ||
                    !target.IsAlive ||
                    projectile.RemainingTravelMm <= 0)
                {
                    state.Projectiles.Remove(projectile.EntityId);
                    continue;
                }

                AdvanceProjectile(
                    state,
                    events,
                    projectile,
                    target);
            }
        }

        private static void AdvanceProjectile(
            SimulationState state,
            List<SimEvent> events,
            ProjectileState projectile,
            CombatTarget target)
        {
            var movementNumerator =
                projectile.SpeedMmPerSecond +
                projectile.MovementRemainder;
            var fullStep =
                movementNumerator /
                SimulationConstants.TicksPerSecond;
            projectile.MovementRemainder =
                movementNumerator -
                fullStep * SimulationConstants.TicksPerSecond;
            var sweepDistance = Math.Min(
                fullStep,
                projectile.RemainingTravelMm);
            if (sweepDistance <= 0)
            {
                return;
            }

            var start = projectile.Position;
            var end = IntegerMath.MoveToward(
                start,
                target.Position,
                sweepDistance);
            var actorHit = ProjectileSweepGeometry.FindFirstActorHit(
                state,
                projectile,
                start,
                end,
                sweepDistance);
            var wallHit = WindWallSystem.FindFirstBlocking(
                state,
                start,
                end,
                projectile.CollisionRadiusMm);
            long mapDistance = 0;
            string mapPieceId = null;
            var mapHit = state.MapField != null &&
                state.MapField.TrySweepCircleFirstWallContact(
                    MapCollisionAdapter.ToMapPoint(start),
                    MapCollisionAdapter.ToMapPoint(end),
                    sweepDistance,
                    projectile.CollisionRadiusMm,
                    out mapDistance,
                    out mapPieceId);
            var windBlocks = wallHit.HasValue &&
                WallComesFirst(
                    wallHit.Value,
                    actorHit,
                    sweepDistance);
            var mapBlocks = mapHit &&
                (!actorHit.HasValue ||
                 mapDistance <= actorHit.Value.DistanceMm);
            if (windBlocks || mapBlocks)
            {
                var windFirst = windBlocks &&
                    (!mapBlocks ||
                     wallHit.Value.FractionNumerator *
                     sweepDistance <=
                     mapDistance *
                     wallHit.Value.FractionDenominator);
                if (windFirst)
                {
                    BlockProjectile(
                        state,
                        events,
                        projectile,
                        wallHit.Value);
                }
                else
                {
                    BlockProjectileByMap(
                        state,
                        events,
                        projectile,
                        mapPieceId);
                }
                return;
            }

            if (actorHit.HasValue)
            {
                projectile.Position =
                    ProjectileSweepGeometry.PointAlongSweep(
                        start,
                        end,
                        actorHit.Value.DistanceMm,
                        sweepDistance);
                ResolveHit(
                    state,
                    events,
                    projectile,
                    actorHit.Value.Target);
                return;
            }

            projectile.Position = end;
            projectile.RemainingTravelMm -= sweepDistance;
            if (projectile.RemainingTravelMm <= 0)
            {
                state.Projectiles.Remove(projectile.EntityId);
            }
        }

    }
}
