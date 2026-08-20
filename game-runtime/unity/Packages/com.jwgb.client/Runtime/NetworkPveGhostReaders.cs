using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using Unity.Entities;

namespace Jwgb.Client
{
    /// <summary>
    /// Converts replicated PVE ghost components back into the immutable
    /// snapshot models the shared presenters read. Fields that are not
    /// replicated stay at their defaults; presenters only consume the
    /// replicated subset.
    /// </summary>
    internal static class NetworkPveGhostReaders
    {
        public static MonsterSnapshot CreateMonster(
            MatchMonsterGhostState state)
        {
            return new MonsterSnapshot
            {
                EntityId = state.EntityId,
                Kind = state.Kind.ToString(),
                Ring = string.Empty,
                Element = EmptyToNull(state.Element.ToString()),
                Position = new Int2Mm(
                    state.PositionX,
                    state.PositionZ),
                HomePosition = new Int2Mm(
                    state.PositionX,
                    state.PositionZ),
                Facing = new Int2Mm(state.FacingX, state.FacingZ),
                Hp = state.Hp,
                MaxHp = state.MaxHp
            };
        }

        public static LootSnapshot CreateLoot(
            MatchLootGhostState state)
        {
            return new LootSnapshot
            {
                EntityId = state.EntityId,
                Position = new Int2Mm(
                    state.PositionX,
                    state.PositionZ),
                Gold = state.Gold,
                Experience = state.Experience,
                Gems = state.Gems,
                EquipmentId = EmptyToNull(
                    state.EquipmentId.ToString()),
                BookPassiveId = EmptyToNull(
                    state.BookPassiveId.ToString()),
                CreatedAtTick = state.CreatedAtTick,
                ExpiresAtTick = state.ExpiresAtTick,
                Kind = EmptyToNull(state.Kind.ToString()),
                ActiveId = EmptyToNull(state.ActiveId.ToString()),
                EquipmentInstanceId =
                    state.HasEquipmentInstanceId
                        ? state.EquipmentInstanceId
                        : null,
                AcquiredAtTick = state.HasAcquiredAtTick
                    ? state.AcquiredAtTick
                    : null,
                PermanentAttackBonus =
                    state.PermanentAttackBonus,
                StormCoveredSinceTick =
                    state.HasStormCoveredSinceTick
                        ? state.StormCoveredSinceTick
                        : null
            };
        }

        public static ShopSnapshot CreateShop(
            MatchShopGhostState state,
            DynamicBuffer<MatchShopListingGhost> listings)
        {
            var inventory =
                new ShopListingSnapshot[listings.Length];
            for (var index = 0; index < listings.Length; index += 1)
            {
                inventory[index] = new ShopListingSnapshot
                {
                    ListingId =
                        listings[index].ListingId.ToString(),
                    Kind = listings[index].Kind.ToString(),
                    EquipmentId = EmptyToNull(
                        listings[index].EquipmentId.ToString()),
                    ConsumableId = EmptyToNull(
                        listings[index].ConsumableId.ToString()),
                    Price = listings[index].Price
                };
            }

            return new ShopSnapshot
            {
                ShopId = state.ShopId.ToString(),
                Kind = state.Kind.ToString(),
                Position = new Int2Mm(
                    state.PositionX,
                    state.PositionZ),
                AnchorId = EmptyToNull(state.AnchorId.ToString()),
                MacroId = EmptyToNull(state.MacroId.ToString()),
                OpenAtTick = state.OpenAtTick,
                CloseAtTick = state.CloseAtTick,
                Version = state.Version,
                Status = state.Status.ToString(),
                NextRelocationAttemptTick =
                    state.NextRelocationAttemptTick,
                Inventory = inventory
            };
        }

        public static AirdropSnapshot CreateAirdrop(
            MatchAirdropGhostState state)
        {
            return new AirdropSnapshot
            {
                Id = state.AirdropId.ToString(),
                Sequence = state.Sequence,
                ScheduledElapsedTick =
                    state.ScheduledElapsedTick,
                Phase = state.Phase.ToString(),
                Position = state.HasPosition
                    ? new Int2Mm(
                        state.PositionX,
                        state.PositionZ)
                    : null,
                AnnouncedAtTick = state.HasAnnouncedAtTick
                    ? state.AnnouncedAtTick
                    : null,
                LandedAtTick = state.HasLandedAtTick
                    ? state.LandedAtTick
                    : null,
                ExpiresAtTick = state.HasExpiresAtTick
                    ? state.ExpiresAtTick
                    : null,
                OpenedAtTick = state.HasOpenedAtTick
                    ? state.OpenedAtTick
                    : null,
                OpenedByEntityId = state.HasOpenedByEntityId
                    ? state.OpenedByEntityId
                    : null,
                EquipmentId =
                    EmptyToNull(state.EquipmentId.ToString()),
                LootEntityId = state.HasLootEntityId
                    ? state.LootEntityId
                    : null
            };
        }

        public static AirdropChannelSnapshot CreateAirdropChannel(
            MatchAirdropChannelGhostState state)
        {
            return new AirdropChannelSnapshot
            {
                Sequence = state.Sequence,
                PlayerEntityId = state.PlayerEntityId,
                AirdropId = state.AirdropId.ToString(),
                StartedAtTick = state.StartedAtTick,
                CompletesAtTick = state.CompletesAtTick,
                OriginPosition = new Int2Mm(
                    state.OriginPositionX,
                    state.OriginPositionZ)
            };
        }

        public static StormZoneSnapshot CreateStormZone(
            MatchWorldGhostState state)
        {
            if (!state.HasStormZone)
            {
                return null;
            }
            return new StormZoneSnapshot
            {
                SelectedCourtId = string.Empty,
                Center = new Int2Mm(
                    state.StormCenterX,
                    state.StormCenterZ),
                RadiusMm = state.StormRadiusMm,
                ApocalypseWarning = state.StormApocalypseWarning,
                ApocalypseStarted = state.StormApocalypseStarted
            };
        }

        private static string EmptyToNull(string value)
        {
            return string.IsNullOrEmpty(value) ? null : value;
        }
    }
}
