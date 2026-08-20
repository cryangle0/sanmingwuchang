using System.Collections.Generic;
using Jwgb.Sim.Deterministic;
using Unity.Collections;
using Unity.Entities;

namespace Jwgb.Netcode
{
    /// <summary>
    /// PVE half of the server ghost projection: monsters, loot drops and
    /// shop pads mirrored from the authoritative WorldSnapshot into the
    /// reduced-rate PVE ghost prefabs.
    /// </summary>
    public partial class MatchGhostSnapshotSystem
    {
        private readonly HashSet<string> activeShopIds =
            new HashSet<string>(System.StringComparer.Ordinal);
        private readonly List<string> removedShopIds =
            new List<string>();

        private void SyncMonsters(
            WorldSnapshot snapshot,
            Entity prefab)
        {
            activeIds.Clear();
            for (var index = 0;
                index < snapshot.Monsters.Length;
                index += 1)
            {
                var value = snapshot.Monsters[index];
                activeIds.Add(value.EntityId);
                var entity = GetOrCreate(
                    monsters,
                    value.EntityId,
                    prefab);
                EntityManager.SetComponentData(
                    entity,
                    new MatchMonsterGhostState
                    {
                        SnapshotTick = snapshot.Tick,
                        EntityId = value.EntityId,
                        Kind = new FixedString32Bytes(
                            value.Kind ?? string.Empty),
                        Element = new FixedString32Bytes(
                            value.Element ?? string.Empty),
                        PositionX = value.Position.X,
                        PositionZ = value.Position.Z,
                        FacingX = value.Facing.X,
                        FacingZ = value.Facing.Z,
                        Hp = value.Hp,
                        MaxHp = value.MaxHp
                    });
            }
            RemoveInactive(monsters);
        }

        private void SyncLoot(
            WorldSnapshot snapshot,
            Entity prefab)
        {
            activeIds.Clear();
            for (var index = 0;
                index < snapshot.LootDrops.Length;
                index += 1)
            {
                var value = snapshot.LootDrops[index];
                activeIds.Add(value.EntityId);
                var entity = GetOrCreate(
                    lootDrops,
                    value.EntityId,
                    prefab);
                EntityManager.SetComponentData(
                    entity,
                    new MatchLootGhostState
                    {
                        SnapshotTick = snapshot.Tick,
                        EntityId = value.EntityId,
                        PositionX = value.Position.X,
                        PositionZ = value.Position.Z,
                        Gold = value.Gold,
                        Experience = value.Experience,
                        Gems = value.Gems,
                        EquipmentId = ToFixed64(value.EquipmentId),
                        BookPassiveId =
                            ToFixed64(value.BookPassiveId),
                        CreatedAtTick = value.CreatedAtTick,
                        ExpiresAtTick = value.ExpiresAtTick,
                        Kind = new FixedString32Bytes(
                            value.Kind ?? string.Empty),
                        ActiveId = ToFixed64(value.ActiveId),
                        HasEquipmentInstanceId =
                            value.EquipmentInstanceId.HasValue,
                        EquipmentInstanceId =
                            value.EquipmentInstanceId ?? 0,
                        HasAcquiredAtTick =
                            value.AcquiredAtTick.HasValue,
                        AcquiredAtTick =
                            value.AcquiredAtTick ?? 0,
                        PermanentAttackBonus =
                            value.PermanentAttackBonus,
                        HasStormCoveredSinceTick =
                            value.StormCoveredSinceTick.HasValue,
                        StormCoveredSinceTick =
                            value.StormCoveredSinceTick ?? 0
                    });
            }
            RemoveInactive(lootDrops);
        }

        private void SyncShops(
            WorldSnapshot snapshot,
            Entity prefab)
        {
            activeShopIds.Clear();
            for (var index = 0;
                index < snapshot.Shops.Length;
                index += 1)
            {
                var value = snapshot.Shops[index];
                activeShopIds.Add(value.ShopId);
                if (!shops.TryGetValue(
                        value.ShopId,
                        out var entity) ||
                    !EntityManager.Exists(entity))
                {
                    entity = EntityManager.Instantiate(prefab);
                    EntityManager.SetName(
                        entity,
                        $"JWGB Replicated Shop {value.ShopId}");
                    shops[value.ShopId] = entity;
                }
                EntityManager.SetComponentData(
                    entity,
                    new MatchShopGhostState
                    {
                        SnapshotTick = snapshot.Tick,
                        ShopId = ToFixed64(value.ShopId),
                        Kind = new FixedString32Bytes(
                            value.Kind ?? string.Empty),
                        PositionX = value.Position.X,
                        PositionZ = value.Position.Z,
                        OpenAtTick = value.OpenAtTick,
                        CloseAtTick = value.CloseAtTick,
                        AnchorId = ToFixed64(value.AnchorId),
                        MacroId = ToFixed64(value.MacroId),
                        Version = value.Version,
                        Status = new FixedString32Bytes(
                            value.Status ?? string.Empty),
                        NextRelocationAttemptTick =
                            value.NextRelocationAttemptTick
                    });
                SyncShopListings(entity, value);
            }

            removedShopIds.Clear();
            foreach (var pair in shops)
            {
                if (!activeShopIds.Contains(pair.Key))
                {
                    if (EntityManager.Exists(pair.Value))
                    {
                        EntityManager.DestroyEntity(pair.Value);
                    }
                    removedShopIds.Add(pair.Key);
                }
            }
            for (var index = 0;
                index < removedShopIds.Count;
                index += 1)
            {
                shops.Remove(removedShopIds[index]);
            }
        }

        private void SyncShopListings(
            Entity entity,
            ShopSnapshot snapshot)
        {
            var listings =
                EntityManager.GetBuffer<MatchShopListingGhost>(
                    entity);
            listings.Clear();
            for (var index = 0;
                index < snapshot.Inventory.Length;
                index += 1)
            {
                var listing = snapshot.Inventory[index];
                listings.Add(
                    new MatchShopListingGhost
                    {
                        ListingId = ToFixed64(listing.ListingId),
                        Kind = new FixedString32Bytes(
                            listing.Kind ?? string.Empty),
                        EquipmentId =
                            ToFixed64(listing.EquipmentId),
                        ConsumableId =
                            ToFixed64(listing.ConsumableId),
                        Price = listing.Price
                    });
            }
        }
    }
}
