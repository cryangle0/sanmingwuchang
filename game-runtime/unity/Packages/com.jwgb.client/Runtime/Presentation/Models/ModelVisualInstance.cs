using UnityEngine;

namespace Jwgb.Client.Presentation
{
    internal sealed class ModelVisualInstance
    {
        private static readonly int BaseColor =
            Shader.PropertyToID("_BaseColor");

        private readonly Renderer[] renderers;
        private readonly MaterialPropertyBlock properties =
            new MaterialPropertyBlock();
        private readonly ModelAnimationDriver animation;

        private ModelVisualInstance(
            GameObject root,
            bool authoredModel,
            float height,
            float groundOffset)
        {
            Root = root;
            IsAuthoredModel = authoredModel;
            Height = height;
            GroundOffset = groundOffset;
            renderers = root.GetComponentsInChildren<Renderer>(true);
            animation = new ModelAnimationDriver(
                root.GetComponentInChildren<Animator>(true));
        }

        public GameObject Root { get; }

        public bool IsAuthoredModel { get; }

        public float Height { get; }

        public float GroundOffset { get; }

        public static ModelVisualInstance Create(
            string name,
            ModelVisualDefinition definition,
            Mesh fallbackMesh,
            Material fallbackMaterial,
            Vector3 fallbackScale,
            float fallbackHeight)
        {
            if (definition.IsValid)
            {
                var model = Object.Instantiate(definition.Prefab);
                model.name = name;
                return new ModelVisualInstance(
                    model,
                    authoredModel: true,
                    definition.Height,
                    definition.GroundOffset);
            }

            var fallback = new GameObject(name);
            fallback.AddComponent<MeshFilter>().sharedMesh = fallbackMesh;
            fallback.AddComponent<MeshRenderer>().sharedMaterial =
                fallbackMaterial;
            fallback.transform.localScale = fallbackScale;
            return new ModelVisualInstance(
                fallback,
                authoredModel: false,
                fallbackHeight,
                fallbackHeight * 0.5f);
        }

        public void SetVisible(bool visible)
        {
            Root.SetActive(visible);
        }

        public void SetFallbackTint(Color color)
        {
            if (IsAuthoredModel)
            {
                ClearProperties();
                return;
            }
            properties.SetColor(BaseColor, color);
            ApplyProperties();
        }

        public void SetMoving(bool moving)
        {
            animation.SetMoving(moving);
        }

        public void TriggerAttack()
        {
            animation.TriggerAttack();
        }

        public void TriggerSpell()
        {
            animation.TriggerSpell();
        }

        public void UpdateAnimation(float deltaTime)
        {
            animation.Update(deltaTime);
        }

        public void Dispose()
        {
            ViewObjects.DestroyObject(Root);
        }

        private void ApplyProperties()
        {
            for (var index = 0; index < renderers.Length; index += 1)
            {
                renderers[index].SetPropertyBlock(properties);
            }
        }

        private void ClearProperties()
        {
            properties.Clear();
            ApplyProperties();
        }
    }
}
