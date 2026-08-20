using Jwgb.Client.Presentation;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Jwgb.Tests
{
    public sealed class ModelViewRebuildTests
    {
        [Test]
        public void PlayerViewRebuildsWhenHeroChangesForTheSameEntity()
        {
            var presenterObject = new GameObject("Player View Rebuild Test");
            try
            {
                var presenter =
                    presenterObject.AddComponent<LocalMatchPresenter>();
                presenter.ApplySnapshotForTesting(
                    PlayerSnapshot("H001"));
                var first = presenter.GetPlayerViewForTesting(1);

                presenter.ApplySnapshotForTesting(
                    PlayerSnapshot("H009"));
                var second = presenter.GetPlayerViewForTesting(1);

                Assert.That(first, Is.Not.Null);
                Assert.That(second, Is.Not.Null);
                Assert.That(second, Is.Not.SameAs(first));
                Assert.That(second.HeroId, Is.EqualTo("H009"));
                Assert.That(presenter.PlayerViewCount, Is.EqualTo(1));
            }
            finally
            {
                Object.DestroyImmediate(presenterObject);
            }
        }

        [Test]
        public void MonsterViewRebuildsWhenRootSeedChangesItsModel()
        {
            var presenterObject = new GameObject("Monster View Rebuild Test");
            try
            {
                var presenter =
                    presenterObject.AddComponent<MatchPveEntityPresenter>();
                var serialized = new SerializedObject(presenter);
                serialized.FindProperty("modelVisualCatalog")
                    .objectReferenceValue =
                    AssetDatabase.LoadAssetAtPath<ModelVisualCatalog>(
                        ModelVisualCatalog.AssetPath);
                serialized.ApplyModifiedPropertiesWithoutUndo();

                presenter.Apply(MonsterSnapshot(0));
                var first = presenter.GetMonsterViewForTesting(123);

                presenter.Apply(MonsterSnapshot(1));
                var second = presenter.GetMonsterViewForTesting(123);

                Assert.That(first, Is.Not.Null);
                Assert.That(second, Is.Not.Null);
                Assert.That(second, Is.Not.SameAs(first));
                Assert.That(first.VisualIdentity, Is.EqualTo("M027"));
                Assert.That(second.VisualIdentity, Is.EqualTo("M028"));
                Assert.That(presenter.MonsterViewCount, Is.EqualTo(1));
            }
            finally
            {
                Object.DestroyImmediate(presenterObject);
            }
        }

        private static WorldSnapshot PlayerSnapshot(string heroId)
        {
            return new WorldSnapshot
            {
                Tick = 1,
                Players = new[]
                {
                    new PlayerSnapshot
                    {
                        EntityId = 1,
                        HeroId = heroId,
                        Position = new Int2Mm(0, 0),
                        Facing = new Int2Mm(0, 1_000),
                        Hp = 100,
                        MaxHp = 100,
                        LifeState = LifeState.Alive,
                        Intent = PlayerIntent.Neutral()
                    }
                }
            };
        }

        private static WorldSnapshot MonsterSnapshot(uint rootSeed)
        {
            return new WorldSnapshot
            {
                Tick = 1,
                RootSeed = rootSeed,
                Monsters = new[]
                {
                    new MonsterSnapshot
                    {
                        EntityId = 123,
                        Kind = "core-boss",
                        Position = new Int2Mm(0, 0),
                        HomePosition = new Int2Mm(0, 0),
                        Facing = new Int2Mm(0, 1_000),
                        Hp = 1_000,
                        MaxHp = 1_000,
                        CollisionRadiusMm = 2_000
                    }
                }
            };
        }
    }
}
