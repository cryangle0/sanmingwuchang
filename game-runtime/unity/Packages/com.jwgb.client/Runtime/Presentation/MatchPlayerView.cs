using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    internal sealed class MatchPlayerView
    {
        private readonly ModelVisualInstance visual;
        private readonly GameObject body;
        private readonly GameObject selection;
        private readonly Transform healthRoot;
        private readonly Transform healthFill;
        private readonly Transform shieldFill;
        private readonly TextMesh nameLabel;
        private readonly bool localView;
        private readonly RemoteTransformInterpolator remoteInterpolator =
            new RemoteTransformInterpolator();
        private readonly Color bodyColor;
        private Vector3 targetPosition;
        private Quaternion targetRotation;
        private float targetHeight = 1.1f;
        private int previousAttackCooldownTicks;
        private int previousActiveCooldownTicks;
        private int previousWhirlwindTicks;
        private bool hasSnapshot;

        public string HeroId { get; }

        public bool RemoteHeldLastFrame =>
            !localView && remoteInterpolator.HeldLastFrame;

        public int RemoteStepMmLastFrame =>
            localView ? 0 : remoteInterpolator.LastStepMm;

        public MatchPlayerView(
            int entityId,
            string heroId,
            string heroName,
            Mesh bodyMesh,
            Mesh cubeMesh,
            Mesh cylinderMesh,
            Material material,
            Material healthBackgroundMaterial,
            Material healthMaterial,
            Material shieldMaterial,
            bool isLocal,
            ModelVisualDefinition modelDefinition = default)
        {
            HeroId = heroId;
            localView = isLocal;
            bodyColor = HeroPalette.GetColor(heroId);
            visual = ModelVisualInstance.Create(
                $"Player {entityId}",
                modelDefinition,
                bodyMesh,
                material,
                isLocal
                    ? new Vector3(1.15f, 1.2f, 1.15f)
                    : new Vector3(1f, 1.1f, 1f),
                fallbackHeight: 1.1f);
            body = visual.Root;
            targetHeight = visual.IsAuthoredModel
                ? visual.GroundOffset
                : 1.1f;

            selection = CreateMeshObject(
                $"Selection {entityId}",
                cylinderMesh,
                material);
            selection.transform.localScale =
                new Vector3(1.4f, 0.025f, 1.4f);
            selection.SetActive(isLocal);
            var selectionProperties = new MaterialPropertyBlock();
            selectionProperties.SetColor(
                Shader.PropertyToID("_BaseColor"),
                (Color)HeroPalette.LocalHighlight);
            selection.GetComponent<MeshRenderer>()
                .SetPropertyBlock(selectionProperties);

            var health = new GameObject($"Health {entityId}");
            healthRoot = health.transform;
            CreateBarSegment(
                healthRoot,
                cubeMesh,
                healthBackgroundMaterial,
                new Vector3(2.2f, 0.16f, 0.12f),
                Vector3.zero);
            healthFill = CreateBarSegment(
                healthRoot,
                cubeMesh,
                healthMaterial,
                new Vector3(2.1f, 0.11f, 0.14f),
                new Vector3(0f, 0f, -0.01f)).transform;
            shieldFill = CreateBarSegment(
                healthRoot,
                cubeMesh,
                shieldMaterial,
                new Vector3(2.1f, 0.06f, 0.16f),
                new Vector3(0f, 0.16f, -0.02f)).transform;
            if (isLocal)
            {
                nameLabel = CreateNameLabel(healthRoot, heroName);
            }
        }

        public void SetSnapshot(
            PlayerSnapshot snapshot,
            int snapshotTick)
        {
            var visible = snapshot.LifeState != LifeState.Eliminated;
            visual.SetVisible(visible);
            healthRoot.gameObject.SetActive(visible);
            if (!visible)
            {
                selection.SetActive(false);
                return;
            }

            targetHeight =
                snapshot.LifeState == LifeState.SoulFlight
                ? (visual.IsAuthoredModel ? 2.3f : 3.4f)
                : visual.IsAuthoredModel
                    ? visual.GroundOffset
                    : 1.1f;
            if (localView)
            {
                targetPosition = ToWorld(
                    snapshot.Position,
                    targetHeight);
                SetTargetFacing(snapshot.Facing);
            }
            else
            {
                remoteInterpolator.AddSample(
                    snapshotTick,
                    snapshot.Position,
                    snapshot.Facing);
            }

            var hpRatio = snapshot.MaxHp <= 0
                ? 0f
                : Mathf.Clamp01((float)snapshot.Hp / snapshot.MaxHp);
            SetBar(healthFill, hpRatio, 2.1f);
            var shieldRatio = snapshot.MaxHp <= 0
                ? 0f
                : Mathf.Clamp01(
                    (float)snapshot.TotalShield / snapshot.MaxHp);
            SetBar(shieldFill, shieldRatio, 2.1f);

            var tint = snapshot.LifeState switch
            {
                LifeState.SoulFlight => bodyColor * 0.55f,
                LifeState.ReviveProtection =>
                    Color.Lerp(bodyColor, Color.white, 0.45f),
                _ => bodyColor
            };
            tint.a = 1f;
            visual.SetFallbackTint(tint);

            var moving = snapshot.Intent.Movement.X != 0 ||
                snapshot.Intent.Movement.Z != 0;
            visual.SetMoving(moving);
            if (hasSnapshot)
            {
                var activeStarted =
                    snapshot.ActiveCooldownTicks >
                        previousActiveCooldownTicks ||
                    (snapshot.WhirlwindTicks > 0 &&
                        previousWhirlwindTicks <= 0);
                var attackStarted =
                    snapshot.AttackCooldownTicks >
                        previousAttackCooldownTicks;
                if (activeStarted)
                {
                    visual.TriggerSpell();
                }
                else if (attackStarted)
                {
                    visual.TriggerAttack();
                }
            }

            previousAttackCooldownTicks = snapshot.AttackCooldownTicks;
            previousActiveCooldownTicks = snapshot.ActiveCooldownTicks;
            previousWhirlwindTicks = snapshot.WhirlwindTicks;
            hasSnapshot = true;
        }

        public void Update(float deltaTime, bool isLocal)
        {
            visual.UpdateAnimation(deltaTime);
            if (localView)
            {
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
            else
            {
                remoteInterpolator.Advance(deltaTime);
                body.transform.position = ToWorld(
                    remoteInterpolator.CurrentPosition,
                    targetHeight);
                SetTargetFacing(
                    remoteInterpolator.CurrentFacing);
                body.transform.rotation = targetRotation;
            }

            var healthHeight = visual.IsAuthoredModel
                ? visual.Height + 0.35f
                : 2.3f;
            healthRoot.position =
                body.transform.position + new Vector3(0f, healthHeight, 0f);
            if (nameLabel != null)
            {
                var camera = Camera.main;
                if (camera != null)
                {
                    nameLabel.transform.rotation = Quaternion.LookRotation(
                        nameLabel.transform.position - camera.transform.position);
                }
            }
            if (isLocal && body.activeSelf)
            {
                selection.SetActive(true);
                selection.transform.position = new Vector3(
                    body.transform.position.x,
                    0.08f,
                    body.transform.position.z);
            }
        }

        public void SetPredictedTransform(
            Int2Mm position,
            Int2Mm facing)
        {
            if (!localView)
            {
                return;
            }
            targetPosition = ToWorld(position, targetPosition.y);
            SetTargetFacing(facing);
        }

        public void Dispose()
        {
            visual.Dispose();
            if (selection != null)
            {
                ViewObjects.DestroyObject(selection);
            }
            if (healthRoot != null)
            {
                ViewObjects.DestroyObject(healthRoot.gameObject);
            }
        }

        private static GameObject CreateMeshObject(
            string name,
            Mesh mesh,
            Material material)
        {
            var instance = new GameObject(name);
            instance.AddComponent<MeshFilter>().sharedMesh = mesh;
            instance.AddComponent<MeshRenderer>().sharedMaterial = material;
            return instance;
        }

        private static TextMesh CreateNameLabel(
            Transform parent,
            string heroName)
        {
            var labelObject = new GameObject("Hero Name");
            labelObject.transform.SetParent(parent, false);
            labelObject.transform.localPosition =
                new Vector3(0f, 0.55f, 0f);
            var label = labelObject.AddComponent<TextMesh>();
            label.text = heroName ?? string.Empty;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.fontSize = 48;
            label.characterSize = 0.08f;
            label.color = new Color(0.94f, 0.96f, 0.94f);
            var font = Resources.GetBuiltinResource<Font>(
                "LegacyRuntime.ttf");
            if (font != null)
            {
                label.font = font;
                labelObject.GetComponent<MeshRenderer>()
                    .sharedMaterial = font.material;
            }
            return label;
        }

        private static GameObject CreateBarSegment(
            Transform parent,
            Mesh mesh,
            Material material,
            Vector3 scale,
            Vector3 position)
        {
            var segment = CreateMeshObject("Bar", mesh, material);
            segment.transform.SetParent(parent, false);
            segment.transform.localScale = scale;
            segment.transform.localPosition = position;
            return segment;
        }

        private static void SetBar(
            Transform bar,
            float ratio,
            float fullWidth)
        {
            var scale = bar.localScale;
            scale.x = fullWidth * ratio;
            bar.localScale = scale;
            var position = bar.localPosition;
            position.x = -(fullWidth - scale.x) * 0.5f;
            bar.localPosition = position;
            bar.gameObject.SetActive(ratio > 0.001f);
        }

        private void SetTargetFacing(Int2Mm facing)
        {
            if (facing.X == 0 && facing.Z == 0)
            {
                return;
            }
            targetRotation = Quaternion.LookRotation(
                new Vector3(facing.X, 0f, facing.Z));
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
