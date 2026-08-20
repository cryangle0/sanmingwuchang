namespace Jwgb.Sim.Deterministic
{
    using Jwgb.Content;

    /// <summary>
    /// Port of MapCollisionField.firstLineOfSightBlock from
    /// packages/sim/src/geometry/map-collision-field.ts. Clearance is the
    /// combined actor radius; low walls can be ignored via traversal.
    /// </summary>
    public sealed partial class MapCollisionField
    {
        public string FirstLineOfSightBlock(
            MapPointMmRecord start,
            MapPointMmRecord end,
            long clearanceMm = 0,
            WallTraversal traversal = default)
        {
            var bounds = new StaticSpatialGrid.Aabb(
                System.Math.Min(start.X, end.X) - clearanceMm,
                System.Math.Max(start.X, end.X) + clearanceMm,
                System.Math.Min(start.Z, end.Z) - clearanceMm,
                System.Math.Max(start.Z, end.Z) + clearanceMm);
            var clearanceSquared = clearanceMm * clearanceMm;
            foreach (var pieceIndex in pieceGrid.Query(bounds))
            {
                var piece = pieces[pieceIndex];
                if (!WallTraversal.Blocks(
                        piece.HeightMm,
                        piece.BlinkPassable,
                        piece.FlightPassable,
                        traversal))
                {
                    continue;
                }

                if (IntegerGeometry.ConvexContainsPoint(
                        piece.Vertices,
                        start) ||
                    IntegerGeometry.ConvexContainsPoint(
                        piece.Vertices,
                        end))
                {
                    return piece.PieceId;
                }

                for (var segmentIndex = 0;
                    segmentIndex < piece.Segments.Length;
                    segmentIndex += 1)
                {
                    var segment = piece.Segments[segmentIndex];
                    var a = segment[0];
                    var b = segment[1];
                    if (IntegerGeometry.SegmentsIntersect(
                            start,
                            end,
                            a,
                            b) ||
                        (clearanceMm > 0 &&
                         IntegerGeometry.DistanceSquaredToSegment(
                             start,
                             a,
                             b) <= clearanceSquared) ||
                        (clearanceMm > 0 &&
                         IntegerGeometry.DistanceSquaredToSegment(
                             end,
                             a,
                             b) <= clearanceSquared) ||
                        (clearanceMm > 0 &&
                         IntegerGeometry.DistanceSquaredToSegment(
                             a,
                             start,
                             end) <= clearanceSquared))
                    {
                        return piece.PieceId;
                    }
                }
            }

            return null;
        }
    }
}
