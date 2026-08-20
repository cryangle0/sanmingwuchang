using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Pooled presentation view for one PVE monster. Uses the authored
    /// model catalog when available and preserves the greybox fallback.
    /// </summary>
    internal sealed class MonsterView
    {
        private readonly ModelVisualInstance visual;
        private readonly GameObject body;
        private readonly MonsterTier tier;
        private Vector3 targetPosition;
        private Quaternion targetRotation = Quaternion.identity;
        private float bodyHeight = 0.9f;
        private Int2Mm previousPosition;
        private int previousAttackCooldownTicks;
        private bool hasSnapshot;

        public string VisualIdentity { get; }

        public MonsterView(
            int entityId,
            string kind,
            Mesh normalMesh,
            Mesh eliteMesh,
            Mesh bossMesh,
            Material material,
            ModelVisualDefinition modelDefinition = default)
        {
            VisualIdentity = modelDefinition.IsValid
                ? modelDefinition.ModelId
                : $"fallback:{kind}";
            tier = TierOf(kind);
            var mesh = tier switch
            {
                MonsterTier.Boss => bossMesh,
                MonsterTier.Elite => eliteMesh,
                _ => normalMesh
            };
            var scale = tier switch
            {
                MonsterTier.Boss => new Vector3(2.6f, 2.4f, 2.6f),
                MonsterTier.Elite => new Vector3(1.6f, 1.5f, 1.6f),
                _ => new Vector3(0.9f, 0.9f, 0.9f)
            };
            var fallbackHeight = tier switch
            {
                MonsterTier.Boss => 2.4f,
                MonsterTier.Elite => 1.5f,
                _ => 0.9f
            };
            visual = ModelVisualInstance.Create(
                $"Monster {entityId} {kind}",
                modelDefinition,
                mesh,
                material,
                scale,
                fallbackHeight);
            body = visual.Root;
            bodyHeight = visual.IsAuthoredModel
                ? visual.GroundOffset
                : fallbackHeight;
            if (kind == "flying")
            {
                bodyHeight += 2.5f;
            }
            visual.SetFallbackTint(ColorOf(kind));
        }

        public void SetSnapshot(MonsterSnapshot snapshot)
        {
            targetPosition = ToWorld(snapshot.Position, bodyHeight);
            if (snapshot.Facing.X != 0 || snapshot.Facing.Z != 0)
            {
                targetRotation = Quaternion.LookRotation(
                    new Vector3(
                        snapshot.Facing.X,
                        0f,
                        snapshot.Facing.Z));
            }

            var moving = hasSnapshot &&
                (snapshot.Position.X != previousPosition.X ||
                    snapshot.Position.Z != previousPosition.Z);
            visual.SetMoving(moving);
            if (hasSnapshot &&
                snapshot.AttackCooldownTicks >
                    previousAttackCooldownTicks)
            {
                visual.TriggerAttack();
            }
            previousPosition = snapshot.Position;
            previousAttackCooldownTicks = snapshot.AttackCooldownTicks;
            hasSnapshot = true;
        }

        public void TriggerSpell()
        {
            visual.TriggerSpell();
        }

        public void Update(float deltaTime)
        {
            visual.UpdateAnimation(deltaTime);
            var blend = 1f - Mathf.Exp(-18f * deltaTime);
            body.transform.position = Vector3.Lerp(
                body.transform.position,
                targetPosition,
                blend);
            body.transform.rotation = Quaternion.Slerp(
                body.transform.rotation,
                targetRotation,
                blend);
        }

        public void Dispose()
        {
            visual.Dispose();
        }

        private enum MonsterTier : byte
        {
            Normal = 0,
            Elite = 1,
            Boss = 2
        }

        private static MonsterTier TierOf(string kind)
        {
            return kind switch
            {
                "dragon-king" => MonsterTier.Boss,
                "core-boss" => MonsterTier.Boss,
                "elite-tank" => MonsterTier.Elite,
                "elite-ranged" => MonsterTier.Elite,
                _ => MonsterTier.Normal
            };
        }

        private static Color ColorOf(string kind)
        {
            return kind switch
            {
                "ground-melee" => new Color(0.72f, 0.32f, 0.2f),
                "ground-ranged" => new Color(0.78f, 0.52f, 0.2f),
                "flying" => new Color(0.42f, 0.62f, 0.86f),
                "pig" => new Color(0.9f, 0.62f, 0.66f),
                "elite-tank" => new Color(0.62f, 0.2f, 0.62f),
                "elite-ranged" => new Color(0.42f, 0.24f, 0.72f),
                "dragon-king" => new Color(0.95f, 0.82f, 0.2f),
                "core-boss" => new Color(0.92f, 0.16f, 0.14f),
                _ => new Color(0.7f, 0.7f, 0.7f)
            };
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
