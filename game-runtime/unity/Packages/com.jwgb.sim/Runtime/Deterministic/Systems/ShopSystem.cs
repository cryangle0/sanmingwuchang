using System;
using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of syncShops/advanceShops from
    /// packages/sim/src/systems/shop.ts (no active ability walls in the
    /// deterministic slice). Purchase and hero-swap transactions are
    /// outside the deterministic fixture slice.
    /// </summary>
    internal static partial class ShopSystem
    {
        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            Sync(state, events);
            foreach (var player in state.Players.Values)
            {
                player.TaibaiCooldownTicks = Math.Max(
                    0,
                    player.TaibaiCooldownTicks - 1);
            }

            AdvanceHeroSwapChannels(state, events);
        }

        public static void Sync(
            SimulationState state,
            List<SimEvent> events)
        {
            if (state.Tick >= ShopCatalog.PermanentCloseTick ||
                state.StormZone.RadiusMm <= 0)
            {
                for (var index = 0;
                    index < ShopCatalog.Specs.Length;
                    index += 1)
                {
                    CloseShop(
                        state,
                        events,
                        ShopCatalog.Specs[index],
                        "safe-radius-zero");
                }

                return;
            }

            for (var index = 0; index < ShopCatalog.Specs.Length; index += 1)
            {
                var spec = ShopCatalog.Specs[index];
                var shopWindow = WindowAtTick(spec, state.Tick);
                state.Shops.TryGetValue(spec.ShopId, out var current);
                if (!shopWindow.HasValue)
                {
                    CloseShop(state, events, spec, "schedule-ended");
                    continue;
                }

                var version = VersionForWindow(spec, shopWindow.Value);
                if (current == null ||
                    current.Version != version ||
                    current.OpenAtTick != shopWindow.Value.OpenAtTick ||
                    current.CloseAtTick != shopWindow.Value.CloseAtTick)
                {
                    if (current != null)
                    {
                        CloseShop(state, events, spec, "schedule-ended");
                    }

                    StartShopWindow(
                        state,
                        events,
                        spec,
                        shopWindow.Value,
                        current);
                    continue;
                }

                if (current.Status == "relocating")
                {
                    if (state.Tick >= current.NextRelocationAttemptTick)
                    {
                        RetryShopRelocation(
                            state,
                            events,
                            spec,
                            shopWindow.Value,
                            current);
                    }

                    continue;
                }

                if (!CurrentPlacementIsLegal(
                        state,
                        spec,
                        shopWindow.Value,
                        current))
                {
                    events.Add(
                        new SimEvent
                        {
                            Type = "shop-closed",
                            Tick = state.Tick
                        });
                    current.Status = "relocating";
                    current.NextRelocationAttemptTick =
                        state.Tick + ShopCatalog.RelocationRetryTicks;
                    EmitShopRelocating(state, events, current);
                }
            }
        }

        private static void AdvanceHeroSwapChannels(
            SimulationState state,
            List<SimEvent> events)
        {
            state.Shops.TryGetValue(ShopCatalog.Taibai, out var shop);
            foreach (var player in state.Players.Values)
            {
                if (player.TaibaiChannelTicks <= 0)
                {
                    continue;
                }

                if (player.LifeState != LifeState.Alive ||
                    player.Gold < TaibaiPrice)
                {
                    CancelHeroSwapChannel(
                        state,
                        events,
                        player,
                        "player-unavailable");
                    continue;
                }

                if (shop == null ||
                    shop.Status != "open" ||
                    !IsWithinTaibaiTether(player, shop))
                {
                    CancelHeroSwapChannel(
                        state,
                        events,
                        player,
                        "shop-unavailable");
                    continue;
                }

                player.TaibaiChannelTicks -= 1;
                player.WorldInteractionLockTicks = Math.Max(
                    player.WorldInteractionLockTicks,
                    player.TaibaiChannelTicks);
                if (player.TaibaiChannelTicks == 0)
                {
                    CompleteHeroSwap(state, events, player);
                }
            }
        }

        private static ShopWindow? WindowAtTick(ShopSpec spec, int tick)
        {
            for (var index = 0; index < spec.Windows.Length; index += 1)
            {
                var shopWindow = spec.Windows[index];
                if (tick >= shopWindow.OpenAtTick &&
                    tick < shopWindow.CloseAtTick)
                {
                    return shopWindow;
                }
            }

            return null;
        }

        private static int VersionForWindow(
            ShopSpec spec,
            ShopWindow shopWindow)
        {
            for (var index = 0; index < spec.Windows.Length; index += 1)
            {
                if (spec.Windows[index].OpenAtTick ==
                    shopWindow.OpenAtTick &&
                    spec.Windows[index].CloseAtTick ==
                    shopWindow.CloseAtTick)
                {
                    return index + 1;
                }
            }

            return 0;
        }

        private static void CloseShop(
            SimulationState state,
            List<SimEvent> events,
            ShopSpec spec,
            string reason)
        {
            if (!state.Shops.TryGetValue(spec.ShopId, out var current))
            {
                return;
            }

            _ = current;
            _ = reason;
            state.Shops.Remove(spec.ShopId);
            events.Add(
                new SimEvent
                {
                    Type = "shop-closed",
                    Tick = state.Tick
                });
        }

        private static void StartShopWindow(
            SimulationState state,
            List<SimEvent> events,
            ShopSpec spec,
            ShopWindow shopWindow,
            ShopState previous)
        {
            var version = VersionForWindow(spec, shopWindow);
            var placement = SelectPlacement(
                state,
                spec,
                shopWindow,
                IsTerminalWindow(spec, shopWindow)
                    ? null
                    : previous?.AnchorId);
            if (placement != null)
            {
                OpenShopAtPlacement(
                    state,
                    events,
                    spec,
                    shopWindow,
                    version,
                    placement,
                    null);
                return;
            }

            var oldPlacement = previous != null
                ? PlacementFromShop(previous)
                : null;
            if (oldPlacement != null &&
                !IsTerminalWindow(spec, shopWindow) &&
                RegularPlacementIsLegal(
                    state,
                    spec,
                    shopWindow,
                    oldPlacement,
                    true))
            {
                OpenShopAtPlacement(
                    state,
                    events,
                    spec,
                    shopWindow,
                    version,
                    oldPlacement,
                    null);
                return;
            }

            CreateRelocatingShop(
                state,
                events,
                spec,
                shopWindow,
                version,
                previous);
        }

        private static void RetryShopRelocation(
            SimulationState state,
            List<SimEvent> events,
            ShopSpec spec,
            ShopWindow shopWindow,
            ShopState shop)
        {
            var placement = SelectPlacement(state, spec, shopWindow, null);
            if (placement == null)
            {
                shop.NextRelocationAttemptTick =
                    state.Tick + ShopCatalog.RelocationRetryTicks;
                EmitShopRelocating(state, events, shop);
                return;
            }

            OpenShopAtPlacement(
                state,
                events,
                spec,
                shopWindow,
                shop.Version,
                placement,
                shop.Inventory);
        }

        private static void CreateRelocatingShop(
            SimulationState state,
            List<SimEvent> events,
            ShopSpec spec,
            ShopWindow shopWindow,
            int version,
            ShopState previous)
        {
            var shop = new ShopState
            {
                ShopId = spec.ShopId,
                Kind = spec.Kind,
                Position = previous?.Position ?? new Int2Mm(0, 0),
                AnchorId = previous?.AnchorId,
                MacroId = previous?.MacroId,
                OpenAtTick = shopWindow.OpenAtTick,
                CloseAtTick = shopWindow.CloseAtTick,
                Version = version,
                Status = "relocating",
                NextRelocationAttemptTick =
                    state.Tick + ShopCatalog.RelocationRetryTicks
            };
            if (previous != null && previous.Version == version)
            {
                for (var index = 0;
                    index < previous.Inventory.Count;
                    index += 1)
                {
                    shop.Inventory.Add(
                        CopyListing(previous.Inventory[index]));
                }
            }
            else
            {
                shop.Inventory.AddRange(
                    ShopInventoryFactory.Build(
                        state,
                        spec.Kind,
                        spec.ShopId,
                        version,
                        shopWindow.OpenAtTick));
            }

            state.Shops[spec.ShopId] = shop;
            EmitShopRelocating(state, events, shop);
        }

        private static void OpenShopAtPlacement(
            SimulationState state,
            List<SimEvent> events,
            ShopSpec spec,
            ShopWindow shopWindow,
            int version,
            ShopPlacement placement,
            List<ShopListingState> existingInventory)
        {
            var shop = new ShopState
            {
                ShopId = spec.ShopId,
                Kind = spec.Kind,
                Position = placement.Position,
                AnchorId = placement.AnchorId,
                MacroId = placement.MacroId,
                OpenAtTick = shopWindow.OpenAtTick,
                CloseAtTick = shopWindow.CloseAtTick,
                Version = version,
                Status = "open",
                NextRelocationAttemptTick = 0
            };
            if (existingInventory == null)
            {
                shop.Inventory.AddRange(
                    ShopInventoryFactory.Build(
                        state,
                        spec.Kind,
                        spec.ShopId,
                        version,
                        shopWindow.OpenAtTick));
            }
            else
            {
                for (var index = 0;
                    index < existingInventory.Count;
                    index += 1)
                {
                    shop.Inventory.Add(
                        CopyListing(existingInventory[index]));
                }
            }

            state.Shops[spec.ShopId] = shop;
            events.Add(
                new SimEvent
                {
                    Type = "shop-opened",
                    Tick = state.Tick,
                    ActiveName = spec.ShopId,
                    Amount = version
                });
        }

        private static ShopListingState CopyListing(
            ShopListingState listing)
        {
            return new ShopListingState
            {
                ListingId = listing.ListingId,
                Kind = listing.Kind,
                EquipmentId = listing.EquipmentId,
                ConsumableId = listing.ConsumableId,
                Price = listing.Price
            };
        }

        private static void EmitShopRelocating(
            SimulationState state,
            List<SimEvent> events,
            ShopState shop)
        {
            _ = shop;
            events.Add(
                new SimEvent
                {
                    Type = "shop-relocating",
                    Tick = state.Tick
                });
        }

        private sealed class ShopPlacement
        {
            public ShopPlacement(
                string anchorId,
                string macroId,
                Int2Mm position)
            {
                AnchorId = anchorId;
                MacroId = macroId;
                Position = position;
            }

            public string AnchorId { get; }

            public string MacroId { get; }

            public Int2Mm Position { get; }
        }

        private static ShopPlacement PlacementFromShop(ShopState shop)
        {
            return shop.AnchorId == null || shop.MacroId == null
                ? null
                : new ShopPlacement(
                    shop.AnchorId,
                    shop.MacroId,
                    shop.Position);
        }

        private static bool IsTerminalShop(string shopId)
        {
            return shopId == ShopCatalog.LandGodA ||
                shopId == ShopCatalog.Taibai;
        }

        private static bool IsTerminalWindow(
            ShopSpec spec,
            ShopWindow shopWindow)
        {
            return IsTerminalShop(spec.ShopId) &&
                shopWindow.OpenAtTick ==
                ShopCatalog.TerminalWindowOpenTick;
        }

        private static ShopPlacement SelectPlacement(
            SimulationState state,
            ShopSpec spec,
            ShopWindow shopWindow,
            string excludedAnchorId)
        {
            if (IsTerminalWindow(spec, shopWindow) &&
                TryGetSelectedFinalCourt(state, out var court))
            {
                return SelectTerminalPlacement(
                    state,
                    spec,
                    shopWindow,
                    court);
            }

            var candidates = new List<ShopAnchor>();
            for (var index = 0;
                index < ShopCatalog.Anchors.Length;
                index += 1)
            {
                var anchor = ShopCatalog.Anchors[index];
                if (anchor.AnchorId == excludedAnchorId)
                {
                    continue;
                }

                if (RegularPlacementIsLegal(
                        state,
                        spec,
                        shopWindow,
                        new ShopPlacement(
                            anchor.AnchorId,
                            anchor.MacroId,
                            anchor.Position),
                        true))
                {
                    candidates.Add(anchor);
                }
            }

            return WeightedPlacement(state, candidates);
        }

        private static ShopPlacement WeightedPlacement(
            SimulationState state,
            List<ShopAnchor> candidates)
        {
            if (candidates.Count == 0)
            {
                return null;
            }

            var weights = new int[candidates.Count];
            long totalWeight = 0;
            for (var index = 0; index < candidates.Count; index += 1)
            {
                weights[index] = PlacementWeight(
                    state,
                    candidates[index].Position);
                totalWeight += weights[index];
            }

            var draw = (long)state.Random.Shop.NextInt(
                (ulong)totalWeight);
            for (var index = 0; index < candidates.Count; index += 1)
            {
                if (draw < weights[index])
                {
                    return ToPlacement(candidates[index]);
                }

                draw -= weights[index];
            }

            return ToPlacement(candidates[candidates.Count - 1]);
        }

        private static ShopPlacement ToPlacement(ShopAnchor anchor)
        {
            return new ShopPlacement(
                anchor.AnchorId,
                anchor.MacroId,
                anchor.Position);
        }

        private static int PlacementWeight(
            SimulationState state,
            Int2Mm position)
        {
            var nearbyPlayers = 0;
            foreach (var player in state.Players.Values)
            {
                if (player.LifeState == LifeState.Eliminated)
                {
                    continue;
                }

                if (IntegerMath.DistanceSquared(
                        player.Position,
                        position) <=
                    (long)ShopCatalog.PlayerWeightRadiusMm *
                    ShopCatalog.PlayerWeightRadiusMm)
                {
                    nearbyPlayers += 1;
                }
            }

            return Math.Min(3_000, 1_000 + (nearbyPlayers * 250));
        }

        private static bool RegularPlacementIsLegal(
            SimulationState state,
            ShopSpec spec,
            ShopWindow shopWindow,
            ShopPlacement placement,
            bool requireSafetyHorizon)
        {
            return MacroEligibleFor(spec, placement.MacroId) &&
                PointInsideSafeCircleAtTick(
                    state,
                    placement.Position,
                    state.Tick) &&
                (!requireSafetyHorizon ||
                 SafeForPlacementWindow(
                     state,
                     placement.Position,
                     shopWindow.CloseAtTick)) &&
                StaticPadIsClear(
                    state,
                    placement.Position,
                    ShopCatalog.PlacementPadRadiusMm) &&
                PlacementHasLegalSeparation(state, spec, placement);
        }

        private static bool MacroEligibleFor(ShopSpec spec, string macroId)
        {
            return spec.Kind != "taibai" ||
                ShopCatalog.TaibaiMacroIds.Contains(macroId);
        }

        private static bool PointInsideSafeCircleAtTick(
            SimulationState state,
            Int2Mm position,
            int tick)
        {
            StormZoneSystem.SafeCircleAtTick(
                state,
                tick,
                out var center,
                out var radiusMm);
            return radiusMm > 0 &&
                IntegerMath.DistanceSquared(position, center) <=
                (long)radiusMm * radiusMm;
        }

        private static bool SafeForPlacementWindow(
            SimulationState state,
            Int2Mm position,
            int closeAtTick)
        {
            var horizonTick = Math.Min(
                closeAtTick - 1,
                state.Tick + ShopCatalog.PlacementSafetyTicks);
            for (var checkTick = state.Tick;
                checkTick <= horizonTick;
                checkTick += SimulationConstants.TicksPerSecond)
            {
                if (!PointInsideSafeCircleAtTick(state, position, checkTick))
                {
                    return false;
                }
            }

            return PointInsideSafeCircleAtTick(
                state,
                position,
                horizonTick);
        }

        private static bool StaticPadIsClear(
            SimulationState state,
            Int2Mm position,
            int radiusMm)
        {
            if (state.MapField != null &&
                state.MapField.IsCircleBlocked(
                    MapCollisionAdapter.ToMapPoint(position),
                    radiusMm))
            {
                return false;
            }

            for (var index = 0; index < state.StaticSolids.Count; index += 1)
            {
                var solid = state.StaticSolids[index];
                if (position.X >= solid.MinimumX - radiusMm &&
                    position.X <= solid.MaximumX + radiusMm &&
                    position.Z >= solid.MinimumZ - radiusMm &&
                    position.Z <= solid.MaximumZ + radiusMm)
                {
                    return false;
                }
            }

            return true;
        }

        private static bool PlacementHasLegalSeparation(
            SimulationState state,
            ShopSpec spec,
            ShopPlacement placement)
        {
            foreach (var other in state.Shops.Values)
            {
                if (other.ShopId == spec.ShopId ||
                    other.Status != "open" ||
                    state.Tick < other.OpenAtTick ||
                    state.Tick >= other.CloseAtTick)
                {
                    continue;
                }

                var terminalException =
                    state.Tick >= ShopCatalog.TerminalWindowOpenTick &&
                    IsTerminalShop(spec.ShopId) &&
                    IsTerminalShop(other.ShopId);
                if (placement.MacroId == other.MacroId &&
                    !terminalException)
                {
                    return false;
                }

                if (spec.Kind == other.Kind &&
                    ShopNavigation.NavigationDistanceMm(
                        placement.Position,
                        other.Position) <
                    ShopCatalog.SameTypeMinNavDistanceMm)
                {
                    return false;
                }
            }

            return true;
        }

        private static bool CurrentPlacementIsLegal(
            SimulationState state,
            ShopSpec spec,
            ShopWindow shopWindow,
            ShopState shop)
        {
            var placement = PlacementFromShop(shop);
            if (placement == null)
            {
                return false;
            }

            if (IsTerminalWindow(spec, shopWindow) &&
                TryGetSelectedFinalCourt(state, out var court))
            {
                return TerminalPlacementIsLegal(
                    state,
                    spec,
                    placement,
                    court);
            }

            return RegularPlacementIsLegal(
                state,
                spec,
                shopWindow,
                placement,
                false);
        }
    }
}
