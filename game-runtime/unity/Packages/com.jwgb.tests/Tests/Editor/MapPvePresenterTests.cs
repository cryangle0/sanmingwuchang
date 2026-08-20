using Jwgb.Client;
using Jwgb.Client.Presentation;
using NUnit.Framework;
using UnityEngine;

namespace Jwgb.Tests
{
    public sealed class MapPvePresenterTests
    {
        [Test]
        public void PresenterViewCountsMatchSnapshotEntityCounts()
        {
            var session = new LocalMatchSession(
                20260803,
                8,
                null,
                mapEnabled: true,
                pveEnabled: true);
            var command = new LocalMatchCommand(
                1_000,
                0,
                1_000,
                0,
                attack: true,
                castActive: false);
            for (var tick = 0; tick < 40; tick += 1)
            {
                session.Step(command);
            }

            var presenterObject = new GameObject(
                "Map PVE Presenter Test");
            try
            {
                var presenter = presenterObject
                    .AddComponent<MatchPveEntityPresenter>();
                presenter.Apply(session.Snapshot);

                Assert.That(
                    presenter.MonsterViewCount,
                    Is.EqualTo(session.Snapshot.Monsters.Length));
                Assert.That(
                    presenter.LootViewCount,
                    Is.EqualTo(session.Snapshot.LootDrops.Length));
                Assert.That(
                    presenter.ShopViewCount,
                    Is.EqualTo(session.Snapshot.Shops.Length));

                // Re-applying the same snapshot must keep the pools
                // stable instead of duplicating views.
                presenter.Apply(session.Snapshot);
                Assert.That(
                    presenter.MonsterViewCount,
                    Is.EqualTo(session.Snapshot.Monsters.Length));
            }
            finally
            {
                Object.DestroyImmediate(presenterObject);
            }
        }

        [Test]
        public void MapEnvironmentViewBuildsSevenRenderGroups()
        {
            var view = new MapEnvironmentView(
                MapMeshBuilder.Build(),
                null,
                null,
                null,
                null,
                null,
                null,
                null);
            try
            {
                Assert.That(
                    view.Root
                        .GetComponentsInChildren<MeshRenderer>(true)
                        .Length,
                    Is.EqualTo(7));
            }
            finally
            {
                view.Dispose();
            }
        }
    }
}
