using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of loot expiry and collectNearbyLoot from
    /// packages/sim/src/systems/pve.ts.
    /// </summary>
    internal static class LootSystem
    {
        private const int PickupRadiusMm = 2_500;

        public static bool CanUseWorldResources(PlayerState player)
        {
            return player.LifeState == LifeState.Alive &&
                player.WorldInteractionLockTicks <= 0 &&
                player.IceCoffinTicks <= 0 &&
                player.HardControlTicks <= 0 &&
                player.PolymorphTicks <= 0;
        }

        public static int EquipmentHandCapacity(PlayerState player)
        {
            return MonsterDamageSystem.HasEquipment(
                player,
                Jwgb.Content.GameplayIds.ClothBag)
                ? 2
                : 1;
        }

        public static void Expire(
            SimulationState state,
            List<SimEvent> events)
        {
            var drops = new List<LootDropState>(state.LootDrops.Values);
            for (var index = 0; index < drops.Count; index += 1)
            {
                var drop = drops[index];
                var persistent = drop.HasRuntimeFields &&
                    LootRuntime.IsPersistentKind(drop.Kind);
                if (!persistent)
                {
                    if (drop.ExpiresAtTick <= state.Tick)
                    {
                        state.LootDrops.Remove(drop.EntityId);
                        events.Add(
                            new SimEvent
                            {
                                Type = "loot-expired",
                                Tick = state.Tick,
                                EntityId = drop.EntityId
                            });
                    }

                    continue;
                }

                var covered = state.Tick >=
                    1_200 * SimulationConstants.TicksPerSecond ||
                    StormZoneSystem.IsInNormalStormZone(
                        state,
                        drop.Position);
                if (covered)
                {
                    var coveredSince =
                        drop.StormCoveredSinceTick ?? state.Tick;
                    if (state.Tick - coveredSince >=
                        LootRuntime.StormGraceTicks)
                    {
                        state.LootDrops.Remove(drop.EntityId);
                        ActiveReplacementSystem.ClearPendingForLoot(
                            state,
                            events,
                            drop.EntityId);
                        EquipmentLootPickupSystem.ClearPendingForLoot(
                            state,
                            events,
                            drop.EntityId);
                        events.Add(
                            new SimEvent
                            {
                                Type = "loot-expired",
                                Tick = state.Tick,
                                EntityId = drop.EntityId
                            });
                    }
                    else
                    {
                        drop.StormCoveredSinceTick = coveredSince;
                    }
                }
                else
                {
                    drop.StormCoveredSinceTick = null;
                }
            }
        }

        public static void CollectNearby(
            SimulationState state,
            List<SimEvent> events)
        {
            foreach (var player in state.Players.Values)
            {
                if (!player.Intent.Interact ||
                    !CanUseWorldResources(player))
                {
                    continue;
                }

                var drop = FindNearest(state, player);
                if (drop == null)
                {
                    continue;
                }

                Collect(state, events, player, drop);
            }
        }

        private static LootDropState FindNearest(
            SimulationState state,
            PlayerState player)
        {
            LootDropState best = null;
            var bestDistance = long.MaxValue;
            foreach (var drop in state.LootDrops.Values)
            {
                if (drop.ExpiresAtTick <= state.Tick)
                {
                    continue;
                }

                var distance = IntegerMath.DistanceSquared(
                    player.Position,
                    drop.Position);
                if (distance > (long)PickupRadiusMm * PickupRadiusMm)
                {
                    continue;
                }

                if (!LineOfSightSystem.HasDirectLineOfSight(
                        state,
                        player.Position,
                        drop.Position))
                {
                    continue;
                }

                if (distance < bestDistance ||
                    (distance == bestDistance &&
                     (best == null || drop.EntityId < best.EntityId)))
                {
                    best = drop;
                    bestDistance = distance;
                }
            }

            return best;
        }

        private static void Collect(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            LootDropState drop)
        {
            if (drop.BookPassiveId != null ||
                (drop.HasRuntimeFields && drop.Kind == "skill-book"))
            {
                if (drop.BookPassiveId == null ||
                    !PassiveTransactionSystem.ApplySkillBook(
                        state,
                        events,
                        player,
                        drop.BookPassiveId))
                {
                    return;
                }

                state.LootDrops.Remove(drop.EntityId);
                events.Add(
                    new SimEvent
                    {
                        Type = "loot-collected",
                        Tick = state.Tick,
                        EntityId = drop.EntityId,
                        SourceEntityId = player.EntityId
                    });
                return;
            }

            if (drop.HasRuntimeFields && drop.ActiveId != null)
            {
                ActiveReplacementSystem.Request(
                    state,
                    events,
                    player,
                    drop);
                return;
            }

            if (drop.EquipmentId != null)
            {
                if (player.InventoryEquipment.Count >=
                    EquipmentHandCapacity(player))
                {
                    EquipmentLootPickupSystem.Request(
                        state,
                        events,
                        player,
                        drop);
                }
                else
                {
                    EquipmentLootPickupSystem.PickupResult(
                        state,
                        events,
                        player.EntityId,
                        drop.EntityId,
                        "inventory",
                        null);
                }

                return;
            }

            state.LootDrops.Remove(drop.EntityId);
            var collectedGold = EquipmentEconomySystem.GrantGeneratedGold(
                player,
                drop.Gold);
            EquipmentEconomySystem.GrantExperience(player, drop.Experience);
            player.Gems += drop.Gems;
            events.Add(
                new SimEvent
                {
                    Type = "loot-collected",
                    Tick = state.Tick,
                    EntityId = drop.EntityId,
                    SourceEntityId = player.EntityId,
                    Amount = collectedGold
                });
        }
    }
}
