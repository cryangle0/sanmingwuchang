using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Jwgb.Client.Presentation
{
    internal sealed class SyntheticRenderBatch
    {
        private const int MaxInstancesPerDraw = 1023;

        private readonly Matrix4x4[] matrices;
        private readonly Mesh mesh;
        private readonly RenderParams renderParams;
        private readonly Vector3 scale;

        public SyntheticRenderBatch(
            Mesh mesh,
            Material material,
            int capacity,
            Vector3 scale,
            Bounds worldBounds)
        {
            if (mesh == null)
            {
                throw new ArgumentNullException(nameof(mesh));
            }

            if (material == null)
            {
                throw new ArgumentNullException(nameof(material));
            }

            if (capacity < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(capacity));
            }

            material.enableInstancing = true;
            this.mesh = mesh;
            this.scale = scale;
            matrices = new Matrix4x4[capacity];
            renderParams = new RenderParams(material)
            {
                worldBounds = worldBounds,
                shadowCastingMode = ShadowCastingMode.Off,
                receiveShadows = false,
                lightProbeUsage = LightProbeUsage.Off,
                reflectionProbeUsage = ReflectionProbeUsage.Off,
                motionVectorMode = MotionVectorGenerationMode.ForceNoMotion
            };
        }

        public int Count { get; private set; }

        public void Reset()
        {
            Count = 0;
        }

        public void Append(float x, float z)
        {
            if (Count >= matrices.Length)
            {
                throw new InvalidOperationException(
                    "Synthetic render batch capacity was exceeded.");
            }

            var position = new Vector3(x, scale.y * 0.5f, z);
            matrices[Count] = Matrix4x4.TRS(
                position,
                Quaternion.identity,
                scale);
            Count += 1;
        }

        public void Draw(Camera camera = null)
        {
            var parameters = renderParams;
            parameters.camera = camera;
            for (var start = 0; start < Count; start += MaxInstancesPerDraw)
            {
                var instanceCount = Math.Min(
                    MaxInstancesPerDraw,
                    Count - start);
                Graphics.RenderMeshInstanced(
                    parameters,
                    mesh,
                    submeshIndex: 0,
                    matrices,
                    instanceCount,
                    start);
            }
        }
    }
}
