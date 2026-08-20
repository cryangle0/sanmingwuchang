using System;
using Jwgb.Client.Presentation;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using NUnit.Framework;
using UnityEngine.UIElements;

namespace Jwgb.Tests
{
    public sealed class MatchInteractionPanelTests
    {
        [Test]
        public void HeishanPanelOffersPurpleEquipmentWager()
        {
            var root = new VisualElement();
            var panel = new MatchInteractionPanel(root, _ => { });
            try
            {
                panel.Refresh(
                    Snapshot(
                        shops: new[]
                        {
                            new ShopSnapshot
                            {
                                ShopId = "heishan-1",
                                Kind = "heishan",
                                Position = new Int2Mm(0, 0),
                                Version = 4,
                                Status = "open"
                            }
                        }),
                    1);

                var button = FindButton(
                    root,
                    "Wager 2000 gold for purple equipment");
                Assert.That(button, Is.Not.Null);
                Assert.That(button.enabledSelf, Is.True);

                var request =
                    MatchInteractionPanel.CreateGoldGambleRequest(
                        new ShopSnapshot
                        {
                            ShopId = "heishan-1",
                            Version = 4
                        },
                        2_000,
                        "purple");
                Assert.That(
                    request.Kind,
                    Is.EqualTo(
                        SimulationTransactionKind.GambleGold));
                Assert.That(request.ShopId, Is.EqualTo("heishan-1"));
                Assert.That(request.ExpectedVersion, Is.EqualTo(4));
                Assert.That(request.WagerGold, Is.EqualTo(2_000));
                Assert.That(request.Mode, Is.EqualTo("purple"));
            }
            finally
            {
                panel.Dispose();
            }
        }

        [Test]
        public void PendingActiveReplacementAppearsWithoutNearbyShop()
        {
            var root = new VisualElement();
            var panel = new MatchInteractionPanel(root, _ => { });
            try
            {
                var snapshot = Snapshot();
                snapshot.PendingActiveReplacements = new[]
                {
                    new PendingActiveReplacementSnapshot
                    {
                        PlayerEntityId = 1,
                        LootEntityId = 72,
                        ActiveId = "active-12",
                        RequestedAtTick = 8
                    }
                };

                panel.Refresh(snapshot, 1);

                Assert.That(
                    FindButton(root, "Confirm active replacement"),
                    Is.Not.Null);
                Assert.That(
                    FindButton(root, "Keep current active ability"),
                    Is.Not.Null);
            }
            finally
            {
                panel.Dispose();
            }
        }

        private static WorldSnapshot Snapshot(
            ShopSnapshot[] shops = null)
        {
            return new WorldSnapshot
            {
                Tick = 10,
                Players = new[]
                {
                    new PlayerSnapshot
                    {
                        EntityId = 1,
                        Position = new Int2Mm(0, 0),
                        Gold = 2_500,
                        LifeState = LifeState.Alive
                    }
                },
                Shops = shops ?? Array.Empty<ShopSnapshot>()
            };
        }

        private static Button FindButton(
            VisualElement root,
            string tooltip)
        {
            if (root is Button button &&
                button.tooltip == tooltip)
            {
                return button;
            }
            for (var index = 0; index < root.childCount; index += 1)
            {
                var found = FindButton(
                    root.ElementAt(index),
                    tooltip);
                if (found != null)
                {
                    return found;
                }
            }
            return null;
        }
    }
}
