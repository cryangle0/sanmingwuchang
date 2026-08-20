using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Merged greybox meshes for the 840m map, grouped so the whole
    /// environment renders with one draw call per group.
    /// </summary>
    public sealed class MapEnvironmentMeshSet
    {
        public Mesh Beyond { get; set; }

        public Mesh Ground { get; set; }

        public Mesh Roads { get; set; }

        public Mesh Courts { get; set; }

        public Mesh Walls { get; set; }

        public Mesh Highlands { get; set; }

        public Mesh SpawnPads { get; set; }

        public Mesh[] All => new[]
        {
            Beyond,
            Ground,
            Roads,
            Courts,
            Walls,
            Highlands,
            SpawnPads
        };

        public void Dispose()
        {
            DestroyMesh(Beyond);
            DestroyMesh(Ground);
            DestroyMesh(Roads);
            DestroyMesh(Courts);
            DestroyMesh(Walls);
            DestroyMesh(Highlands);
            DestroyMesh(SpawnPads);
            Beyond = null;
            Ground = null;
            Roads = null;
            Courts = null;
            Walls = null;
            Highlands = null;
            SpawnPads = null;
        }

        private static void DestroyMesh(Mesh mesh)
        {
            if (mesh == null)
            {
                return;
            }
            if (Application.isPlaying)
            {
                Object.Destroy(mesh);
            }
            else
            {
                Object.DestroyImmediate(mesh);
            }
        }
    }
}
