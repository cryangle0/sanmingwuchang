using System;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class DisplacementSystem
    {
        public static Int2Mm ResolveForced(
            SimulationState state,
            Int2Mm origin,
            Int2Mm requested,
            int radiusMm)
        {
            if (state.MapField != null)
            {
                // Forced displacement never inherits the victim's flight, so it
                // walks; mirrors resolveForcedDisplacement in displacement.ts.
                return MapCollisionAdapter.ResolveDisplacement(
                    state.MapField,
                    origin,
                    requested,
                    radiusMm,
                    WallTraversal.Walk);
            }

            var destination = IntegerMath.ClampToCircle(
                requested,
                Math.Max(0, state.ArenaRadiusMm - radiusMm));
            var deltaX = destination.X - origin.X;
            var deltaZ = destination.Z - origin.Z;
            var steps = Math.Max(Math.Abs(deltaX), Math.Abs(deltaZ));
            if (steps == 0)
            {
                return origin;
            }

            var lastLegal = origin;
            for (var step = 1; step <= steps; step += 1)
            {
                var candidate = new Int2Mm(
                    origin.X + deltaX * step / steps,
                    origin.Z + deltaZ * step / steps);
                if (IsBlocked(
                        candidate,
                        radiusMm,
                        state))
                {
                    return lastLegal;
                }

                lastLegal = candidate;
            }

            return lastLegal;
        }

        private static bool IsBlocked(
            Int2Mm position,
            int radiusMm,
            SimulationState state)
        {
            foreach (var solid in state.StaticSolids)
            {
                if (position.X >= solid.MinimumX - radiusMm &&
                    position.X <= solid.MaximumX + radiusMm &&
                    position.Z >= solid.MinimumZ - radiusMm &&
                    position.Z <= solid.MaximumZ + radiusMm)
                {
                    return true;
                }
            }

            return false;
        }
    }
}
