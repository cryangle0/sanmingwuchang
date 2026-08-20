using System;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal readonly struct ProjectileActorHit
    {
        public ProjectileActorHit(CombatTarget target, int distanceMm)
        {
            Target = target;
            DistanceMm = distanceMm;
        }

        public CombatTarget Target { get; }
        public int DistanceMm { get; }
    }

    internal static class ProjectileSweepGeometry
    {
        public static ProjectileActorHit? FindFirstActorHit(
            SimulationState state,
            ProjectileState projectile,
            Int2Mm start,
            Int2Mm end,
            int sweepDistance)
        {
            ProjectileActorHit? best = null;
            foreach (var player in state.Players.Values)
            {
                if (player.EntityId == projectile.OwnerEntityId ||
                    player.LifeState != LifeState.Alive)
                {
                    continue;
                }

                var contactDistance = FirstCircleContactDistance(
                    start,
                    end,
                    sweepDistance,
                    player.Position,
                    projectile.CollisionRadiusMm +
                    GameplayRadius.Player);
                if (!contactDistance.HasValue)
                {
                    continue;
                }

                var hit = new ProjectileActorHit(
                    new CombatTarget(player),
                    contactDistance.Value);
                if (!best.HasValue ||
                    hit.DistanceMm < best.Value.DistanceMm ||
                    (hit.DistanceMm == best.Value.DistanceMm &&
                     hit.Target.EntityId < best.Value.Target.EntityId))
                {
                    best = hit;
                }
            }

            foreach (var monster in state.Monsters.Values)
            {
                if (monster.EntityId == projectile.OwnerEntityId ||
                    monster.Hp <= 0 ||
                    monster.InvulnerableTicks > 0)
                {
                    continue;
                }

                var contactDistance = FirstCircleContactDistance(
                    start,
                    end,
                    sweepDistance,
                    monster.Position,
                    projectile.CollisionRadiusMm +
                    monster.CollisionRadiusMm);
                if (!contactDistance.HasValue)
                {
                    continue;
                }

                var hit = new ProjectileActorHit(
                    new CombatTarget(monster),
                    contactDistance.Value);
                if (!best.HasValue ||
                    hit.DistanceMm < best.Value.DistanceMm ||
                    (hit.DistanceMm == best.Value.DistanceMm &&
                     hit.Target.EntityId < best.Value.Target.EntityId))
                {
                    best = hit;
                }
            }

            foreach (var summon in state.Summons.Values)
            {
                if (!summon.Targetable ||
                    summon.Hp <= 0 ||
                    summon.OwnerEntityId == projectile.OwnerEntityId)
                {
                    continue;
                }

                var contactDistance = FirstCircleContactDistance(
                    start,
                    end,
                    sweepDistance,
                    summon.Position,
                    projectile.CollisionRadiusMm +
                    GameplayRadius.Summon);
                if (!contactDistance.HasValue)
                {
                    continue;
                }

                var hit = new ProjectileActorHit(
                    new CombatTarget(summon),
                    contactDistance.Value);
                if (!best.HasValue ||
                    hit.DistanceMm < best.Value.DistanceMm ||
                    (hit.DistanceMm == best.Value.DistanceMm &&
                     hit.Target.EntityId < best.Value.Target.EntityId))
                {
                    best = hit;
                }
            }

            return best;
        }

        public static Int2Mm PointAlongSweep(
            Int2Mm start,
            Int2Mm end,
            int distance,
            int sweepDistance)
        {
            if (distance <= 0 || sweepDistance <= 0)
            {
                return start;
            }

            if (distance >= sweepDistance)
            {
                return end;
            }

            return new Int2Mm(
                checked(
                    start.X +
                    (int)((long)(end.X - start.X) *
                        distance /
                        sweepDistance)),
                checked(
                    start.Z +
                    (int)((long)(end.Z - start.Z) *
                        distance /
                        sweepDistance)));
        }

        private static int? FirstCircleContactDistance(
            Int2Mm start,
            Int2Mm end,
            int sweepDistance,
            Int2Mm center,
            int combinedRadius)
        {
            var radiusSquared = (long)combinedRadius * combinedRadius;
            if (IntegerMath.DistanceSquared(start, center) <= radiusSquared)
            {
                return 0;
            }

            var deltaX = (long)end.X - start.X;
            var deltaZ = (long)end.Z - start.Z;
            var segmentLengthSquared =
                (deltaX * deltaX) + (deltaZ * deltaZ);
            if (segmentLengthSquared == 0)
            {
                return null;
            }

            var centerDeltaX = (long)center.X - start.X;
            var centerDeltaZ = (long)center.Z - start.Z;
            var projection = Math.Max(
                0,
                Math.Min(
                    segmentLengthSquared,
                    (centerDeltaX * deltaX) +
                    (centerDeltaZ * deltaZ)));
            var closest = checked(
                (int)((long)sweepDistance *
                    projection /
                    segmentLengthSquared));
            var inside = FindNearbyInsideDistance(
                start,
                end,
                center,
                radiusSquared,
                sweepDistance,
                closest);
            if (!inside.HasValue)
            {
                return null;
            }

            var outside = 0;
            while (inside.Value - outside > 1)
            {
                var candidateDistance =
                    (outside + inside.Value) / 2;
                var candidate = PointAlongSweep(
                    start,
                    end,
                    candidateDistance,
                    sweepDistance);
                if (IntegerMath.DistanceSquared(candidate, center) <=
                    radiusSquared)
                {
                    inside = candidateDistance;
                }
                else
                {
                    outside = candidateDistance;
                }
            }

            return inside.Value;
        }

        private static int? FindNearbyInsideDistance(
            Int2Mm start,
            Int2Mm end,
            Int2Mm center,
            long radiusSquared,
            int sweepDistance,
            int closest)
        {
            int? inside = null;
            for (var offset = -2; offset <= 2; offset += 1)
            {
                var candidateDistance = Math.Max(
                    0,
                    Math.Min(sweepDistance, closest + offset));
                var candidate = PointAlongSweep(
                    start,
                    end,
                    candidateDistance,
                    sweepDistance);
                if (IntegerMath.DistanceSquared(candidate, center) <=
                    radiusSquared)
                {
                    inside = !inside.HasValue
                        ? candidateDistance
                        : Math.Min(inside.Value, candidateDistance);
                }
            }

            return inside;
        }
    }
}
