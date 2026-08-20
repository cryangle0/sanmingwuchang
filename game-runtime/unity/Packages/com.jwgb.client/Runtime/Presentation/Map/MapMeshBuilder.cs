using System.Collections.Generic;
using Jwgb.Content;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Builds the runtime greybox for the 840m map from the compiled
    /// MapGeometryCatalog. Pure mesh construction: deterministic vertex
    /// and triangle counts for a given catalog, no scene access, no
    /// simulation access. Mirrors the extruded-prism approach of the web
    /// renderer (apps/web/src/render/map/prism-geometry.ts).
    ///
    /// Horizontal surfaces are single-sided with enforced upward
    /// winding; vertical or sloped faces duplicate vertices for the
    /// back face so RecalculateNormals produces valid lighting (shared
    /// reversed triangles would average per-vertex normals to zero).
    /// </summary>
    public static class MapMeshBuilder
    {
        private const float MmToMeters = 1f / 1_000f;
        private const float BeyondHeight = 0.02f;
        private const float BeyondHalfSize = 840f;
        private const float GroundHeight = 0.06f;
        private const float CourtHeight = 0.10f;
        private const float RoadHeight = 0.12f;
        private const float SpawnPadHeight = 0.16f;
        private const float SpawnPadHalfSize = 0.9f;
        private const float RampHalfWidthMeters = 2.4f;
        private const float RockHeightMeters = 2.0f;
        private const int RockSegments = 8;

        public static MapEnvironmentMeshSet Build()
        {
            return new MapEnvironmentMeshSet
            {
                Beyond = BuildBeyond(),
                Ground = BuildGround(),
                Roads = BuildRoads(),
                Courts = BuildCourts(),
                Walls = BuildWalls(),
                Highlands = BuildHighlands(),
                SpawnPads = BuildSpawnPads()
            };
        }

        private static Mesh BuildBeyond()
        {
            var accumulator = new MeshAccumulator("MapBeyond");
            accumulator.AddFlatSquare(
                new Vector3(0f, BeyondHeight, 0f),
                BeyondHalfSize);
            return accumulator.ToMesh();
        }

        private static Mesh BuildGround()
        {
            var accumulator = new MeshAccumulator("MapGround");
            var boundary = MapGeometryCatalog.Boundary;
            var baseIndex = accumulator.VertexCount;
            for (var index = 0; index < boundary.Length; index += 1)
            {
                accumulator.AddVertex(
                    ToWorld(boundary[index], GroundHeight));
            }
            var triangles = MapGeometryCatalog.BoundaryTriangles;
            for (var index = 0; index < triangles.Length; index += 3)
            {
                accumulator.AddTriangleUpward(
                    baseIndex + triangles[index],
                    baseIndex + triangles[index + 1],
                    baseIndex + triangles[index + 2]);
            }
            return accumulator.ToMesh();
        }

        private static Mesh BuildRoads()
        {
            var accumulator = new MeshAccumulator("MapRoads");
            var nodePositions =
                new Dictionary<string, Vector3>(
                    MapGeometryCatalog.RouteNodes.Length);
            for (var index = 0;
                index < MapGeometryCatalog.RouteNodes.Length;
                index += 1)
            {
                var node = MapGeometryCatalog.RouteNodes[index];
                nodePositions[node.Id] =
                    ToWorld(node.Position, RoadHeight);
            }

            for (var index = 0;
                index < MapGeometryCatalog.RouteEdges.Length;
                index += 1)
            {
                var edge = MapGeometryCatalog.RouteEdges[index];
                if (!nodePositions.TryGetValue(edge.A, out var start) ||
                    !nodePositions.TryGetValue(edge.B, out var end))
                {
                    continue;
                }
                accumulator.AddFlatStrip(
                    start,
                    end,
                    edge.WidthMm * MmToMeters * 0.5f);
            }
            return accumulator.ToMesh();
        }

        private static Mesh BuildCourts()
        {
            var accumulator = new MeshAccumulator("MapCourts");
            for (var index = 0;
                index < MapGeometryCatalog.Courts.Length;
                index += 1)
            {
                var court = MapGeometryCatalog.Courts[index];
                accumulator.AddFlatPolygonFan(
                    court.HexVertices,
                    CourtHeight);
            }
            return accumulator.ToMesh();
        }

        private static Mesh BuildWalls()
        {
            var accumulator = new MeshAccumulator("MapWalls");
            for (var index = 0;
                index < MapGeometryCatalog.WallPieces.Length;
                index += 1)
            {
                var piece = MapGeometryCatalog.WallPieces[index];
                if (piece.Vertices == null ||
                    piece.Vertices.Length < 3)
                {
                    continue;
                }
                accumulator.AddPrism(
                    piece.Vertices,
                    piece.HeightMm * MmToMeters);
            }

            for (var index = 0;
                index < MapGeometryCatalog.Rocks.Length;
                index += 1)
            {
                var rock = MapGeometryCatalog.Rocks[index];
                accumulator.AddCylinderPrism(
                    ToWorld(rock.Position, 0f),
                    rock.RadiusMm * MmToMeters,
                    RockHeightMeters,
                    RockSegments);
            }
            return accumulator.ToMesh();
        }

        private static Mesh BuildHighlands()
        {
            var accumulator = new MeshAccumulator("MapHighlands");
            for (var index = 0;
                index < MapGeometryCatalog.Highlands.Length;
                index += 1)
            {
                var highland = MapGeometryCatalog.Highlands[index];
                var topHeight = highland.TopHeightMm * MmToMeters;
                accumulator.AddPrism(highland.Vertices, topHeight);
                for (var rampIndex = 0;
                    rampIndex < highland.Ramps.Length;
                    rampIndex += 1)
                {
                    var ramp = highland.Ramps[rampIndex];
                    accumulator.AddSlopedStrip(
                        ToWorld(ramp.A, topHeight),
                        ToWorld(ramp.B, 0f),
                        RampHalfWidthMeters);
                }
            }
            return accumulator.ToMesh();
        }

        private static Mesh BuildSpawnPads()
        {
            var accumulator = new MeshAccumulator("MapSpawnPads");
            for (var index = 0;
                index < MapGeometryCatalog.SpawnPoints.Length;
                index += 1)
            {
                var spawn = MapGeometryCatalog.SpawnPoints[index];
                accumulator.AddFlatSquare(
                    ToWorld(spawn.Position, SpawnPadHeight),
                    SpawnPadHalfSize);
            }
            return accumulator.ToMesh();
        }

        private static Vector3 ToWorld(
            MapPointMmRecord point,
            float height)
        {
            return new Vector3(
                point.X * MmToMeters,
                height,
                point.Z * MmToMeters);
        }

        private sealed class MeshAccumulator
        {
            private readonly string meshName;
            private readonly List<Vector3> vertices =
                new List<Vector3>();
            private readonly List<int> triangles = new List<int>();

            public MeshAccumulator(string name)
            {
                meshName = name;
            }

            public int VertexCount => vertices.Count;

            public void AddVertex(Vector3 vertex)
            {
                vertices.Add(vertex);
            }

            /// <summary>
            /// Adds a single-sided triangle whose front face points up
            /// regardless of the source winding order.
            /// </summary>
            public void AddTriangleUpward(int a, int b, int c)
            {
                var normal = Vector3.Cross(
                    vertices[b] - vertices[a],
                    vertices[c] - vertices[a]);
                triangles.Add(a);
                if (normal.y >= 0f)
                {
                    triangles.Add(b);
                    triangles.Add(c);
                }
                else
                {
                    triangles.Add(c);
                    triangles.Add(b);
                }
            }

            /// <summary>
            /// Adds both faces of a triangle. The back face duplicates
            /// the vertices so per-vertex normals stay valid instead of
            /// cancelling to zero.
            /// </summary>
            public void AddTriangleDoubleSided(int a, int b, int c)
            {
                triangles.Add(a);
                triangles.Add(b);
                triangles.Add(c);
                var backIndex = vertices.Count;
                vertices.Add(vertices[a]);
                vertices.Add(vertices[b]);
                vertices.Add(vertices[c]);
                triangles.Add(backIndex);
                triangles.Add(backIndex + 2);
                triangles.Add(backIndex + 1);
            }

            public void AddFlatPolygonFan(
                MapPointMmRecord[] polygon,
                float height)
            {
                var baseIndex = vertices.Count;
                for (var index = 0; index < polygon.Length; index += 1)
                {
                    vertices.Add(ToWorld(polygon[index], height));
                }
                for (var index = 1;
                    index < polygon.Length - 1;
                    index += 1)
                {
                    AddTriangleUpward(
                        baseIndex,
                        baseIndex + index,
                        baseIndex + index + 1);
                }
            }

            public void AddFlatStrip(
                Vector3 start,
                Vector3 end,
                float halfWidth)
            {
                var direction = end - start;
                direction.y = 0f;
                if (direction.sqrMagnitude < 0.000001f)
                {
                    direction = Vector3.forward;
                }
                var side = Vector3.Cross(
                    Vector3.up,
                    direction.normalized) * halfWidth;
                AddQuadUpward(
                    start - side,
                    start + side,
                    end + side,
                    end - side);
            }

            public void AddSlopedStrip(
                Vector3 top,
                Vector3 bottom,
                float halfWidth)
            {
                var direction = bottom - top;
                direction.y = 0f;
                if (direction.sqrMagnitude < 0.000001f)
                {
                    direction = Vector3.forward;
                }
                var side = Vector3.Cross(
                    Vector3.up,
                    direction.normalized) * halfWidth;
                var baseIndex = vertices.Count;
                vertices.Add(top - side);
                vertices.Add(top + side);
                vertices.Add(bottom + side);
                vertices.Add(bottom - side);
                AddTriangleDoubleSided(
                    baseIndex,
                    baseIndex + 1,
                    baseIndex + 2);
                AddTriangleDoubleSided(
                    baseIndex,
                    baseIndex + 2,
                    baseIndex + 3);
            }

            public void AddFlatSquare(Vector3 center, float halfSize)
            {
                AddQuadUpward(
                    center + new Vector3(-halfSize, 0f, -halfSize),
                    center + new Vector3(halfSize, 0f, -halfSize),
                    center + new Vector3(halfSize, 0f, halfSize),
                    center + new Vector3(-halfSize, 0f, halfSize));
            }

            public void AddPrism(
                MapPointMmRecord[] footprint,
                float height)
            {
                var count = footprint.Length;
                var baseIndex = vertices.Count;
                for (var index = 0; index < count; index += 1)
                {
                    vertices.Add(ToWorld(footprint[index], 0f));
                }
                for (var index = 0; index < count; index += 1)
                {
                    vertices.Add(ToWorld(footprint[index], height));
                }

                for (var index = 0; index < count; index += 1)
                {
                    var next = (index + 1) % count;
                    AddTriangleDoubleSided(
                        baseIndex + index,
                        baseIndex + next,
                        baseIndex + count + next);
                    AddTriangleDoubleSided(
                        baseIndex + index,
                        baseIndex + count + next,
                        baseIndex + count + index);
                }
                for (var index = 1; index < count - 1; index += 1)
                {
                    AddTriangleUpward(
                        baseIndex + count,
                        baseIndex + count + index,
                        baseIndex + count + index + 1);
                }
            }

            public void AddCylinderPrism(
                Vector3 center,
                float radius,
                float height,
                int segments)
            {
                var baseIndex = vertices.Count;
                for (var ring = 0; ring < 2; ring += 1)
                {
                    var y = ring == 0 ? 0f : height;
                    for (var index = 0; index < segments; index += 1)
                    {
                        var angle =
                            index * Mathf.PI * 2f / segments;
                        vertices.Add(center + new Vector3(
                            Mathf.Cos(angle) * radius,
                            y,
                            Mathf.Sin(angle) * radius));
                    }
                }
                for (var index = 0; index < segments; index += 1)
                {
                    var next = (index + 1) % segments;
                    AddTriangleDoubleSided(
                        baseIndex + index,
                        baseIndex + next,
                        baseIndex + segments + next);
                    AddTriangleDoubleSided(
                        baseIndex + index,
                        baseIndex + segments + next,
                        baseIndex + segments + index);
                }
                for (var index = 1; index < segments - 1; index += 1)
                {
                    AddTriangleUpward(
                        baseIndex + segments,
                        baseIndex + segments + index,
                        baseIndex + segments + index + 1);
                }
            }

            private void AddQuadUpward(
                Vector3 a,
                Vector3 b,
                Vector3 c,
                Vector3 d)
            {
                var baseIndex = vertices.Count;
                vertices.Add(a);
                vertices.Add(b);
                vertices.Add(c);
                vertices.Add(d);
                AddTriangleUpward(
                    baseIndex,
                    baseIndex + 1,
                    baseIndex + 2);
                AddTriangleUpward(
                    baseIndex,
                    baseIndex + 2,
                    baseIndex + 3);
            }

            public Mesh ToMesh()
            {
                var mesh = new Mesh
                {
                    name = meshName,
                    indexFormat =
                        UnityEngine.Rendering.IndexFormat.UInt32
                };
                mesh.SetVertices(vertices);
                mesh.SetTriangles(triangles, 0);
                mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                return mesh;
            }
        }
    }
}
