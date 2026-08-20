using System.IO;
using System.Collections.Generic;
using System.Linq;
using Jwgb.Client.Presentation;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Jwgb.Tests
{
    public sealed class ModelVisualAssetTests
    {
        private const string ClientScenePath =
            "Assets/Jwgb/Scenes/Bootstrap.unity";

        [Test]
        public void GeneratedCatalogContainsAllModelsAndValidPrefabs()
        {
            var catalog = AssetDatabase.LoadAssetAtPath<ModelVisualCatalog>(
                ModelVisualCatalog.AssetPath);
            Assert.That(catalog, Is.Not.Null);
            Assert.That(catalog.ValidateEntries(), Is.Empty);
            Assert.That(catalog.HeroCount, Is.EqualTo(38));
            Assert.That(catalog.MonsterCount, Is.EqualTo(38));

            foreach (var hero in catalog.Heroes)
            {
                AssertPrefab(hero.HeroId, hero.Prefab, hero.Height);
            }
            foreach (var monster in catalog.Monsters)
            {
                AssertPrefab(monster.ModelId, monster.Prefab, monster.Height);
            }
        }

        [Test]
        public void ImplementedHeroesResolveAuthoredModels()
        {
            var catalog = AssetDatabase.LoadAssetAtPath<ModelVisualCatalog>(
                ModelVisualCatalog.AssetPath);
            Assert.That(
                catalog.TryResolveHero("H001", out var ironFan),
                Is.True);
            Assert.That(
                catalog.TryResolveHero("H009", out var sunWukong),
                Is.True);
            Assert.That(
                catalog.TryResolveHero("H018", out var bullDemon),
                Is.True);
            Assert.That(ironFan.ModelId, Is.EqualTo("H001"));
            Assert.That(sunWukong.ModelId, Is.EqualTo("H009"));
            Assert.That(bullDemon.ModelId, Is.EqualTo("H018"));
        }

        [Test]
        public void MonsterResolutionIsStableAndCoversEveryKind()
        {
            var catalog = AssetDatabase.LoadAssetAtPath<ModelVisualCatalog>(
                ModelVisualCatalog.AssetPath);
            foreach (var kind in ModelVisualCatalogDefaults.MonsterKinds)
            {
                Assert.That(
                    catalog.TryResolveMonster(
                        kind,
                        12345,
                        out var first),
                    Is.True,
                    kind);
                Assert.That(
                    catalog.TryResolveMonster(
                        kind,
                        12345,
                        out var second),
                    Is.True,
                    kind);
                Assert.That(second.ModelId, Is.EqualTo(first.ModelId), kind);
            }
        }

        [TestCase("earth", "M018", "M034")]
        [TestCase("wood", "M019", "M035")]
        [TestCase("water", "M020", "M036")]
        [TestCase("fire", "M021", "M037")]
        [TestCase("metal", "M022", "M038")]
        public void ElementalMonstersResolveMatchingModels(
            string element,
            string expectedPigModelId,
            string expectedDragonModelId)
        {
            var catalog = AssetDatabase.LoadAssetAtPath<ModelVisualCatalog>(
                ModelVisualCatalog.AssetPath);

            Assert.That(
                catalog.TryResolveMonster(
                    "pig",
                    1,
                    element,
                    out var pig),
                Is.True);
            Assert.That(pig.ModelId, Is.EqualTo(expectedPigModelId));
            Assert.That(
                catalog.TryResolveMonster(
                    "dragon-king",
                    1,
                    element,
                    out var dragon),
                Is.True);
            Assert.That(
                dragon.ModelId,
                Is.EqualTo(expectedDragonModelId));
        }

        [Test]
        public void GenericPigVariantRemainsReachable()
        {
            var catalog = AssetDatabase.LoadAssetAtPath<ModelVisualCatalog>(
                ModelVisualCatalog.AssetPath);

            Assert.That(
                catalog.TryResolveMonster(
                    "pig",
                    6,
                    "fire",
                    out var pig),
                Is.True);
            Assert.That(pig.ModelId, Is.EqualTo("M015"));
        }

        [Test]
        public void CoreBossResolutionUsesTheAuthoritativeRootSeed()
        {
            var catalog = AssetDatabase.LoadAssetAtPath<ModelVisualCatalog>(
                ModelVisualCatalog.AssetPath);
            for (uint rootSeed = 0; rootSeed < 6; rootSeed += 1)
            {
                Assert.That(
                    catalog.TryResolveMonster(
                        "core-boss",
                        123,
                        null,
                        rootSeed,
                        out var boss),
                    Is.True);
                Assert.That(
                    boss.ModelId,
                    Is.EqualTo($"M{27 + rootSeed:D3}"));
            }
        }

        [Test]
        public void FullMapMatchesReachEveryDeliveredMonsterModel()
        {
            var catalog = AssetDatabase.LoadAssetAtPath<ModelVisualCatalog>(
                ModelVisualCatalog.AssetPath);
            var resolved = new HashSet<string>();
            for (var rootSeed = 0; rootSeed < 500; rootSeed += 1)
            {
                var simulation = new Jwgb.Sim.Deterministic.GameSimulation(
                    new Jwgb.Sim.Deterministic.GameSimulationOptions
                    {
                        RootSeed = rootSeed,
                        MapEnabled = true,
                        PveEnabled = true,
                        PvePopulation =
                            Jwgb.Sim.Deterministic.PvePopulation.Full
                    });
                var snapshot = simulation.GetSnapshot();
                Assert.That(
                    snapshot.Monsters,
                    Has.Length.EqualTo(123),
                    $"root seed {rootSeed}");
                foreach (var monster in snapshot.Monsters)
                {
                    Assert.That(
                        catalog.TryResolveMonster(
                            monster.Kind,
                            monster.EntityId,
                            monster.Element,
                            snapshot.RootSeed,
                            out var definition),
                        Is.True,
                        $"root seed {rootSeed}, entity {monster.EntityId}");
                    resolved.Add(definition.ModelId);
                }
            }

            Assert.That(
                resolved,
                Is.EquivalentTo(
                    ModelVisualCatalogDefaults.Monsters.Select(
                        monster => monster.ModelId)));
        }

        [Test]
        public void ClientSceneReferencesGeneratedCatalog()
        {
            var scene = EditorSceneManager.OpenScene(
                ClientScenePath,
                OpenSceneMode.Single);
            var rootObjects = scene.GetRootGameObjects();
            var localPresenter = rootObjects
                .SelectMany(root =>
                    root.GetComponentsInChildren<LocalMatchPresenter>(true))
                .Single();
            var pvePresenter = rootObjects
                .SelectMany(root =>
                    root.GetComponentsInChildren<MatchPveEntityPresenter>(true))
                .Single();

            AssertCatalogReference(localPresenter);
            AssertCatalogReference(pvePresenter);
        }

        [Test]
        public void DeliveryVerificationReportPassed()
        {
            var repositoryRoot = Path.GetFullPath(
                Path.Combine(Application.dataPath, "..", ".."));
            var reportPath = Path.Combine(
                repositoryRoot,
                "migration",
                "reports",
                "unity",
                "model-delivery-verification.json");
            Assert.That(File.Exists(reportPath), Is.True, reportPath);
            var json = File.ReadAllText(reportPath);
            StringAssert.Contains("\"Status\":  \"passed\"", json);
            StringAssert.Contains("\"HeroCount\":  38", json);
            StringAssert.Contains("\"MonsterCount\":  38", json);
            StringAssert.Contains(
                "\"InvalidSidecarJsonCount\":  0",
                json);
        }

        private static void AssertPrefab(
            string id,
            GameObject prefab,
            float expectedHeight)
        {
            Assert.That(prefab, Is.Not.Null, id);
            var prefabPath = AssetDatabase.GetAssetPath(prefab);
            Assert.That(prefabPath, Does.EndWith($"/{id}.prefab"), id);
            var renderers = prefab.GetComponentsInChildren<Renderer>(true);
            Assert.That(renderers, Is.Not.Empty, id);
            var meshCount = 0;
            var materialCount = 0;
            foreach (var renderer in renderers)
            {
                Assert.That(renderer, Is.Not.Null, id);
                var materials = renderer.sharedMaterials;
                Assert.That(materials, Is.Not.Empty, id);
                foreach (var material in materials)
                {
                    Assert.That(material, Is.Not.Null, id);
                    materialCount += 1;
                }

                if (renderer is MeshRenderer)
                {
                    var meshFilter = renderer.GetComponent<MeshFilter>();
                    if (meshFilter != null && meshFilter.sharedMesh != null)
                    {
                        meshCount += meshFilter.sharedMesh.vertexCount;
                    }
                }
                else if (renderer is SkinnedMeshRenderer skinned &&
                    skinned.sharedMesh != null)
                {
                    meshCount += skinned.sharedMesh.vertexCount;
                }
            }
            Assert.That(meshCount, Is.GreaterThan(0), id);
            Assert.That(materialCount, Is.GreaterThan(0), id);

            var animator = prefab.GetComponentInChildren<Animator>(true);
            Assert.That(animator, Is.Not.Null, id);
            Assert.That(
                animator.runtimeAnimatorController,
                Is.Not.Null,
                id);
            var controller = animator.runtimeAnimatorController as AnimatorController;
            Assert.That(controller, Is.Not.Null, id);
            var clipNames = new HashSet<string>(
                controller.animationClips.Select(clip => clip.name));
            Assert.That(clipNames, Is.SupersetOf(
                new[] { "Idle", "Move", "Attack", "Spell" }), id);
            Assert.That(
                prefab.GetComponent<LODGroup>(),
                Is.Not.Null,
                id);

            var instance = Object.Instantiate(prefab);
            try
            {
                var instanceAnimator = instance.GetComponentInChildren<Animator>(true);
                Assert.That(instanceAnimator, Is.Not.Null, id);
                instanceAnimator.Rebind();
                instanceAnimator.Update(0f);
                foreach (var stateName in new[] { "Idle", "Move", "Attack", "Spell" })
                {
                    var fullPathHash = Animator.StringToHash(
                        $"Base Layer.{stateName}");
                    Assert.That(
                        instanceAnimator.HasState(0, fullPathHash),
                        Is.True,
                        $"{id} animator is missing Base Layer.{stateName}");
                    instanceAnimator.Play(fullPathHash, 0, 0f);
                    instanceAnimator.Update(1f / 60f);
                    Assert.That(
                        instanceAnimator.GetCurrentAnimatorStateInfo(0).fullPathHash,
                        Is.EqualTo(fullPathHash),
                        $"{id} animator did not enter Base Layer.{stateName}");
                }
                var instanceRenderers = instance.GetComponentsInChildren<Renderer>(true);
                Assert.That(
                    TryCalculateBounds(instanceRenderers, out var bounds),
                    Is.True,
                    id);
                Assert.That(bounds.size.y, Is.EqualTo(expectedHeight).Within(0.08f), id);
                Assert.That(bounds.min.y, Is.EqualTo(0f).Within(0.08f), id);
                Assert.That(
                    bounds.size.x + bounds.size.z,
                    Is.GreaterThan(0.02f),
                    id);
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        private static bool TryCalculateBounds(
            Renderer[] renderers,
            out Bounds bounds)
        {
            bounds = default;
            var hasBounds = false;
            foreach (var renderer in renderers)
            {
                if (renderer == null || !renderer.enabled)
                {
                    continue;
                }
                if (!hasBounds)
                {
                    bounds = renderer.bounds;
                    hasBounds = true;
                }
                else
                {
                    bounds.Encapsulate(renderer.bounds);
                }
            }
            return hasBounds &&
                bounds.size.x >= 0f &&
                bounds.size.y >= 0f &&
                bounds.size.z >= 0f;
        }

        private static void AssertCatalogReference(Component presenter)
        {
            var serialized = new SerializedObject(presenter);
            var property = serialized.FindProperty("modelVisualCatalog");
            Assert.That(property, Is.Not.Null);
            Assert.That(property.objectReferenceValue, Is.Not.Null);
        }
    }
}
