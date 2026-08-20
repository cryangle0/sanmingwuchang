using Jwgb.Sim;
using Unity.Collections;
using Unity.Entities;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    [DefaultExecutionOrder(100)]
    public sealed class SyntheticStressPresenter : MonoBehaviour
    {
        private const float MillimetersToMeters = 0.001f;

        [SerializeField]
        private Mesh playerMesh;

        [SerializeField]
        private Mesh monsterMesh;

        [SerializeField]
        private Mesh summonMesh;

        [SerializeField]
        private Material playerMaterial;

        [SerializeField]
        private Material monsterMaterial;

        [SerializeField]
        private Material summonMaterial;

        private EntityManager entityManager;
        private EntityQuery agentQuery;
        private NativeArray<Entity> agentEntities;
        private SyntheticAgentKind[] agentKinds;
        private SyntheticRenderBatch playerBatch;
        private SyntheticRenderBatch monsterBatch;
        private SyntheticRenderBatch summonBatch;
        private bool agentQueryCreated;
        private bool initialized;

        public int PlayerCount { get; private set; }

        public int MonsterCount { get; private set; }

        public int SummonCount { get; private set; }

        public int RenderedAgentCount { get; private set; }

        private void LateUpdate()
        {
            if (!initialized && !TryInitialize())
            {
                return;
            }

            entityManager.CompleteDependencyBeforeRO<SimPositionMm>();
            playerBatch.Reset();
            monsterBatch.Reset();
            summonBatch.Reset();

            for (var index = 0; index < agentEntities.Length; index += 1)
            {
                var position = entityManager.GetComponentData<SimPositionMm>(
                    agentEntities[index]);
                Append(
                    agentKinds[index],
                    position.X * MillimetersToMeters,
                    position.Z * MillimetersToMeters);
            }

            DrawBatches();
            RenderedAgentCount = agentEntities.Length;
        }

        internal void RenderForCamera(Camera camera)
        {
            if (initialized)
            {
                DrawBatches(camera);
            }
        }

        private bool TryInitialize()
        {
            var world = World.DefaultGameObjectInjectionWorld;
            if (world == null || !world.IsCreated)
            {
                return false;
            }

            entityManager = world.EntityManager;
            agentQuery = entityManager.CreateEntityQuery(
                ComponentType.ReadOnly<SimPositionMm>(),
                ComponentType.ReadOnly<SyntheticAgent>());
            agentQueryCreated = true;
            var agentCount = agentQuery.CalculateEntityCount();
            if (agentCount == 0)
            {
                agentQuery.Dispose();
                agentQueryCreated = false;
                agentQuery = default;
                return false;
            }

            using var agents = agentQuery.ToComponentDataArray<SyntheticAgent>(
                Allocator.Temp);
            CountAgentKinds(agents);
            agentEntities = agentQuery.ToEntityArray(Allocator.Persistent);
            agentKinds = new SyntheticAgentKind[agentCount];
            for (var index = 0; index < agents.Length; index += 1)
            {
                agentKinds[index] = agents[index].Kind;
            }

            agentQuery.Dispose();
            agentQueryCreated = false;
            agentQuery = default;

            var bounds = ResolveWorldBounds();
            playerBatch = new SyntheticRenderBatch(
                playerMesh,
                playerMaterial,
                PlayerCount,
                new Vector3(1.2f, 2.2f, 1.2f),
                bounds);
            monsterBatch = new SyntheticRenderBatch(
                monsterMesh,
                monsterMaterial,
                MonsterCount,
                new Vector3(1.8f, 1.8f, 1.8f),
                bounds);
            summonBatch = new SyntheticRenderBatch(
                summonMesh,
                summonMaterial,
                SummonCount,
                new Vector3(0.7f, 0.7f, 0.7f),
                bounds);
            initialized = true;
            Debug.Log(
                "JWGB synthetic presentation initialized: " +
                $"{agentCount} GPU-instanced agents.");
            return true;
        }

        private void CountAgentKinds(NativeArray<SyntheticAgent> agents)
        {
            for (var index = 0; index < agents.Length; index += 1)
            {
                switch (agents[index].Kind)
                {
                    case SyntheticAgentKind.Player:
                        PlayerCount += 1;
                        break;
                    case SyntheticAgentKind.Monster:
                        MonsterCount += 1;
                        break;
                    case SyntheticAgentKind.Summon:
                        SummonCount += 1;
                        break;
                }
            }
        }

        private Bounds ResolveWorldBounds()
        {
            using var stateQuery = entityManager.CreateEntityQuery(
                ComponentType.ReadOnly<SyntheticStressState>());
            var radius = stateQuery.GetSingleton<SyntheticStressState>()
                .ArenaRadiusMm * MillimetersToMeters;
            var diameter = (radius * 2f) + 8f;
            return new Bounds(
                new Vector3(0f, 2f, 0f),
                new Vector3(diameter, 8f, diameter));
        }

        private void Append(SyntheticAgentKind kind, float x, float z)
        {
            switch (kind)
            {
                case SyntheticAgentKind.Player:
                    playerBatch.Append(x, z);
                    break;
                case SyntheticAgentKind.Monster:
                    monsterBatch.Append(x, z);
                    break;
                case SyntheticAgentKind.Summon:
                    summonBatch.Append(x, z);
                    break;
            }
        }

        private void DrawBatches(Camera camera = null)
        {
            playerBatch.Draw(camera);
            monsterBatch.Draw(camera);
            summonBatch.Draw(camera);
        }

        private void OnDestroy()
        {
            if (agentEntities.IsCreated)
            {
                agentEntities.Dispose();
            }

            if (agentQueryCreated)
            {
                agentQuery.Dispose();
            }
        }
    }
}
