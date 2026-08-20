using System;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class BlinkSystem
    {
        private static int BoundaryLimitedDistance(
            MapCollisionField field,
            Int2Mm origin,
            Int2Mm direction,
            int requestedDistance)
        {
            for (var distance = 0;
                distance <= requestedDistance;
                distance += 1)
            {
                var sample = PositionAtDistance(
                    origin,
                    direction,
                    distance);
                if (!field.IsCircleInsideBoundary(
                    MapCollisionAdapter.ToMapPoint(sample),
                    GameplayRules.PlayerCapsuleRadiusMm))
                {
                    return Math.Max(0, distance - 1);
                }
            }

            return requestedDistance;
        }

        /// <summary>
        /// Map mode twin of FirstBlockingSolid over convex wall pieces.
        ///
        /// 可越障级 (VAULT) walls are transparent to blink per the map source, so
        /// only 封界级 (BOUND) walls and the playfield boundary can stop a blink.
        /// The continuous-chord rule still applies to the walls that do block.
        /// </summary>
        private static BlockingSolid? FirstBlockingPiece(
            MapCollisionField field,
            Int2Mm origin,
            Int2Mm direction,
            int requestedDistance,
            int maximumChord)
        {
            int? entryDistance = null;
            string entryPieceId = null;
            for (var distance = 0;
                distance <= requestedDistance;
                distance += 1)
            {
                var pieceId = field.FirstWallPieceAt(
                    MapCollisionAdapter.ToMapPoint(
                        PositionAtDistance(
                            origin,
                            direction,
                            distance)),
                    GameplayRules.PlayerCapsuleRadiusMm,
                    WallTraversal.Blink);
                if (pieceId == null)
                {
                    entryDistance = null;
                    entryPieceId = null;
                    continue;
                }

                if (!entryDistance.HasValue)
                {
                    entryDistance = distance;
                    entryPieceId = pieceId;
                }

                if (distance - entryDistance.Value > maximumChord ||
                    distance == requestedDistance)
                {
                    return new BlockingSolid(
                        entryPieceId ?? pieceId,
                        entryDistance.Value);
                }
            }

            return null;
        }

        /// <summary>
        /// Blink may cross a 可越障级 wall but may never end inside one, so the
        /// landing millimeter is validated against ordinary standing collision
        /// and walked back along the ray until it is legal. Open-ground blinks
        /// cost a single query.
        /// </summary>
        private static int LastLandableDistance(
            MapCollisionField field,
            Int2Mm origin,
            Int2Mm direction,
            int distance)
        {
            for (var candidate = distance; candidate > 0; candidate -= 1)
            {
                var sample = PositionAtDistance(
                    origin,
                    direction,
                    candidate);
                if (!field.IsCircleBlocked(
                    MapCollisionAdapter.ToMapPoint(sample),
                    GameplayRules.PlayerCapsuleRadiusMm))
                {
                    return candidate;
                }
            }

            return 0;
        }
    }
}
