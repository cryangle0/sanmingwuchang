using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Owns the scene objects for the map greybox. One renderer per
    /// merged mesh group, so the whole environment stays at seven draw
    /// calls. Reads catalog data only; never touches simulation state.
    /// </summary>
    public sealed class MapEnvironmentView
    {
        private readonly GameObject root;
        private readonly MapEnvironmentMeshSet meshes;

        public MapEnvironmentView(
            MapEnvironmentMeshSet meshSet,
            Material beyondMaterial,
            Material groundMaterial,
            Material roadMaterial,
            Material courtMaterial,
            Material wallMaterial,
            Material highlandMaterial,
            Material spawnPadMaterial,
            bool addColliders = false)
        {
            meshes = meshSet;
            root = new GameObject("JWGB Map Environment");
            AddGroup("Beyond", meshSet.Beyond, beyondMaterial, false);
            AddGroup("Ground", meshSet.Ground, groundMaterial, false);
            AddGroup("Roads", meshSet.Roads, roadMaterial, false);
            AddGroup("Courts", meshSet.Courts, courtMaterial, false);
            AddGroup(
                "Walls",
                meshSet.Walls,
                wallMaterial,
                addColliders);
            AddGroup(
                "Highlands",
                meshSet.Highlands,
                highlandMaterial,
                addColliders);
            AddGroup(
                "Spawn Pads",
                meshSet.SpawnPads,
                spawnPadMaterial,
                false);
        }

        public GameObject Root => root;

        public void Dispose()
        {
            if (root != null)
            {
                if (Application.isPlaying)
                {
                    Object.Destroy(root);
                }
                else
                {
                    Object.DestroyImmediate(root);
                }
            }
            meshes?.Dispose();
        }

        private void AddGroup(
            string name,
            Mesh mesh,
            Material material,
            bool addCollider)
        {
            if (mesh == null)
            {
                return;
            }
            var group = new GameObject($"Map {name}");
            group.transform.SetParent(root.transform, false);
            group.AddComponent<MeshFilter>().sharedMesh = mesh;
            group.AddComponent<MeshRenderer>().sharedMaterial =
                material;
            if (addCollider)
            {
                group.AddComponent<MeshCollider>().sharedMesh = mesh;
            }
        }
    }
}
