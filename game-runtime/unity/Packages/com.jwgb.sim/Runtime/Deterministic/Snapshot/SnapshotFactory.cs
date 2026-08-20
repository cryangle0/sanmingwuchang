using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class SnapshotFactory
    {
        public static WorldSnapshot Create(SimulationState state)
        {
            var players = new List<PlayerSnapshot>(state.Players.Count);
            foreach (var player in state.Players.Values)
            {
                players.Add(CreatePlayer(state, player));
            }

            return new WorldSnapshot
            {
                Tick = state.Tick,
                RootSeed = state.RootSeed,
                StateHash = StateHashBuilder.Compute(state),
                ArenaRadiusMm = state.ArenaRadiusMm,
                MapGeometryHash = state.MapGeometryHash,
                PveEnabled = state.PveEnabled,
                PvePopulation = state.PvePopulation,
                Match = new MatchSnapshot
                {
                    Status = state.Match.Status,
                    StartedAtTick = state.Match.StartedAtTick,
                    FinishedAtTick = state.Match.FinishedAtTick,
                    WinnerEntityId = state.Match.WinnerEntityId,
                    Placements = state.Match.Placements.ToArray()
                },
                StormZone = new StormZoneSnapshot
                {
                    SelectedCourtId = state.StormZone.SelectedCourtId,
                    CourtAnnouncementTick =
                        state.StormZone.CourtAnnouncementTick,
                    WarningTick = state.StormZone.WarningTick,
                    Center = state.StormZone.Center,
                    RadiusMm = state.StormZone.RadiusMm,
                    CourtAnnounced = state.StormZone.CourtAnnounced,
                    ApocalypseWarning =
                        state.StormZone.ApocalypseWarning,
                    ApocalypseStarted =
                        state.StormZone.ApocalypseStarted
                },
                StaticSolids = state.StaticSolids.ToArray(),
                Players = players.ToArray(),
                Shops = CreateShops(state),
                PendingActiveReplacements =
                    CreatePendingActiveReplacements(state),
                PendingEquipmentPickups =
                    CreatePendingEquipmentPickups(state),
                WindWalls = CreateWindWalls(state),
                Projectiles = CreateProjectiles(state),
                Monsters = CreateMonsters(state),
                LootDrops = CreateLootDrops(state),
                MonsterRespawns = CreateMonsterRespawns(state),
                Summons = CreateSummons(state),
                Afterimages = CreateAfterimages(state),
                BountyMarks = CreateBountyMarks(state),
                PassiveTargetStates = CreatePassiveTargetStates(state),
                Airdrops = CreateAirdrops(state),
                AirdropChannels = CreateAirdropChannels(state)
            };
        }

        private static ShopSnapshot[] CreateShops(SimulationState state)
        {
            var snapshots = new ShopSnapshot[state.Shops.Count];
            var index = 0;
            foreach (var shop in state.Shops.Values)
            {
                var inventory = new ShopListingSnapshot[shop.Inventory.Count];
                for (var listingIndex = 0;
                    listingIndex < inventory.Length;
                    listingIndex += 1)
                {
                    var listing = shop.Inventory[listingIndex];
                    inventory[listingIndex] = new ShopListingSnapshot
                    {
                        ListingId = listing.ListingId,
                        Kind = listing.Kind,
                        EquipmentId = listing.EquipmentId,
                        ConsumableId = listing.ConsumableId,
                        Price = listing.Price
                    };
                }

                snapshots[index] = new ShopSnapshot
                {
                    ShopId = shop.ShopId,
                    Kind = shop.Kind,
                    Position = shop.Position,
                    AnchorId = shop.AnchorId,
                    MacroId = shop.MacroId,
                    OpenAtTick = shop.OpenAtTick,
                    CloseAtTick = shop.CloseAtTick,
                    Version = shop.Version,
                    Status = shop.Status,
                    NextRelocationAttemptTick =
                        shop.NextRelocationAttemptTick,
                    Inventory = inventory
                };
                index += 1;
            }

            return snapshots;
        }

        private static WindWallSnapshot[] CreateWindWalls(
            SimulationState state)
        {
            var snapshots =
                new WindWallSnapshot[state.WindWalls.Count];
            var index = 0;
            foreach (var wall in state.WindWalls.Values)
            {
                snapshots[index] = new WindWallSnapshot
                {
                    EntityId = wall.EntityId,
                    OwnerEntityId = wall.OwnerEntityId,
                    Center = wall.Center,
                    Direction = wall.Direction,
                    LengthMm = wall.LengthMm,
                    RemainingTicks = wall.RemainingTicks
                };
                index += 1;
            }

            return snapshots;
        }

        private static ProjectileSnapshot[] CreateProjectiles(
            SimulationState state)
        {
            var snapshots =
                new ProjectileSnapshot[state.Projectiles.Count];
            var index = 0;
            foreach (var projectile in state.Projectiles.Values)
            {
                snapshots[index] = new ProjectileSnapshot
                {
                    EntityId = projectile.EntityId,
                    Kind = projectile.Kind,
                    OwnerEntityId = projectile.OwnerEntityId,
                    TargetEntityId = projectile.TargetEntityId,
                    Position = projectile.Position,
                    SpeedMmPerSecond = projectile.SpeedMmPerSecond,
                    CollisionRadiusMm = projectile.CollisionRadiusMm,
                    SourceElement = SimulationText.Element(
                        projectile.SourceElement),
                    BaseDamage = projectile.BaseDamage,
                    OutgoingDamageBasisPoints =
                        projectile.OutgoingDamageBasisPoints,
                    CreatedAtTick = projectile.CreatedAtTick,
                    RemainingTravelMm =
                        projectile.RemainingTravelMm,
                    MovementRemainder =
                        projectile.MovementRemainder
                };
                index += 1;
            }

            return snapshots;
        }
    }
}
