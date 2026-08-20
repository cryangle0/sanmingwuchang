using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    public sealed partial class MapCollisionField
    {
        private const long GridCellMm = 16_384;

        private readonly struct IndexedPiece
        {
            public IndexedPiece(
                string pieceId,
                long heightMm,
                bool blinkPassable,
                bool flightPassable,
                MapPointMmRecord[] vertices,
                MapPointMmRecord[][] segments)
            {
                PieceId = pieceId;
                HeightMm = heightMm;
                BlinkPassable = blinkPassable;
                FlightPassable = flightPassable;
                Vertices = vertices;
                Segments = segments;
            }

            public string PieceId { get; }
            public long HeightMm { get; }

            /// <summary>
            /// Traversal permissions transcribed from the map source by
            /// tools/map/compile-map-geometry.ts, never inferred from height.
            /// </summary>
            public bool BlinkPassable { get; }
            public bool FlightPassable { get; }
            public MapPointMmRecord[] Vertices { get; }
            public MapPointMmRecord[][] Segments { get; }
        }

        private readonly struct BoundarySegment
        {
            public BoundarySegment(MapPointMmRecord a, MapPointMmRecord b)
            {
                A = a;
                B = b;
            }

            public MapPointMmRecord A { get; }
            public MapPointMmRecord B { get; }
        }

        public MapCollisionField(
            string geometryHash,
            MapPointMmRecord[] boundaryRing,
            MapConvexPieceGeometryRecord[] wallPieces)
        {
            GeometryHash = geometryHash;
            boundary = boundaryRing;
            pieces = BuildPieces(wallPieces);
            boundarySegments = BuildBoundarySegments(boundary);

            var world = Inflate(BoundsOf(boundary), GridCellMm);
            pieceGrid = new StaticSpatialGrid(
                world,
                GridCellMm,
                BuildPieceBounds(pieces));
            boundaryGrid = new StaticSpatialGrid(
                world,
                GridCellMm,
                BuildBoundaryBounds(boundarySegments));
        }

        private static IndexedPiece[] BuildPieces(
            MapConvexPieceGeometryRecord[] wallPieces)
        {
            var result = new IndexedPiece[wallPieces.Length];
            for (var index = 0; index < wallPieces.Length; index += 1)
            {
                var record = wallPieces[index];
                result[index] = new IndexedPiece(
                    record.PieceId,
                    record.HeightMm,
                    record.BlinkPassable,
                    record.FlightPassable,
                    record.Vertices,
                    SubdivideRing(record.Vertices));
            }

            return result;
        }

        private static BoundarySegment[] BuildBoundarySegments(
            MapPointMmRecord[] ring)
        {
            var segments = new List<BoundarySegment>();
            for (var index = 0; index < ring.Length; index += 1)
            {
                AppendSubdivided(
                    segments,
                    ring[index],
                    ring[(index + 1) % ring.Length]);
            }

            return segments.ToArray();
        }

        private static StaticSpatialGrid.Aabb[] BuildPieceBounds(
            IndexedPiece[] indexedPieces)
        {
            var result = new StaticSpatialGrid.Aabb[indexedPieces.Length];
            for (var index = 0; index < indexedPieces.Length; index += 1)
            {
                result[index] = BoundsOf(indexedPieces[index].Vertices);
            }

            return result;
        }

        private static StaticSpatialGrid.Aabb[] BuildBoundaryBounds(
            BoundarySegment[] segments)
        {
            var result = new StaticSpatialGrid.Aabb[segments.Length];
            for (var index = 0; index < segments.Length; index += 1)
            {
                result[index] = BoundsOfSegment(segments[index]);
            }

            return result;
        }

        private static MapPointMmRecord[][] SubdivideRing(
            MapPointMmRecord[] vertices)
        {
            var segments = new List<MapPointMmRecord[]>();
            for (var index = 0; index < vertices.Length; index += 1)
            {
                var a = vertices[index];
                var b = vertices[(index + 1) % vertices.Length];
                var chunkCount = IntegerGeometry.SubdivideChunkCount(
                    a,
                    b,
                    IntegerGeometry.MaxSegmentLengthMm);
                var previous = a;
                for (var chunk = 1; chunk <= chunkCount; chunk += 1)
                {
                    var next = IntegerGeometry.SubdividePoint(
                        a,
                        b,
                        chunk,
                        chunkCount);
                    segments.Add(new[] { previous, next });
                    previous = next;
                }
            }

            return segments.ToArray();
        }

        private static void AppendSubdivided(
            List<BoundarySegment> target,
            MapPointMmRecord a,
            MapPointMmRecord b)
        {
            var chunkCount = IntegerGeometry.SubdivideChunkCount(
                a,
                b,
                IntegerGeometry.MaxSegmentLengthMm);
            var previous = a;
            for (var chunk = 1; chunk <= chunkCount; chunk += 1)
            {
                var next = IntegerGeometry.SubdividePoint(
                    a,
                    b,
                    chunk,
                    chunkCount);
                target.Add(new BoundarySegment(previous, next));
                previous = next;
            }
        }

        private static StaticSpatialGrid.Aabb BoundsOf(
            MapPointMmRecord[] points)
        {
            long minimumX = long.MaxValue;
            long maximumX = long.MinValue;
            long minimumZ = long.MaxValue;
            long maximumZ = long.MinValue;
            foreach (var point in points)
            {
                minimumX = System.Math.Min(minimumX, point.X);
                maximumX = System.Math.Max(maximumX, point.X);
                minimumZ = System.Math.Min(minimumZ, point.Z);
                maximumZ = System.Math.Max(maximumZ, point.Z);
            }

            return new StaticSpatialGrid.Aabb(
                minimumX,
                maximumX,
                minimumZ,
                maximumZ);
        }

        private static StaticSpatialGrid.Aabb BoundsOfSegment(
            BoundarySegment segment)
        {
            return new StaticSpatialGrid.Aabb(
                System.Math.Min(segment.A.X, segment.B.X),
                System.Math.Max(segment.A.X, segment.B.X),
                System.Math.Min(segment.A.Z, segment.B.Z),
                System.Math.Max(segment.A.Z, segment.B.Z));
        }

        private static StaticSpatialGrid.Aabb Inflate(
            StaticSpatialGrid.Aabb aabb,
            long byMm)
        {
            return new StaticSpatialGrid.Aabb(
                aabb.MinimumX - byMm,
                aabb.MaximumX + byMm,
                aabb.MinimumZ - byMm,
                aabb.MaximumZ + byMm);
        }

        private static StaticSpatialGrid.Aabb PointBounds(
            MapPointMmRecord point,
            long radiusMm)
        {
            return new StaticSpatialGrid.Aabb(
                point.X - radiusMm,
                point.X + radiusMm,
                point.Z - radiusMm,
                point.Z + radiusMm);
        }
    }
}
