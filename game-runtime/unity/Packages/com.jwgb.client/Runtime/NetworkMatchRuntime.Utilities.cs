using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Client
{
    public sealed partial class NetworkMatchRuntime
    {
        private bool TryCreateQueries()
        {
            var world = ClientServerBootstrap.ClientWorld;
            if (world == null || !world.IsCreated)
            {
                return false;
            }
            if (queriesCreated && clientWorld == world)
            {
                return true;
            }

            clientWorld = world;
            worldQuery = CreateQuery<MatchWorldGhostState>();
            playerQuery = CreateQuery<MatchPlayerGhostState>();
            projectileQuery = CreateQuery<MatchProjectileGhostState>();
            windWallQuery = CreateQuery<MatchWindWallGhostState>();
            monsterQuery = CreateQuery<MatchMonsterGhostState>();
            lootQuery = CreateQuery<MatchLootGhostState>();
            shopQuery = CreateQuery<MatchShopGhostState>();
            airdropQuery = CreateQuery<MatchAirdropGhostState>();
            airdropChannelQuery =
                CreateQuery<MatchAirdropChannelGhostState>();
            queriesCreated = true;
            return true;
        }

        private EntityQuery CreateQuery<T>()
            where T : unmanaged, IComponentData
        {
            return clientWorld.EntityManager.CreateEntityQuery(
                new EntityQueryDesc
                {
                    All = new[]
                    {
                        ComponentType.ReadOnly<T>()
                    },
                    None = new[]
                    {
                        ComponentType.ReadOnly<Prefab>()
                    }
                });
        }

        private static ProjectileSnapshot CreateProjectile(
            MatchProjectileGhostState state)
        {
            return new ProjectileSnapshot
            {
                EntityId = state.EntityId,
                OwnerEntityId = state.OwnerEntityId,
                TargetEntityId = state.TargetEntityId,
                Position = new Int2Mm(
                    state.PositionX,
                    state.PositionZ),
                SpeedMmPerSecond = state.SpeedMmPerSecond,
                CollisionRadiusMm = state.CollisionRadiusMm,
                SourceElement = state.SourceElement.ToString(),
                BaseDamage = state.BaseDamage,
                OutgoingDamageBasisPoints =
                    state.OutgoingDamageBasisPoints,
                CreatedAtTick = state.CreatedAtTick,
                RemainingTravelMm = state.RemainingTravelMm,
                MovementRemainder = state.MovementRemainder
            };
        }

        private static WindWallSnapshot CreateWindWall(
            MatchWindWallGhostState state)
        {
            return new WindWallSnapshot
            {
                EntityId = state.EntityId,
                OwnerEntityId = state.OwnerEntityId,
                Center = new Int2Mm(state.CenterX, state.CenterZ),
                Direction = new Int2Mm(
                    state.DirectionX,
                    state.DirectionZ),
                LengthMm = state.LengthMm,
                RemainingTicks = state.RemainingTicks
            };
        }

        private static int ComparePlayers(
            PlayerSnapshot left,
            PlayerSnapshot right)
        {
            return left.EntityId.CompareTo(right.EntityId);
        }

        private static int CompareProjectiles(
            ProjectileSnapshot left,
            ProjectileSnapshot right)
        {
            return left.EntityId.CompareTo(right.EntityId);
        }

        private static int CompareWindWalls(
            WindWallSnapshot left,
            WindWallSnapshot right)
        {
            return left.EntityId.CompareTo(right.EntityId);
        }

        private static int CompareMonsters(
            MonsterSnapshot left,
            MonsterSnapshot right)
        {
            return left.EntityId.CompareTo(right.EntityId);
        }

        private static int CompareLoot(
            LootSnapshot left,
            LootSnapshot right)
        {
            return left.EntityId.CompareTo(right.EntityId);
        }

        private static int CompareShops(
            ShopSnapshot left,
            ShopSnapshot right)
        {
            return string.CompareOrdinal(
                left.ShopId,
                right.ShopId);
        }

        private static int CompareAirdrops(
            AirdropSnapshot left,
            AirdropSnapshot right)
        {
            return left.Sequence.CompareTo(right.Sequence);
        }

        private static int CompareAirdropChannels(
            AirdropChannelSnapshot left,
            AirdropChannelSnapshot right)
        {
            return left.Sequence.CompareTo(right.Sequence);
        }

        private static ulong BeginFingerprint(
            MatchWorldGhostState state)
        {
            var result = 14695981039346656037UL;
            result = AddFingerprint(
                result,
                state.MatchSequence,
                state.SnapshotTick);
            result = AddFingerprint(
                result,
                state.SnapshotTick,
                state.PlayerCount);
            result = AddFingerprint(
                result,
                state.ProjectileCount,
                state.WindWallCount);
            result = AddFingerprint(
                result,
                state.AirdropCount,
                state.AirdropChannelCount);
            return result;
        }

        internal static bool IsNewMatchTick(
            int previousTick,
            int incomingTick)
        {
            return previousTick > 0 &&
                incomingTick > 0 &&
                incomingTick < previousTick;
        }

        internal static bool IsNewMatch(
            int previousSequence,
            int incomingSequence,
            int previousTick,
            int incomingTick)
        {
            return previousTick > 0 &&
                (incomingSequence > previousSequence ||
                 IsNewMatchTick(previousTick, incomingTick));
        }

        private static ulong AddFingerprint(
            ulong current,
            int entityId,
            int snapshotTick)
        {
            current ^= unchecked((uint)entityId);
            current *= 1099511628211UL;
            current ^= unchecked((uint)snapshotTick);
            current *= 1099511628211UL;
            return current;
        }
    }
}
