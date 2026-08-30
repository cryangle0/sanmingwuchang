using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Swept-circle wall contact half of <see cref="MapCollisionField"/>;
    /// mirrors sweepCircleFirstWallContact in map-collision-field.ts.
    /// </summary>
    public sealed partial class MapCollisionField
    {
        private bool TrySweepCircleFirstWallContactCore(
            MapPointMmRecord start,
            MapPointMmRecord end,
            long sweepDistanceMm,
            long radiusMm,
            WallTraversal traversal,
            out long contactDistanceMm,
            out string contactPieceId)
        {
            contactDistanceMm = 0;
            contactPieceId = null;
            if (sweepDistanceMm <= 0)
            {
                return false;
            }

            var candidates = pieceGrid.Query(new StaticSpatialGrid.Aabb(
                System.Math.Min(start.X, end.X) - radiusMm,
                System.Math.Max(start.X, end.X) + radiusMm,
                System.Math.Min(start.Z, end.Z) - radiusMm,
                System.Math.Max(start.Z, end.Z) + radiusMm));
            if (candidates.Count == 0)
            {
                return false;
            }

            var coarseStepMm = System.Math.Max(1, radiusMm / 2);
            long previousFreeMm = -1;
            long distanceMm = 0;
            while (true)
            {
                var hitPieceId = TestSweepSample(
                    candidates,
                    start,
                    end,
                    sweepDistanceMm,
                    distanceMm,
                    radiusMm,
                    traversal);
                if (hitPieceId != null)
                {
                    for (var fineMm = previousFreeMm + 1; fineMm < distanceMm; fineMm += 1)
                    {
                        var finePieceId = TestSweepSample(
                            candidates,
                            start,
                            end,
                            sweepDistanceMm,
                            fineMm,
                            radiusMm,
                            traversal);
                        if (finePieceId != null)
                        {
                            contactDistanceMm = fineMm;
                            contactPieceId = finePieceId;
                            return true;
                        }
                    }

                    contactDistanceMm = distanceMm;
                    contactPieceId = hitPieceId;
                    return true;
                }

                previousFreeMm = distanceMm;
                if (distanceMm == sweepDistanceMm)
                {
                    return false;
                }

                distanceMm = System.Math.Min(distanceMm + coarseStepMm, sweepDistanceMm);
            }
        }

        private string TestSweepSample(
            List<int> candidates,
            MapPointMmRecord start,
            MapPointMmRecord end,
            long sweepDistanceMm,
            long distanceMm,
            long radiusMm,
            WallTraversal traversal)
        {
            var sample = new MapPointMmRecord(
                start.X + (((end.X - start.X) * distanceMm) / sweepDistanceMm),
                start.Z + (((end.Z - start.Z) * distanceMm) / sweepDistanceMm));
            var radiusSquared = radiusMm * radiusMm;
            foreach (var pieceIndex in candidates)
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

                if (IntegerGeometry.ConvexContainsPoint(piece.Vertices, sample))
                {
                    return piece.PieceId;
                }

                foreach (var segment in piece.Segments)
                {
                    var closest = IntegerGeometry.ClosestPointOnSegment(
                        segment[0],
                        segment[1],
                        sample);
                    if (IntegerGeometry.DistanceSquaredBetween(closest, sample)
                        <= radiusSquared)
                    {
                        return piece.PieceId;
                    }
                }
            }

            return null;
        }
    }
}
