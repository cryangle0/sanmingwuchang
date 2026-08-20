using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    internal sealed class MatchEffectView
    {
        private readonly GameObject instance;
        private Vector3 targetPosition;
        private Quaternion targetRotation = Quaternion.identity;

        public MatchEffectView(
            string name,
            Mesh mesh,
            Material material)
        {
            instance = new GameObject(name);
            instance.AddComponent<MeshFilter>().sharedMesh = mesh;
            instance.AddComponent<MeshRenderer>().sharedMaterial = material;
        }

        public void SetProjectile(ProjectileSnapshot snapshot)
        {
            targetPosition = ToWorld(snapshot.Position, 1.4f);
            instance.transform.localScale = Vector3.one * 0.55f;
        }

        public void SetWindWall(WindWallSnapshot snapshot)
        {
            targetPosition = ToWorld(snapshot.Center, 0.65f);
            targetRotation = Quaternion.LookRotation(
                new Vector3(
                    snapshot.Direction.X,
                    0f,
                    snapshot.Direction.Z));
            instance.transform.localScale = new Vector3(
                snapshot.LengthMm / 1_000f,
                1.2f,
                0.35f);
        }

        public void Update(float deltaTime)
        {
            var blend = 1f - Mathf.Exp(-24f * deltaTime);
            instance.transform.position = Vector3.Lerp(
                instance.transform.position,
                targetPosition,
                blend);
            instance.transform.rotation = Quaternion.Slerp(
                instance.transform.rotation,
                targetRotation,
                blend);
        }

        public void Dispose()
        {
            if (instance != null)
            {
                Object.Destroy(instance);
            }
        }

        private static Vector3 ToWorld(Int2Mm position, float height)
        {
            return new Vector3(
                position.X / 1_000f,
                height,
                position.Z / 1_000f);
        }
    }
}
