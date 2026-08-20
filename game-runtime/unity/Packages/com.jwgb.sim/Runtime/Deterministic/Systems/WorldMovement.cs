using System;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of resolveWorldMovement / resolveStaticSolidCollision from
    /// packages/sim/src/systems/displacement.ts. Active ability walls
    /// (ring-wall / ice-wall zones) do not exist in the deterministic slice,
    /// so resolveActiveWallMovement collapses to the identity here.
    /// </summary>
    internal static class WorldMovement
    {
        public static Int2Mm Resolve(
            SimulationState state,
            Int2Mm origin,
            Int2Mm requestedDestination,
            int radiusMm,
            WallTraversal traversal = default)
        {
            if (state.MapField != null)
            {
                return MapCollisionAdapter.ResolveMovement(
                    state.MapField,
                    origin,
                    requestedDestination,
                    radiusMm,
                    traversal);
            }

            return ResolveStaticSolidCollision(
                IntegerMath.ClampToCircle(
                    requestedDestination,
                    Math.Max(0, state.ArenaRadiusMm - radiusMm)),
                radiusMm,
                state);
        }

        public static Int2Mm ResolveStaticSolidCollision(
            Int2Mm position,
            int radiusMm,
            SimulationState state)
        {
            var resolved = position;
            for (var index = 0; index < state.StaticSolids.Count; index += 1)
            {
                var solid = state.StaticSolids[index];
                var minimumX = solid.MinimumX - radiusMm;
                var maximumX = solid.MaximumX + radiusMm;
                var minimumZ = solid.MinimumZ - radiusMm;
                var maximumZ = solid.MaximumZ + radiusMm;
                if (resolved.X < minimumX ||
                    resolved.X > maximumX ||
                    resolved.Z < minimumZ ||
                    resolved.Z > maximumZ)
                {
                    continue;
                }

                var pushLeft = Math.Abs(resolved.X - minimumX);
                var pushRight = Math.Abs(maximumX - resolved.X);
                var pushDown = Math.Abs(resolved.Z - minimumZ);
                var pushUp = Math.Abs(maximumZ - resolved.Z);
                var smallestPush = Math.Min(
                    Math.Min(pushLeft, pushRight),
                    Math.Min(pushDown, pushUp));
                if (smallestPush == pushLeft)
                {
                    resolved = new Int2Mm(minimumX, resolved.Z);
                }
                else if (smallestPush == pushRight)
                {
                    resolved = new Int2Mm(maximumX, resolved.Z);
                }
                else if (smallestPush == pushDown)
                {
                    resolved = new Int2Mm(resolved.X, minimumZ);
                }
                else
                {
                    resolved = new Int2Mm(resolved.X, maximumZ);
                }
            }

            return resolved;
        }
    }
}
