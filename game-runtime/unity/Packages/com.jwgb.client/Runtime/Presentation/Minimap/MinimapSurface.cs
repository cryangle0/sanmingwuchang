using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// CPU raster surface over a Color32 buffer used by the minimap.
    /// Coordinates use y-down pixel space (row 0 on top) while the
    /// backing buffer is stored bottom-up so it can be uploaded to a
    /// Texture2D without a flip. All drawing is deterministic for a
    /// given input.
    /// </summary>
    public sealed class MinimapSurface
    {
        public MinimapSurface(int width, int height)
        {
            Width = width;
            Height = height;
            Buffer = new Color32[width * height];
        }

        public int Width { get; }

        public int Height { get; }

        public Color32[] Buffer { get; }

        public void Fill(Color32 color)
        {
            for (var index = 0; index < Buffer.Length; index += 1)
            {
                Buffer[index] = color;
            }
        }

        public void SetPixel(int x, int y, Color32 color)
        {
            if (x < 0 || x >= Width || y < 0 || y >= Height)
            {
                return;
            }
            Buffer[((Height - 1 - y) * Width) + x] = color;
        }

        public void FillTriangle(
            Vector2 a,
            Vector2 b,
            Vector2 c,
            Color32 color)
        {
            var minX = Mathf.Max(
                0,
                Mathf.FloorToInt(Mathf.Min(a.x, Mathf.Min(b.x, c.x))));
            var maxX = Mathf.Min(
                Width - 1,
                Mathf.CeilToInt(Mathf.Max(a.x, Mathf.Max(b.x, c.x))));
            var minY = Mathf.Max(
                0,
                Mathf.FloorToInt(Mathf.Min(a.y, Mathf.Min(b.y, c.y))));
            var maxY = Mathf.Min(
                Height - 1,
                Mathf.CeilToInt(Mathf.Max(a.y, Mathf.Max(b.y, c.y))));
            var area = Edge(a, b, c);
            if (Mathf.Abs(area) < 0.0001f)
            {
                return;
            }

            for (var y = minY; y <= maxY; y += 1)
            {
                for (var x = minX; x <= maxX; x += 1)
                {
                    var point = new Vector2(x + 0.5f, y + 0.5f);
                    var w0 = Edge(a, b, point) / area;
                    var w1 = Edge(b, c, point) / area;
                    var w2 = Edge(c, a, point) / area;
                    if (w0 >= 0f && w1 >= 0f && w2 >= 0f)
                    {
                        SetPixel(x, y, color);
                    }
                }
            }
        }

        /// <summary>Fills a convex polygon with a triangle fan.</summary>
        public void FillConvexPolygon(Vector2[] points, Color32 color)
        {
            for (var index = 1;
                index < points.Length - 1;
                index += 1)
            {
                FillTriangle(
                    points[0],
                    points[index],
                    points[index + 1],
                    color);
            }
        }

        public void DrawLine(Vector2 from, Vector2 to, Color32 color)
        {
            var delta = to - from;
            var steps = Mathf.CeilToInt(
                Mathf.Max(Mathf.Abs(delta.x), Mathf.Abs(delta.y)));
            if (steps <= 0)
            {
                SetPixel(
                    Mathf.RoundToInt(from.x),
                    Mathf.RoundToInt(from.y),
                    color);
                return;
            }
            for (var step = 0; step <= steps; step += 1)
            {
                var point = from + (delta * (step / (float)steps));
                SetPixel(
                    Mathf.RoundToInt(point.x),
                    Mathf.RoundToInt(point.y),
                    color);
            }
        }

        public void DrawThickLine(
            Vector2 from,
            Vector2 to,
            float halfWidth,
            Color32 color)
        {
            var direction = to - from;
            if (direction.sqrMagnitude < 0.0001f)
            {
                FillCircle(from, halfWidth, color);
                return;
            }
            var side = new Vector2(-direction.y, direction.x)
                .normalized * halfWidth;
            FillTriangle(from - side, from + side, to + side, color);
            FillTriangle(from - side, to + side, to - side, color);
        }

        public void DrawPolygonOutline(
            Vector2[] points,
            Color32 color)
        {
            for (var index = 0; index < points.Length; index += 1)
            {
                DrawLine(
                    points[index],
                    points[(index + 1) % points.Length],
                    color);
            }
        }

        public void FillCircle(
            Vector2 center,
            float radius,
            Color32 color)
        {
            var minX = Mathf.FloorToInt(center.x - radius);
            var maxX = Mathf.CeilToInt(center.x + radius);
            var minY = Mathf.FloorToInt(center.y - radius);
            var maxY = Mathf.CeilToInt(center.y + radius);
            var radiusSquared = radius * radius;
            for (var y = minY; y <= maxY; y += 1)
            {
                for (var x = minX; x <= maxX; x += 1)
                {
                    var point = new Vector2(x + 0.5f, y + 0.5f);
                    if ((point - center).sqrMagnitude <= radiusSquared)
                    {
                        SetPixel(x, y, color);
                    }
                }
            }
        }

        public void DrawCircleOutline(
            Vector2 center,
            float radius,
            Color32 color)
        {
            if (radius <= 0f)
            {
                return;
            }
            var steps = Mathf.Clamp(
                Mathf.CeilToInt(radius * 6f),
                12,
                256);
            var previous = center + new Vector2(radius, 0f);
            for (var step = 1; step <= steps; step += 1)
            {
                var angle = step * Mathf.PI * 2f / steps;
                var point = center + new Vector2(
                    Mathf.Cos(angle) * radius,
                    Mathf.Sin(angle) * radius);
                DrawLine(previous, point, color);
                previous = point;
            }
        }

        private static float Edge(Vector2 a, Vector2 b, Vector2 point)
        {
            return ((b.x - a.x) * (point.y - a.y)) -
                ((b.y - a.y) * (point.x - a.x));
        }
    }
}
