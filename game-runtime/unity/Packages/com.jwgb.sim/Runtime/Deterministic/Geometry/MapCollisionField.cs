using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Authoritative collision field for the compiled 840m map. Mirrors
    /// packages/sim/src/geometry/map-collision-field.ts query by query so
    /// TypeScript and C# resolve identical results for identical inputs.
    ///
    /// Every wall query takes a <see cref="WallTraversal"/>; omitting it walks,
    /// because <c>default(WallTraversal)</c> is <see cref="WallTraversal.Walk"/>.
    /// </summary>
    public sealed partial class MapCollisionField
    {
        private readonly MapPointMmRecord[] boundary;
        private readonly IndexedPiece[] pieces;
        private readonly BoundarySegment[] boundarySegments;
        private readonly StaticSpatialGrid pieceGrid;
        private readonly StaticSpatialGrid boundaryGrid;

        public string GeometryHash { get; }

        /// <summary>
        /// True when the circle touches an impassable wall piece or leaves the
        /// playfield.
        /// </summary>
        public bool IsCircleBlocked(
            MapPointMmRecord center,
            long radiusMm,
            WallTraversal traversal = default)
        {
            return !IsCircleInsideBoundary(center, radiusMm)
                || CircleTouchesWall(center, radiusMm, traversal);
        }

        public bool CircleTouchesWall(
            MapPointMmRecord center,
            long radiusMm,
            WallTraversal traversal = default)
        {
            return FirstWallPieceAt(center, radiusMm, traversal) != null;
        }

        /// <summary>Stable lowest-index wall piece the circle touches, or null.</summary>
        public string FirstWallPieceAt(
            MapPointMmRecord center,
            long radiusMm,
            WallTraversal traversal = default)
        {
            var radiusSquared = radiusMm * radiusMm;
            foreach (var pieceIndex in pieceGrid.Query(PointBounds(center, radiusMm)))
            {
                var piece = pieces[pieceIndex];
                if (!WallTraversal.Blocks(
                    piece.WallClass,
                    piece.HeightMm,
                    piece.BlinkPassable,
                    piece.FlightPassable,
                    traversal))
                {
                    continue;
                }

                if (IntegerGeometry.ConvexContainsPoint(piece.Vertices, center))
                {
                    return piece.PieceId;
                }

                foreach (var segment in piece.Segments)
                {
                    var closest = IntegerGeometry.ClosestPointOnSegment(
                        segment[0],
                        segment[1],
                        center);
                    if (IntegerGeometry.DistanceSquaredBetween(closest, center)
                        <= radiusSquared)
                    {
                        return piece.PieceId;
                    }
                }
            }

            return null;
        }

        public bool IsCircleInsideBoundary(MapPointMmRecord center, long radiusMm)
        {
            if (!IntegerGeometry.RingContainsPoint(boundary, center))
            {
                return false;
            }

            var radiusSquared = radiusMm * radiusMm;
            foreach (var segmentIndex in boundaryGrid.Query(PointBounds(center, radiusMm)))
            {
                var segment = boundarySegments[segmentIndex];
                var closest = IntegerGeometry.ClosestPointOnSegment(
                    segment.A,
                    segment.B,
                    center);
                if (IntegerGeometry.DistanceSquaredBetween(closest, center) < radiusSquared)
                {
                    return false;
                }
            }

            return true;
        }

        /// <summary>
        /// Rejection-based sliding: try the full move, then each axis, else stay.
        /// </summary>
        public MapPointMmRecord ResolveMovement(
            MapPointMmRecord from,
            MapPointMmRecord to,
            long radiusMm,
            WallTraversal traversal = default)
        {
            if (!IsCircleBlocked(to, radiusMm, traversal))
            {
                return to;
            }

            var slideX = new MapPointMmRecord(to.X, from.Z);
            if (slideX.X != from.X && !IsCircleBlocked(slideX, radiusMm, traversal))
            {
                return slideX;
            }

            var slideZ = new MapPointMmRecord(from.X, to.Z);
            if (slideZ.Z != from.Z && !IsCircleBlocked(slideZ, radiusMm, traversal))
            {
                return slideZ;
            }

            return from;
        }

        /// <summary>Step-scan used by forced displacement; returns the last legal sample.</summary>
        public MapPointMmRecord ResolveDisplacementPath(
            MapPointMmRecord origin,
            MapPointMmRecord destination,
            long radiusMm,
            WallTraversal traversal = default)
        {
            var deltaX = destination.X - origin.X;
            var deltaZ = destination.Z - origin.Z;
            var steps = System.Math.Max(System.Math.Abs(deltaX), System.Math.Abs(deltaZ));
            if (steps == 0)
            {
                return origin;
            }

            var lastLegal = origin;
            for (long step = 1; step <= steps; step += 1)
            {
                var candidate = new MapPointMmRecord(
                    origin.X + ((deltaX * step) / steps),
                    origin.Z + ((deltaZ * step) / steps));
                if (IsCircleBlocked(candidate, radiusMm, traversal))
                {
                    return lastLegal;
                }

                lastLegal = candidate;
            }

            return lastLegal;
        }

        public bool TrySweepCircleFirstWallContact(
            MapPointMmRecord start,
            MapPointMmRecord end,
            long sweepDistanceMm,
            long radiusMm,
            out long contactDistanceMm,
            out string contactPieceId)
        {
            return TrySweepCircleFirstWallContact(
                start,
                end,
                sweepDistanceMm,
                radiusMm,
                WallTraversal.Walk,
                out contactDistanceMm,
                out contactPieceId);
        }

        public bool TrySweepCircleFirstWallContact(
            MapPointMmRecord start,
            MapPointMmRecord end,
            long sweepDistanceMm,
            long radiusMm,
            WallTraversal traversal,
            out long contactDistanceMm,
            out string contactPieceId)
        {
            return TrySweepCircleFirstWallContactCore(
                start,
                end,
                sweepDistanceMm,
                radiusMm,
                traversal,
                out contactDistanceMm,
                out contactPieceId);
        }
    }
}
