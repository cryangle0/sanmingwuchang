using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class StateHashValues
    {
        public static object BuildShops(SimulationState state)
        {
            var values = new List<object>(state.Shops.Count);
            foreach (var shop in state.Shops.Values)
            {
                var inventory = new List<object>(shop.Inventory.Count);
                for (var index = 0; index < shop.Inventory.Count; index += 1)
                {
                    var listing = shop.Inventory[index];
                    var entry = new Dictionary<string, object>
                    {
                        ["listingId"] = listing.ListingId,
                        ["kind"] = listing.Kind,
                        ["equipmentId"] = listing.EquipmentId,
                        ["price"] = listing.Price
                    };
                    if (listing.ConsumableId != null)
                    {
                        entry["consumableId"] = listing.ConsumableId;
                    }

                    inventory.Add(entry);
                }

                values.Add(
                    new Dictionary<string, object>
                    {
                        ["shopId"] = shop.ShopId,
                        ["kind"] = shop.Kind,
                        ["position"] = StateHashBuilder.BuildVector(
                            shop.Position.X,
                            shop.Position.Z),
                        ["anchorId"] = shop.AnchorId,
                        ["macroId"] = shop.MacroId,
                        ["openAtTick"] = shop.OpenAtTick,
                        ["closeAtTick"] = shop.CloseAtTick,
                        ["version"] = shop.Version,
                        ["status"] = shop.Status,
                        ["nextRelocationAttemptTick"] =
                            shop.NextRelocationAttemptTick,
                        ["inventory"] = inventory
                    });
            }

            return values;
        }

        public static object BuildPlayerHistoryFrames(SimulationState state)
        {
            var frames = new List<PlayerHistoryFrame>(
                state.PlayerHistoryFrames);
            frames.Sort(
                (left, right) =>
                {
                    var result = left.EntityId.CompareTo(right.EntityId);
                    return result != 0
                        ? result
                        : left.Tick.CompareTo(right.Tick);
                });
            var values = new List<object>(frames.Count);
            for (var index = 0; index < frames.Count; index += 1)
            {
                var frame = frames[index];
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = frame.EntityId,
                        ["tick"] = frame.Tick,
                        ["position"] = StateHashBuilder.BuildVector(
                            frame.Position.X,
                            frame.Position.Z),
                        ["hp"] = frame.Hp
                    });
            }

            return values;
        }

        public static object BuildAirdrops(SimulationState state)
        {
            var airdrops = new List<AirdropState>(state.Airdrops.Values);
            airdrops.Sort(
                (left, right) => left.Sequence.CompareTo(right.Sequence));
            var values = new List<object>(airdrops.Count);
            for (var index = 0; index < airdrops.Count; index += 1)
            {
                var airdrop = airdrops[index];
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["id"] = airdrop.Id,
                        ["sequence"] = airdrop.Sequence,
                        ["scheduledElapsedTick"] =
                            airdrop.ScheduledElapsedTick,
                        ["phase"] = airdrop.Phase,
                        ["position"] = airdrop.Position.HasValue
                            ? StateHashBuilder.BuildVector(
                                airdrop.Position.Value.X,
                                airdrop.Position.Value.Z)
                            : null,
                        ["announcedAtTick"] = airdrop.AnnouncedAtTick,
                        ["landedAtTick"] = airdrop.LandedAtTick,
                        ["expiresAtTick"] = airdrop.ExpiresAtTick,
                        ["openedAtTick"] = airdrop.OpenedAtTick,
                        ["openedByEntityId"] = airdrop.OpenedByEntityId,
                        ["equipmentId"] = airdrop.EquipmentId,
                        ["lootEntityId"] = airdrop.LootEntityId
                    });
            }

            return values;
        }

        public static object BuildAirdropChannels(
            SimulationState state)
        {
            var channels = new List<AirdropChannelState>(
                state.AirdropChannels.Values);
            channels.Sort(
                (left, right) =>
                {
                    var result = left.Sequence.CompareTo(
                        right.Sequence);
                    return result != 0
                        ? result
                        : left.PlayerEntityId.CompareTo(
                            right.PlayerEntityId);
                });
            var values = new List<object>(channels.Count);
            for (var index = 0; index < channels.Count; index += 1)
            {
                var channel = channels[index];
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["sequence"] = channel.Sequence,
                        ["playerEntityId"] =
                            channel.PlayerEntityId,
                        ["airdropId"] = channel.AirdropId,
                        ["startedAtTick"] = channel.StartedAtTick,
                        ["completesAtTick"] =
                            channel.CompletesAtTick,
                        ["originPosition"] =
                            StateHashBuilder.BuildVector(
                                channel.OriginPosition.X,
                                channel.OriginPosition.Z)
                    });
            }

            return values;
        }

        public static object BuildWindWalls(SimulationState state)
        {
            var values = new List<object>(state.WindWalls.Count);
            foreach (var wall in state.WindWalls.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = wall.EntityId,
                        ["ownerEntityId"] = wall.OwnerEntityId,
                        ["center"] = StateHashBuilder.BuildVector(
                            wall.Center.X,
                            wall.Center.Z),
                        ["direction"] = StateHashBuilder.BuildVector(
                            wall.Direction.X,
                            wall.Direction.Z),
                        ["lengthMm"] = wall.LengthMm,
                        ["remainingTicks"] = wall.RemainingTicks
                    });
            }

            return values;
        }

        public static object BuildProjectiles(SimulationState state)
        {
            var values = new List<object>(state.Projectiles.Count);
            foreach (var projectile in state.Projectiles.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = projectile.EntityId,
                        ["kind"] = projectile.Kind,
                        ["ownerEntityId"] = projectile.OwnerEntityId,
                        ["targetEntityId"] = projectile.TargetEntityId,
                        ["position"] = StateHashBuilder.BuildVector(
                            projectile.Position.X,
                            projectile.Position.Z),
                        ["speedMmPerSecond"] =
                            projectile.SpeedMmPerSecond,
                        ["collisionRadiusMm"] =
                            projectile.CollisionRadiusMm,
                        ["sourceElement"] =
                            SimulationText.Element(
                                projectile.SourceElement),
                        ["baseDamage"] = projectile.BaseDamage,
                        ["outgoingDamageBasisPoints"] =
                            projectile.OutgoingDamageBasisPoints,
                        ["createdAtTick"] = projectile.CreatedAtTick,
                        ["remainingTravelMm"] =
                            projectile.RemainingTravelMm,
                        ["movementRemainder"] =
                            projectile.MovementRemainder
                    });
            }

            return values;
        }
    }
}
