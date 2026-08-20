using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of the taibai hero-swap sections from
    /// packages/sim/src/systems/shop.ts.
    /// </summary>
    internal static partial class ShopSystem
    {
        private const int TaibaiPrice = 1_500;
        private const int TaibaiChannelTicks =
            3 * SimulationConstants.TicksPerSecond;
        private const int TaibaiCooldownTicksTotal =
            120 * SimulationConstants.TicksPerSecond;
        private const int TaibaiTetherRadiusMm = 3_000;
        private const int ShopInteractionRadiusMm = 2_500;

        private static bool IsWithinTaibaiTether(
            PlayerState player,
            ShopState shop)
        {
            return IntegerMath.DistanceSquared(
                    player.Position,
                    shop.Position) <=
                (long)TaibaiTetherRadiusMm * TaibaiTetherRadiusMm;
        }

        private static void CancelHeroSwapChannel(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            string reason)
        {
            var targetHeroId = player.TaibaiTargetHeroId;
            if (player.TaibaiChannelTicks <= 0 || targetHeroId == null)
            {
                return;
            }

            player.TaibaiChannelTicks = 0;
            player.TaibaiTargetHeroId = null;
            player.WorldInteractionLockTicks = 0;
            events.Add(
                new SimEvent
                {
                    Type = "hero-swap-channel",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    HeroId = targetHeroId,
                    Outcome = "cancelled",
                    Reason = reason
                });
        }

        public static void CancelHeroSwapIfOutsideTether(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            if (player.TaibaiChannelTicks <= 0)
            {
                return;
            }

            state.Shops.TryGetValue(ShopCatalog.Taibai, out var shop);
            if (shop == null ||
                shop.Status != "open" ||
                !IsWithinTaibaiTether(player, shop))
            {
                CancelHeroSwapChannel(state, events, player, "left-tether");
            }
        }

        public static void CancelHeroSwapOnDamage(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            CancelHeroSwapChannel(state, events, player, "damaged");
        }

        private static void CompleteHeroSwap(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            var targetHeroId = player.TaibaiTargetHeroId;
            if (targetHeroId == null)
            {
                return;
            }

            player.Gold -= TaibaiPrice;
            HeroAssignmentSystem.Apply(
                state,
                events,
                player,
                targetHeroId,
                preserveHealthRatio: true);
            player.TaibaiChannelTicks = 0;
            player.TaibaiTargetHeroId = null;
            player.TaibaiCooldownTicks = TaibaiCooldownTicksTotal;
            player.WorldInteractionLockTicks = 0;
            events.Add(
                new SimEvent
                {
                    Type = "hero-swap-channel",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    HeroId = targetHeroId,
                    Outcome = "completed",
                    Amount = TaibaiPrice
                });
        }

        private static bool IsAtShop(
            SimulationState state,
            PlayerState player,
            ShopState shop)
        {
            return IntegerMath.DistanceSquared(
                    player.Position,
                    shop.Position) <=
                (long)ShopInteractionRadiusMm * ShopInteractionRadiusMm &&
                LineOfSightSystem.HasDirectLineOfSight(
                    state,
                    player.Position,
                    shop.Position);
        }

        /// <summary>Returns the transaction code; "accepted" on success.</summary>
        public static string StartHeroSwapResult(
            SimulationState state,
            List<SimEvent> events,
            int playerEntityId,
            string shopId,
            int expectedVersion,
            string targetHeroId)
        {
            if (!state.Players.TryGetValue(playerEntityId, out var player))
            {
                throw new InvalidOperationException(
                    "unknown player " + playerEntityId);
            }

            state.Shops.TryGetValue(shopId, out var shop);
            if (shop == null || shop.Status != "open")
            {
                return "shop-unavailable";
            }

            if (shop.Version != expectedVersion)
            {
                return "shop-version-mismatch";
            }

            if (state.Tick < shop.OpenAtTick ||
                state.Tick >= shop.CloseAtTick)
            {
                return "shop-closed";
            }

            if (shop.Kind != "taibai")
            {
                return "unsupported-service-shop";
            }

            if (!LootSystem.CanUseWorldResources(player))
            {
                return "player-not-alive";
            }

            if (!IsAtShop(state, player, shop))
            {
                return "shop-too-far";
            }

            if (player.PvpCombatTicks > 0)
            {
                return "pvp-combat-lock";
            }

            if (player.TaibaiCooldownTicks > 0)
            {
                return "service-cooldown";
            }

            if (player.TaibaiChannelTicks > 0)
            {
                return "channel-active";
            }

            if (player.Gold < TaibaiPrice)
            {
                return "insufficient-gold";
            }

            HeroCatalog.Get(targetHeroId);
            player.TaibaiTargetHeroId = targetHeroId;
            player.TaibaiChannelTicks = TaibaiChannelTicks;
            player.WorldInteractionLockTicks = TaibaiChannelTicks;
            events.Add(
                new SimEvent
                {
                    Type = "hero-swap-channel",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    HeroId = targetHeroId,
                    Outcome = "started"
                });
            return "accepted";
        }
    }
}
