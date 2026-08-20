using Jwgb.Content;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Millimeter-to-pixel projection for the corner minimap, mirroring
    /// the web client (apps/web/src/render/map/minimap.ts): the map
    /// boundary is fitted inside a fixed pixel canvas with padding and
    /// north (+z) points up.
    /// </summary>
    public sealed class MinimapProjection
    {
        public const int Width = 232;
        public const int Height = 190;
        public const int Padding = 8;

        private readonly float scale;
        private readonly long offsetXMm;
        private readonly long offsetZMm;

        private MinimapProjection(
            float scale,
            long offsetXMm,
            long offsetZMm)
        {
            this.scale = scale;
            this.offsetXMm = offsetXMm;
            this.offsetZMm = offsetZMm;
        }

        public float PixelsPerMm => scale;

        public static MinimapProjection Create()
        {
            var boundary = MapGeometryCatalog.Boundary;
            var minX = long.MaxValue;
            var maxX = long.MinValue;
            var minZ = long.MaxValue;
            var maxZ = long.MinValue;
            for (var index = 0; index < boundary.Length; index += 1)
            {
                var point = boundary[index];
                minX = System.Math.Min(minX, point.X);
                maxX = System.Math.Max(maxX, point.X);
                minZ = System.Math.Min(minZ, point.Z);
                maxZ = System.Math.Max(maxZ, point.Z);
            }

            var scale = Mathf.Min(
                (Width - (Padding * 2)) / (float)(maxX - minX),
                (Height - (Padding * 2)) / (float)(maxZ - minZ));
            return new MinimapProjection(scale, minX, maxZ);
        }

        /// <summary>Projects a map point to pixel coordinates with
        /// +z up (row 0 is the top of the minimap).</summary>
        public Vector2 Project(long xMm, long zMm)
        {
            return new Vector2(
                Padding + ((xMm - offsetXMm) * scale),
                Padding + ((offsetZMm - zMm) * scale));
        }

        public Vector2 Project(MapPointMmRecord point)
        {
            return Project(point.X, point.Z);
        }
    }
}
