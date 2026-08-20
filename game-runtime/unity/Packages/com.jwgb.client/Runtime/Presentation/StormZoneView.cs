using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Storm boundary indicator: a procedural flat annulus that follows
    /// the storm zone center and radius from the snapshot. Turns dark
    /// red once the apocalypse starts.
    /// </summary>
    internal sealed class StormZoneView
    {
        private const int Segments = 96;
        private const float RingThicknessMeters = 6f;
        private const float RingHeight = 0.35f;

        private static readonly int BaseColor =
            Shader.PropertyToID("_BaseColor");

        private static readonly Color NormalColor =
            new Color(0.85f, 0.32f, 0.1f);
        private static readonly Color WarningColor =
            new Color(0.95f, 0.6f, 0.12f);
        private static readonly Color ApocalypseColor =
            new Color(0.55f, 0.05f, 0.08f);

        private readonly GameObject ring;
        private readonly Mesh ringMesh;
        private readonly MeshRenderer ringRenderer;
        private readonly MaterialPropertyBlock properties =
            new MaterialPropertyBlock();

        public StormZoneView(Material material)
        {
            ringMesh = BuildUnitRing();
            ring = new GameObject("Storm Zone Ring");
            ring.AddComponent<MeshFilter>().sharedMesh = ringMesh;
            ringRenderer = ring.AddComponent<MeshRenderer>();
            ringRenderer.sharedMaterial = material;
        }

        public void SetSnapshot(StormZoneSnapshot snapshot)
        {
            if (snapshot == null)
            {
                ring.SetActive(false);
                return;
            }
            var radius = snapshot.RadiusMm / 1_000f;
            ring.SetActive(radius > 0.5f);
            ring.transform.position = new Vector3(
                snapshot.Center.X / 1_000f,
                RingHeight,
                snapshot.Center.Z / 1_000f);
            ring.transform.localScale = new Vector3(
                radius,
                1f,
                radius);
            var color = snapshot.ApocalypseStarted
                ? ApocalypseColor
                : snapshot.ApocalypseWarning
                    ? WarningColor
                    : NormalColor;
            properties.SetColor(BaseColor, color);
            ringRenderer.SetPropertyBlock(properties);
        }

        public void Dispose()
        {
            ViewObjects.DestroyObject(ring);
            ViewObjects.DestroyObject(ringMesh);
        }

        private static Mesh BuildUnitRing()
        {
            var vertices = new Vector3[Segments * 2];
            var triangles = new int[Segments * 12];
            for (var index = 0; index < Segments; index += 1)
            {
                var angle = index * Mathf.PI * 2f / Segments;
                var direction = new Vector3(
                    Mathf.Cos(angle),
                    0f,
                    Mathf.Sin(angle));
                vertices[index] = direction;
                // Outer edge thickness is applied in local units and
                // divided by the radius scale at runtime; a fixed small
                // fraction keeps the ring visible at every radius.
                vertices[Segments + index] =
                    direction * (1f + RingThicknessMeters / 520f);
            }
            var triangleIndex = 0;
            for (var index = 0; index < Segments; index += 1)
            {
                var next = (index + 1) % Segments;
                var a = index;
                var b = next;
                var c = Segments + next;
                var d = Segments + index;
                triangles[triangleIndex++] = a;
                triangles[triangleIndex++] = b;
                triangles[triangleIndex++] = c;
                triangles[triangleIndex++] = a;
                triangles[triangleIndex++] = c;
                triangles[triangleIndex++] = d;
                triangles[triangleIndex++] = a;
                triangles[triangleIndex++] = c;
                triangles[triangleIndex++] = b;
                triangles[triangleIndex++] = a;
                triangles[triangleIndex++] = d;
                triangles[triangleIndex++] = c;
            }
            var mesh = new Mesh
            {
                name = "StormZoneRing"
            };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            // Both windings share vertices, so recalculated normals
            // would cancel to zero; the ring is flat, so use explicit
            // up normals for stable lighting.
            var normals = new Vector3[vertices.Length];
            for (var index = 0; index < normals.Length; index += 1)
            {
                normals[index] = Vector3.up;
            }
            mesh.normals = normals;
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
