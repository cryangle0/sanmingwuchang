using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Pooled marker view for one loot drop. Small bright sphere whose
    /// color reflects the most valuable content of the drop, with a
    /// gentle bob so pickups read as interactive.
    /// </summary>
    internal sealed class LootView
    {
        private static readonly int BaseColor =
            Shader.PropertyToID("_BaseColor");

        private readonly GameObject marker;
        private readonly MeshRenderer meshRenderer;
        private readonly MaterialPropertyBlock properties =
            new MaterialPropertyBlock();
        private Vector3 basePosition;
        private float bobPhase;

        public LootView(
            int entityId,
            Mesh mesh,
            Material material)
        {
            marker = new GameObject($"Loot {entityId}");
            marker.AddComponent<MeshFilter>().sharedMesh = mesh;
            meshRenderer = marker.AddComponent<MeshRenderer>();
            meshRenderer.sharedMaterial = material;
            marker.transform.localScale = Vector3.one * 0.45f;
            bobPhase = (entityId % 16) * 0.4f;
        }

        public void SetSnapshot(LootSnapshot snapshot)
        {
            basePosition = new Vector3(
                snapshot.Position.X / 1_000f,
                0.55f,
                snapshot.Position.Z / 1_000f);
            properties.SetColor(BaseColor, ColorOf(snapshot));
            meshRenderer.SetPropertyBlock(properties);
        }

        public void Update(float deltaTime)
        {
            bobPhase += deltaTime * 2.4f;
            marker.transform.position = basePosition +
                new Vector3(
                    0f,
                    Mathf.Sin(bobPhase) * 0.14f,
                    0f);
        }

        public void Dispose()
        {
            ViewObjects.DestroyObject(marker);
        }

        private static Color ColorOf(LootSnapshot snapshot)
        {
            if (!string.IsNullOrEmpty(snapshot.EquipmentId))
            {
                return new Color(0.2f, 0.85f, 0.9f);
            }
            if (!string.IsNullOrEmpty(snapshot.BookPassiveId))
            {
                return new Color(0.72f, 0.35f, 0.95f);
            }
            if (snapshot.Gems > 0)
            {
                return new Color(0.95f, 0.3f, 0.75f);
            }
            return new Color(0.98f, 0.85f, 0.25f);
        }
    }
}
