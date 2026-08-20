using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Pooled pad view for one shop. Flat cylinder pad rendered only
    /// while the shop is open per the snapshot window.
    /// </summary>
    internal sealed class ShopPadView
    {
        private readonly GameObject pad;

        public ShopPadView(
            string shopId,
            Mesh cylinderMesh,
            Material material)
        {
            pad = new GameObject($"Shop {shopId}");
            pad.AddComponent<MeshFilter>().sharedMesh = cylinderMesh;
            pad.AddComponent<MeshRenderer>().sharedMaterial = material;
            pad.transform.localScale =
                new Vector3(3.2f, 0.09f, 3.2f);
        }

        public void SetSnapshot(ShopSnapshot snapshot, int tick)
        {
            pad.SetActive(
                tick >= snapshot.OpenAtTick &&
                tick < snapshot.CloseAtTick);
            pad.transform.position = new Vector3(
                snapshot.Position.X / 1_000f,
                0.18f,
                snapshot.Position.Z / 1_000f);
        }

        public void Dispose()
        {
            ViewObjects.DestroyObject(pad);
        }
    }
}
