using System.Collections.Generic;
using Jwgb.Content;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Renders the static minimap layer once per session from the
    /// compiled MapGeometryCatalog: boundary silhouette, roads,
    /// highlands, walls, and court outlines. CPU rasterization into a
    /// Color32 buffer; deterministic for a given catalog. Colors mirror
    /// the web minimap (apps/web/src/render/map/minimap.ts).
    /// </summary>
    public static class MinimapStaticLayer
    {
        private static readonly Color32 BackgroundColor =
            new Color32(12, 17, 13, 222);
        private static readonly Color32 GroundColor =
            new Color32(0x2c, 0x35, 0x2c, 255);
        private static readonly Color32 BoundaryEdgeColor =
            new Color32(0x5b, 0x6a, 0x5c, 255);
        private static readonly Color32 RoadColor =
            new Color32(0x3a, 0x45, 0x38, 255);
        private static readonly Color32 HighlandColor =
            new Color32(0x55, 0x60, 0x4a, 255);
        private static readonly Color32 WallColor =
            new Color32(0x6d, 0x63, 0x53, 255);
        private static readonly Color32 CourtColor =
            new Color32(0xb7, 0x94, 0x47, 255);

        public static MinimapSurface Render(
            MinimapProjection projection)
        {
            var surface = new MinimapSurface(
                MinimapProjection.Width,
                MinimapProjection.Height);
            surface.Fill(BackgroundColor);
            DrawBoundary(surface, projection);
            DrawRoads(surface, projection);
            DrawHighlands(surface, projection);
            DrawWalls(surface, projection);
            DrawCourts(surface, projection);
            return surface;
        }

        /// <summary>FNV-1a checksum over the RGBA bytes; used by the
        /// determinism tests.</summary>
        public static uint Checksum(Color32[] buffer)
        {
            var hash = 2166136261u;
            for (var index = 0; index < buffer.Length; index += 1)
            {
                var color = buffer[index];
                hash = (hash ^ color.r) * 16777619u;
                hash = (hash ^ color.g) * 16777619u;
                hash = (hash ^ color.b) * 16777619u;
                hash = (hash ^ color.a) * 16777619u;
            }
            return hash;
        }

        private static void DrawBoundary(
            MinimapSurface surface,
            MinimapProjection projection)
        {
            var boundary = MapGeometryCatalog.Boundary;
            var projected = Project(projection, boundary);
            var triangles = MapGeometryCatalog.BoundaryTriangles;
            for (var index = 0; index < triangles.Length; index += 3)
            {
                surface.FillTriangle(
                    projected[triangles[index]],
                    projected[triangles[index + 1]],
                    projected[triangles[index + 2]],
                    GroundColor);
            }
            surface.DrawPolygonOutline(projected, BoundaryEdgeColor);
        }

        private static void DrawRoads(
            MinimapSurface surface,
            MinimapProjection projection)
        {
            var nodes = new Dictionary<string, Vector2>(
                MapGeometryCatalog.RouteNodes.Length);
            for (var index = 0;
                index < MapGeometryCatalog.RouteNodes.Length;
                index += 1)
            {
                var node = MapGeometryCatalog.RouteNodes[index];
                nodes[node.Id] = projection.Project(node.Position);
            }

            for (var index = 0;
                index < MapGeometryCatalog.RouteEdges.Length;
                index += 1)
            {
                var edge = MapGeometryCatalog.RouteEdges[index];
                if (!nodes.TryGetValue(edge.A, out var from) ||
                    !nodes.TryGetValue(edge.B, out var to))
                {
                    continue;
                }
                var halfWidth = Mathf.Max(
                    0.6f,
                    edge.WidthMm * projection.PixelsPerMm * 0.5f);
                surface.DrawThickLine(from, to, halfWidth, RoadColor);
            }
        }

        private static void DrawHighlands(
            MinimapSurface surface,
            MinimapProjection projection)
        {
            for (var index = 0;
                index < MapGeometryCatalog.Highlands.Length;
                index += 1)
            {
                var highland = MapGeometryCatalog.Highlands[index];
                var projected = Project(
                    projection,
                    highland.Vertices);
                var triangles = highland.Triangles;
                for (var triangle = 0;
                    triangle < triangles.Length;
                    triangle += 3)
                {
                    surface.FillTriangle(
                        projected[triangles[triangle]],
                        projected[triangles[triangle + 1]],
                        projected[triangles[triangle + 2]],
                        HighlandColor);
                }
            }
        }

        private static void DrawWalls(
            MinimapSurface surface,
            MinimapProjection projection)
        {
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
                surface.FillConvexPolygon(
                    Project(projection, piece.Vertices),
                    WallColor);
            }
        }

        private static void DrawCourts(
            MinimapSurface surface,
            MinimapProjection projection)
        {
            for (var index = 0;
                index < MapGeometryCatalog.Courts.Length;
                index += 1)
            {
                var court = MapGeometryCatalog.Courts[index];
                surface.DrawPolygonOutline(
                    Project(projection, court.HexVertices),
                    CourtColor);
            }
        }

        private static Vector2[] Project(
            MinimapProjection projection,
            MapPointMmRecord[] points)
        {
            var projected = new Vector2[points.Length];
            for (var index = 0; index < points.Length; index += 1)
            {
                projected[index] = projection.Project(points[index]);
            }
            return projected;
        }
    }
}
