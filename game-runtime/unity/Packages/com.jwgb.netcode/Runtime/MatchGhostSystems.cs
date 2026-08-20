using System.Collections.Generic;
using Jwgb.Sim.Deterministic;
using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    [WorldSystemFilter(
        WorldSystemFilterFlags.ClientSimulation |
        WorldSystemFilterFlags.ThinClientSimulation |
        WorldSystemFilterFlags.ServerSimulation)]
    [CreateAfter(typeof(DefaultVariantSystemGroup))]
    [CreateBefore(typeof(GhostCollectionSystem))]
    public partial class MatchGhostPrefabRegistrationSystem : SystemBase
    {
        protected override void OnCreate()
        {
            var world = EntityManager.CreateEntity(
                typeof(MatchWorldGhostState));
            EntityManager.SetName(world, "JWGB Match World Ghost Prefab");
            EntityManager.AddBuffer<MatchPendingActiveReplacementGhost>(
                world);
            EntityManager.AddBuffer<MatchPendingEquipmentPickupGhost>(
                world);
            Convert(world, "JWGB.Match.World.v4", 200);

            var player = EntityManager.CreateEntity(
                typeof(MatchPlayerGhostState));
            EntityManager.SetName(player, "JWGB Player Ghost Prefab");
            EntityManager.AddBuffer<MatchPlayerPassiveGhost>(player);
            EntityManager.AddBuffer<MatchPlayerEquipmentGhost>(player);
            EntityManager.AddBuffer<MatchPlayerShieldGhost>(player);
            Convert(player, "JWGB.Match.Player.v3", 100);

            var projectile = EntityManager.CreateEntity(
                typeof(MatchProjectileGhostState));
            EntityManager.SetName(
                projectile,
                "JWGB Projectile Ghost Prefab");
            Convert(projectile, "JWGB.Match.Projectile.v1", 70);

            var windWall = EntityManager.CreateEntity(
                typeof(MatchWindWallGhostState));
            EntityManager.SetName(
                windWall,
                "JWGB Wind Wall Ghost Prefab");
            Convert(windWall, "JWGB.Match.WindWall.v1", 80);

            var monster = EntityManager.CreateEntity(
                typeof(MatchMonsterGhostState));
            EntityManager.SetName(
                monster,
                "JWGB Monster Ghost Prefab");
            Convert(
                monster,
                "JWGB.Match.Monster.v2",
                50,
                MatchNetworkDefaults.PveSnapshotRate);

            var loot = EntityManager.CreateEntity(
                typeof(MatchLootGhostState));
            EntityManager.SetName(loot, "JWGB Loot Ghost Prefab");
            Convert(
                loot,
                "JWGB.Match.Loot.v2",
                40,
                MatchNetworkDefaults.PveSnapshotRate);

            var shop = EntityManager.CreateEntity(
                typeof(MatchShopGhostState));
            EntityManager.SetName(shop, "JWGB Shop Ghost Prefab");
            EntityManager.AddBuffer<MatchShopListingGhost>(shop);
            Convert(
                shop,
                "JWGB.Match.Shop.v2",
                40,
                MatchNetworkDefaults.PveSnapshotRate);

            var airdrop = EntityManager.CreateEntity(
                typeof(MatchAirdropGhostState));
            EntityManager.SetName(
                airdrop,
                "JWGB Airdrop Ghost Prefab");
            Convert(
                airdrop,
                "JWGB.Match.Airdrop.v1",
                45,
                MatchNetworkDefaults.PveSnapshotRate);

            var airdropChannel = EntityManager.CreateEntity(
                typeof(MatchAirdropChannelGhostState));
            EntityManager.SetName(
                airdropChannel,
                "JWGB Airdrop Channel Ghost Prefab");
            Convert(
                airdropChannel,
                "JWGB.Match.AirdropChannel.v1",
                60);

            var singleton = EntityManager.CreateEntity(
                typeof(MatchGhostPrefabSet));
            EntityManager.SetComponentData(
                singleton,
                new MatchGhostPrefabSet
                {
                    World = world,
                    Player = player,
                    Projectile = projectile,
                    WindWall = windWall,
                    Monster = monster,
                    Loot = loot,
                    Shop = shop,
                    Airdrop = airdrop,
                    AirdropChannel = airdropChannel
                });
            MatchNetworkRuntimeState.RecordGhostRegistration();
            Enabled = false;
        }

        protected override void OnUpdate()
        {
        }

        private void Convert(
            Entity prefab,
            FixedString64Bytes name,
            int importance)
        {
            Convert(
                prefab,
                name,
                importance,
                MatchNetworkDefaults.SnapshotRate);
        }

        private void Convert(
            Entity prefab,
            FixedString64Bytes name,
            int importance,
            int maxSendRate)
        {
            GhostPrefabCreation.ConvertToGhostPrefab(
                EntityManager,
                prefab,
                new GhostPrefabCreation.Config
                {
                    Name = name,
                    Importance = importance,
                    MaxSendRate = (byte)maxSendRate,
                    SupportedGhostModes =
                        GhostModeMask.Interpolated,
                    DefaultGhostMode = GhostMode.Interpolated,
                    OptimizationMode =
                        GhostOptimizationMode.Dynamic,
                    UsePreSerialization = true
                });
        }
    }

    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    [UpdateInGroup(typeof(GhostSimulationSystemGroup))]
    public partial class MatchGhostSnapshotSystem : SystemBase
    {
        private readonly Dictionary<int, Entity> players =
            new Dictionary<int, Entity>();
        private readonly Dictionary<int, Entity> projectiles =
            new Dictionary<int, Entity>();
        private readonly Dictionary<int, Entity> windWalls =
            new Dictionary<int, Entity>();
        private readonly Dictionary<int, Entity> monsters =
            new Dictionary<int, Entity>();
        private readonly Dictionary<int, Entity> lootDrops =
            new Dictionary<int, Entity>();
        private readonly Dictionary<string, Entity> shops =
            new Dictionary<string, Entity>(
                System.StringComparer.Ordinal);
        private readonly HashSet<int> activeIds = new HashSet<int>();
        private readonly List<int> removedIds = new List<int>();
        private Entity worldState;
        private int lastSnapshotTick;

        protected override void OnCreate()
        {
            RequireForUpdate<MatchGhostPrefabSet>();
        }

        protected override void OnUpdate()
        {
            if (!MatchNetworkRuntimeState.TryGetReplicationSnapshot(
                    out var snapshot))
            {
                return;
            }
            if (snapshot.Tick < lastSnapshotTick)
            {
                lastSnapshotTick = 0;
            }
            if (snapshot.Tick <= lastSnapshotTick)
            {
                return;
            }

            lastSnapshotTick = snapshot.Tick;
            var prefabs = SystemAPI.GetSingleton<MatchGhostPrefabSet>();
            SyncWorld(snapshot, prefabs.World);
            SyncPendingTransactions(snapshot);
            SyncPlayers(snapshot, prefabs.Player);
            SyncProjectiles(snapshot, prefabs.Projectile);
            SyncWindWalls(snapshot, prefabs.WindWall);
            SyncMonsters(snapshot, prefabs.Monster);
            SyncLoot(snapshot, prefabs.Loot);
            SyncShops(snapshot, prefabs.Shop);
            SyncAirdrops(
                snapshot,
                prefabs.Airdrop,
                prefabs.AirdropChannel);
            MatchNetworkRuntimeState.RecordReplicatedGhosts(
                1,
                players.Count,
                projectiles.Count,
                windWalls.Count,
                monsters.Count,
                lootDrops.Count,
                shops.Count,
                snapshot.Tick);
        }

        private void SyncWorld(
            WorldSnapshot snapshot,
            Entity prefab)
        {
            if (worldState == Entity.Null ||
                !EntityManager.Exists(worldState))
            {
                worldState = EntityManager.Instantiate(prefab);
                EntityManager.SetName(
                    worldState,
                    "JWGB Replicated Match World");
            }

            var remaining = 0;
            for (var index = 0;
                index < snapshot.Players.Length;
                index += 1)
            {
                if (snapshot.Players[index].LifeState !=
                    LifeState.Eliminated)
                {
                    remaining += 1;
                }
            }

            EntityManager.SetComponentData(
                worldState,
                new MatchWorldGhostState
                {
                    MatchSequence =
                        MatchNetworkRuntimeState.ServerMatchSequence,
                    SnapshotTick = snapshot.Tick,
                    RootSeed = snapshot.RootSeed,
                    PlayerCount = snapshot.Players.Length,
                    RemainingCompetitors = remaining,
                    ProjectileCount = snapshot.Projectiles.Length,
                    WindWallCount = snapshot.WindWalls.Length,
                    MatchStatus = (byte)snapshot.Match.Status,
                    HasStartedAtTick =
                        snapshot.Match.StartedAtTick.HasValue,
                    StartedAtTick =
                        snapshot.Match.StartedAtTick ?? 0,
                    HasFinishedAtTick =
                        snapshot.Match.FinishedAtTick.HasValue,
                    FinishedAtTick =
                        snapshot.Match.FinishedAtTick ?? 0,
                    HasWinner =
                        snapshot.Match.WinnerEntityId.HasValue,
                    WinnerEntityId =
                        snapshot.Match.WinnerEntityId ?? 0,
                    StateHash = System.Convert.ToUInt32(
                        snapshot.StateHash,
                        16),
                    MapEnabled = !string.IsNullOrEmpty(
                        snapshot.MapGeometryHash),
                    MapGeometryHash = new FixedString32Bytes(
                        snapshot.MapGeometryHash ?? string.Empty),
                    PveEnabled = snapshot.PveEnabled,
                    MonsterCount = snapshot.Monsters.Length,
                    LootCount = snapshot.LootDrops.Length,
                    ShopCount = snapshot.Shops.Length,
                    AirdropCount = snapshot.Airdrops.Length,
                    AirdropChannelCount =
                        snapshot.AirdropChannels.Length,
                    HasStormZone = snapshot.StormZone != null,
                    StormCenterX =
                        snapshot.StormZone?.Center.X ?? 0,
                    StormCenterZ =
                        snapshot.StormZone?.Center.Z ?? 0,
                    StormRadiusMm =
                        snapshot.StormZone?.RadiusMm ?? 0,
                    StormApocalypseWarning =
                        snapshot.StormZone?.ApocalypseWarning ??
                            false,
                    StormApocalypseStarted =
                        snapshot.StormZone?.ApocalypseStarted ??
                            false
                });
        }

        private void SyncPlayers(
            WorldSnapshot snapshot,
            Entity prefab)
        {
            activeIds.Clear();
            for (var index = 0;
                index < snapshot.Players.Length;
                index += 1)
            {
                var value = snapshot.Players[index];
                activeIds.Add(value.EntityId);
                var entity = GetOrCreate(
                    players,
                    value.EntityId,
                    prefab);
                MatchNetworkRuntimeState.TryGetServerPlayerRuntime(
                    value.EntityId,
                    out var runtime);
                EntityManager.SetComponentData(
                    entity,
                    new MatchPlayerGhostState
                    {
                        SnapshotTick = snapshot.Tick,
                        EntityId = value.EntityId,
                        PlayerId = ToFixed64(value.PlayerId),
                        HeroId = ToFixed64(value.HeroId),
                        ActiveAbilityId =
                            ToFixed64(value.ActiveAbilityId),
                        PositionX = value.Position.X,
                        PositionZ = value.Position.Z,
                        FacingX = value.Facing.X,
                        FacingZ = value.Facing.Z,
                        Hp = value.Hp,
                        MaxHp = value.MaxHp,
                        AttackPower = value.AttackPower,
                        MoveSpeedMmPerSecond =
                            value.MoveSpeedMmPerSecond,
                        AttackRangeMm = value.AttackRangeMm,
                        AttacksPerSecondMilli =
                            value.AttacksPerSecondMilli,
                        LivesRemaining = value.LivesRemaining,
                        TrueDeaths = value.TrueDeaths,
                        LifeState = (byte)value.LifeState,
                        AttackCooldownTicks =
                            value.AttackCooldownTicks,
                        ActiveCooldownTicks =
                            value.ActiveCooldownTicks,
                        ActiveBuffTicks = value.ActiveBuffTicks,
                        Gold = value.Gold,
                        Experience = value.Experience,
                        Level = value.Level,
                        Gems = value.Gems,
                        WorldInteractionLockTicks =
                            value.WorldInteractionLockTicks,
                        PvpCombatTicks = value.PvpCombatTicks,
                        TaibaiChannelTicks =
                            value.TaibaiChannelTicks,
                        TaibaiTargetHeroId =
                            ToFixed64(value.TaibaiTargetHeroId),
                        TaibaiCooldownTicks =
                            value.TaibaiCooldownTicks,
                        HeishanGambleCount =
                            value.HeishanGambleCount,
                        TotalShield = value.TotalShield,
                        WhirlwindTicks = value.WhirlwindTicks,
                        B19RetriggerLockTicks =
                            value.B19RetriggerLockTicks,
                        B20ReviveBuffTicks =
                            value.B20ReviveBuffTicks,
                        InvulnerableTicks =
                            value.InvulnerableTicks,
                        IceCoffinTicks = value.IceCoffinTicks,
                        HardControlTicks =
                            runtime.HardControlTicks,
                        HasRespawnTarget =
                            runtime.RespawnTarget.HasValue,
                        RespawnTargetX =
                            runtime.RespawnTarget?.X ?? 0,
                        RespawnTargetZ =
                            runtime.RespawnTarget?.Z ?? 0,
                        ReviveProtectionTicks =
                            runtime.ReviveProtectionTicks,
                        MoveRemainderX =
                            runtime.MoveRemainderX,
                        MoveRemainderZ =
                            runtime.MoveRemainderZ,
                        LastProcessedInputSequence =
                            MatchNetworkRuntimeState
                                .GetLastProcessedInputSequence(
                                    value.EntityId),
                        B20ChargeAvailable =
                            value.B20ChargeAvailable,
                        HasNineTurnPill = value.HasNineTurnPill
                    });
                SyncPlayerBuffers(entity, value);
            }
            RemoveInactive(players);
        }

        private void SyncPlayerBuffers(
            Entity entity,
            PlayerSnapshot snapshot)
        {
            var passives =
                EntityManager.GetBuffer<MatchPlayerPassiveGhost>(
                    entity);
            passives.Clear();
            for (var index = 0;
                index < snapshot.Passives.Length;
                index += 1)
            {
                passives.Add(
                    new MatchPlayerPassiveGhost
                    {
                        PassiveId = ToFixed64(
                            snapshot.Passives[index].PassiveId),
                        Level = snapshot.Passives[index].Level
                    });
            }

            var equipment =
                EntityManager.GetBuffer<MatchPlayerEquipmentGhost>(
                    entity);
            equipment.Clear();
            for (var index = 0;
                index < snapshot.Equipment.Length;
                index += 1)
            {
                equipment.Add(
                    new MatchPlayerEquipmentGhost
                    {
                        InstanceId =
                            snapshot.Equipment[index].InstanceId,
                        EquipmentId = ToFixed64(
                            snapshot.Equipment[index].EquipmentId),
                        AcquiredAtTick =
                            snapshot.Equipment[index].AcquiredAtTick,
                        PermanentAttackBonus =
                            snapshot.Equipment[index]
                                .PermanentAttackBonus,
                        IsInventory = false
                    });
            }
            for (var index = 0;
                index < snapshot.InventoryEquipment.Length;
                index += 1)
            {
                equipment.Add(
                    new MatchPlayerEquipmentGhost
                    {
                        InstanceId =
                            snapshot.InventoryEquipment[index]
                                .InstanceId,
                        EquipmentId = ToFixed64(
                            snapshot.InventoryEquipment[index]
                                .EquipmentId),
                        AcquiredAtTick =
                            snapshot.InventoryEquipment[index]
                                .AcquiredAtTick,
                        PermanentAttackBonus =
                            snapshot.InventoryEquipment[index]
                                .PermanentAttackBonus,
                        IsInventory = true
                    });
            }

            var shields =
                EntityManager.GetBuffer<MatchPlayerShieldGhost>(
                    entity);
            shields.Clear();
            for (var index = 0;
                index < snapshot.Shields.Length;
                index += 1)
            {
                var source = snapshot.Shields[index];
                shields.Add(
                    new MatchPlayerShieldGhost
                    {
                        SourceKind = ToFixed64(source.SourceKind),
                        SourceId = ToFixed64(source.SourceId),
                        ExpiresAtTick = source.ExpiresAtTick,
                        CreationSequence =
                            source.CreationSequence,
                        Absorbs = Join(source.Absorbs),
                        HasBreakEffect =
                            source.BreakEffect != null,
                        BreakSourceEntityId =
                            source.BreakEffect?.SourceEntityId ?? 0,
                        BreakSourceElement = ToFixed64(
                            source.BreakEffect?.SourceElement),
                        BreakDamage =
                            source.BreakEffect?.Damage ?? 0,
                        BreakRadiusMm =
                            source.BreakEffect?.RadiusMm ?? 0,
                        RemainingAmount =
                            source.RemainingAmount
                    });
            }
        }

        private void SyncProjectiles(
            WorldSnapshot snapshot,
            Entity prefab)
        {
            activeIds.Clear();
            for (var index = 0;
                index < snapshot.Projectiles.Length;
                index += 1)
            {
                var value = snapshot.Projectiles[index];
                activeIds.Add(value.EntityId);
                var entity = GetOrCreate(
                    projectiles,
                    value.EntityId,
                    prefab);
                EntityManager.SetComponentData(
                    entity,
                    new MatchProjectileGhostState
                    {
                        SnapshotTick = snapshot.Tick,
                        EntityId = value.EntityId,
                        OwnerEntityId = value.OwnerEntityId,
                        TargetEntityId = value.TargetEntityId,
                        PositionX = value.Position.X,
                        PositionZ = value.Position.Z,
                        SpeedMmPerSecond =
                            value.SpeedMmPerSecond,
                        CollisionRadiusMm =
                            value.CollisionRadiusMm,
                        SourceElement =
                            ToFixed64(value.SourceElement),
                        BaseDamage = value.BaseDamage,
                        OutgoingDamageBasisPoints =
                            value.OutgoingDamageBasisPoints,
                        CreatedAtTick = value.CreatedAtTick,
                        RemainingTravelMm =
                            value.RemainingTravelMm,
                        MovementRemainder =
                            value.MovementRemainder
                    });
            }
            RemoveInactive(projectiles);
        }

        private void SyncWindWalls(
            WorldSnapshot snapshot,
            Entity prefab)
        {
            activeIds.Clear();
            for (var index = 0;
                index < snapshot.WindWalls.Length;
                index += 1)
            {
                var value = snapshot.WindWalls[index];
                activeIds.Add(value.EntityId);
                var entity = GetOrCreate(
                    windWalls,
                    value.EntityId,
                    prefab);
                EntityManager.SetComponentData(
                    entity,
                    new MatchWindWallGhostState
                    {
                        SnapshotTick = snapshot.Tick,
                        EntityId = value.EntityId,
                        OwnerEntityId = value.OwnerEntityId,
                        CenterX = value.Center.X,
                        CenterZ = value.Center.Z,
                        DirectionX = value.Direction.X,
                        DirectionZ = value.Direction.Z,
                        LengthMm = value.LengthMm,
                        RemainingTicks = value.RemainingTicks
                    });
            }
            RemoveInactive(windWalls);
        }

        private Entity GetOrCreate(
            Dictionary<int, Entity> entities,
            int entityId,
            Entity prefab)
        {
            if (entities.TryGetValue(entityId, out var entity) &&
                EntityManager.Exists(entity))
            {
                return entity;
            }

            entity = EntityManager.Instantiate(prefab);
            EntityManager.SetName(
                entity,
                $"JWGB Replicated Entity {entityId}");
            entities[entityId] = entity;
            return entity;
        }

        private void RemoveInactive(
            Dictionary<int, Entity> entities)
        {
            removedIds.Clear();
            foreach (var pair in entities)
            {
                if (!activeIds.Contains(pair.Key))
                {
                    if (EntityManager.Exists(pair.Value))
                    {
                        EntityManager.DestroyEntity(pair.Value);
                    }
                    removedIds.Add(pair.Key);
                }
            }
            for (var index = 0;
                index < removedIds.Count;
                index += 1)
            {
                entities.Remove(removedIds[index]);
            }
        }

        private static FixedString64Bytes ToFixed64(string value)
        {
            return new FixedString64Bytes(value ?? string.Empty);
        }

        private static FixedString128Bytes Join(string[] values)
        {
            var result = new FixedString128Bytes();
            if (values == null)
            {
                return result;
            }
            for (var index = 0; index < values.Length; index += 1)
            {
                if (index > 0)
                {
                    result.Append('|');
                }
                result.Append(values[index]);
            }
            return result;
        }
    }
}
