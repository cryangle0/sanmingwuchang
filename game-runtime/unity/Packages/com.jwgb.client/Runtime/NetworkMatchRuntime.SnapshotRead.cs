using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using Unity.Collections;

namespace Jwgb.Client
{
    public sealed partial class NetworkMatchRuntime
    {
        private void ReadSnapshot()
        {
            if (!TryCreateQueries())
            {
                return;
            }

            using var worldEntities =
                worldQuery.ToEntityArray(Allocator.Temp);
            using var playerEntities =
                playerQuery.ToEntityArray(Allocator.Temp);
            using var projectileEntities =
                projectileQuery.ToEntityArray(Allocator.Temp);
            using var windWallEntities =
                windWallQuery.ToEntityArray(Allocator.Temp);
            using var monsterEntities =
                monsterQuery.ToEntityArray(Allocator.Temp);
            using var lootEntities =
                lootQuery.ToEntityArray(Allocator.Temp);
            using var shopEntities =
                shopQuery.ToEntityArray(Allocator.Temp);
            using var airdropEntities =
                airdropQuery.ToEntityArray(Allocator.Temp);
            using var airdropChannelEntities =
                airdropChannelQuery.ToEntityArray(Allocator.Temp);
            if (worldEntities.Length != 1)
            {
                return;
            }

            var worldState = clientWorld.EntityManager
                .GetComponentData<MatchWorldGhostState>(
                    worldEntities[0]);
            HandleMatchRestart(
                worldState.MatchSequence,
                worldState.SnapshotTick);
            if (!IsCompleteSnapshot(
                    worldState,
                    playerEntities.Length,
                    projectileEntities.Length,
                    windWallEntities.Length,
                    monsterEntities.Length,
                    lootEntities.Length,
                    shopEntities.Length,
                    airdropEntities.Length,
                    airdropChannelEntities.Length))
            {
                return;
            }

            ReadPendingTransactions(worldEntities[0]);
            var fingerprint = BeginFingerprint(worldState);
            if (!ReadPlayers(
                    playerEntities,
                    ref fingerprint,
                    out var localPlayer,
                    out var localPlayerState) ||
                !ReadProjectiles(
                    projectileEntities,
                    ref fingerprint) ||
                !ReadWindWalls(
                    windWallEntities,
                    ref fingerprint) ||
                !ReadMonsters(
                    monsterEntities,
                    ref fingerprint) ||
                !ReadLoot(
                    lootEntities,
                    ref fingerprint) ||
                !ReadShops(
                    shopEntities,
                    ref fingerprint) ||
                !ReadAirdrops(
                    airdropEntities,
                    ref fingerprint) ||
                !ReadAirdropChannels(
                    airdropChannelEntities,
                    ref fingerprint))
            {
                return;
            }

            fingerprint = AddFingerprint(
                fingerprint,
                worldState.StormRadiusMm,
                worldState.MonsterCount);
            if (fingerprint == lastSnapshotFingerprint)
            {
                return;
            }

            PublishSnapshot(
                worldState,
                fingerprint,
                localPlayer,
                localPlayerState);
        }

        private void HandleMatchRestart(
            int incomingMatchSequence,
            int incomingTick)
        {
            if (!IsNewMatch(
                    lastMatchSequence,
                    incomingMatchSequence,
                    lastSnapshotTick,
                    incomingTick))
            {
                return;
            }
            ResetSession();
            MatchNetworkRuntimeState.ResetClientMatchScopedState(
                incomingMatchSequence);
            MatchRestarted?.Invoke();
        }

        private static bool IsCompleteSnapshot(
            MatchWorldGhostState state,
            int playerCount,
            int projectileCount,
            int windWallCount,
            int monsterCount,
            int lootCount,
            int shopCount,
            int airdropCount,
            int airdropChannelCount)
        {
            return state.SnapshotTick > 0 &&
                playerCount == state.PlayerCount &&
                projectileCount == state.ProjectileCount &&
                windWallCount == state.WindWallCount &&
                monsterCount == state.MonsterCount &&
                lootCount == state.LootCount &&
                shopCount == state.ShopCount &&
                airdropCount == state.AirdropCount &&
                airdropChannelCount == state.AirdropChannelCount;
        }
    }
}
