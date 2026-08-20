using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using Unity.Collections;
using Unity.Entities;

namespace Jwgb.Client
{
    public sealed partial class NetworkMatchRuntime
    {
        private bool ReadPlayers(
            NativeArray<Entity> entities,
            ref ulong fingerprint,
            out PlayerSnapshot localPlayer,
            out MatchPlayerGhostState localPlayerState)
        {
            playerSnapshots.Clear();
            playerSnapshotTicks.Clear();
            localPlayer = null;
            localPlayerState = default;
            for (var index = 0; index < entities.Length; index += 1)
            {
                var entity = entities[index];
                var state = clientWorld.EntityManager
                    .GetComponentData<MatchPlayerGhostState>(entity);
                if (state.SnapshotTick <= 0)
                {
                    return false;
                }
                fingerprint = AddFingerprint(
                    fingerprint,
                    state.EntityId,
                    state.SnapshotTick);
                var player = CreatePlayer(entity, state);
                playerSnapshots.Add(player);
                playerSnapshotTicks[state.EntityId] =
                    state.SnapshotTick;
                if (state.EntityId == LocalEntityId)
                {
                    localPlayer = player;
                    localPlayerState = state;
                }
            }
            return true;
        }

        private bool ReadProjectiles(
            NativeArray<Entity> entities,
            ref ulong fingerprint)
        {
            projectileSnapshots.Clear();
            for (var index = 0; index < entities.Length; index += 1)
            {
                var state = clientWorld.EntityManager
                    .GetComponentData<MatchProjectileGhostState>(
                        entities[index]);
                if (state.SnapshotTick <= 0)
                {
                    return false;
                }
                fingerprint = AddFingerprint(
                    fingerprint,
                    state.EntityId,
                    state.SnapshotTick);
                projectileSnapshots.Add(CreateProjectile(state));
            }
            return true;
        }

        private bool ReadWindWalls(
            NativeArray<Entity> entities,
            ref ulong fingerprint)
        {
            windWallSnapshots.Clear();
            for (var index = 0; index < entities.Length; index += 1)
            {
                var state = clientWorld.EntityManager
                    .GetComponentData<MatchWindWallGhostState>(
                        entities[index]);
                if (state.SnapshotTick <= 0)
                {
                    return false;
                }
                fingerprint = AddFingerprint(
                    fingerprint,
                    state.EntityId,
                    state.SnapshotTick);
                windWallSnapshots.Add(CreateWindWall(state));
            }
            return true;
        }

        private bool ReadMonsters(
            NativeArray<Entity> entities,
            ref ulong fingerprint)
        {
            monsterSnapshots.Clear();
            for (var index = 0; index < entities.Length; index += 1)
            {
                var state = clientWorld.EntityManager
                    .GetComponentData<MatchMonsterGhostState>(
                        entities[index]);
                if (state.SnapshotTick <= 0)
                {
                    return false;
                }
                fingerprint = AddFingerprint(
                    fingerprint,
                    state.EntityId,
                    state.SnapshotTick);
                fingerprint = AddFingerprint(
                    fingerprint,
                    state.PositionX,
                    state.PositionZ);
                fingerprint = AddFingerprint(
                    fingerprint,
                    state.Element.GetHashCode(),
                    state.Kind.GetHashCode());
                monsterSnapshots.Add(
                    NetworkPveGhostReaders.CreateMonster(state));
            }
            return true;
        }

        private bool ReadLoot(
            NativeArray<Entity> entities,
            ref ulong fingerprint)
        {
            lootSnapshots.Clear();
            for (var index = 0; index < entities.Length; index += 1)
            {
                var state = clientWorld.EntityManager
                    .GetComponentData<MatchLootGhostState>(
                        entities[index]);
                if (state.SnapshotTick <= 0)
                {
                    return false;
                }
                fingerprint = AddFingerprint(
                    fingerprint,
                    state.EntityId,
                    state.SnapshotTick);
                lootSnapshots.Add(
                    NetworkPveGhostReaders.CreateLoot(state));
            }
            return true;
        }

        private bool ReadShops(
            NativeArray<Entity> entities,
            ref ulong fingerprint)
        {
            shopSnapshots.Clear();
            for (var index = 0; index < entities.Length; index += 1)
            {
                var state = clientWorld.EntityManager
                    .GetComponentData<MatchShopGhostState>(
                        entities[index]);
                if (state.SnapshotTick <= 0)
                {
                    return false;
                }
                fingerprint = AddFingerprint(
                    fingerprint,
                    index + 1,
                    state.SnapshotTick);
                shopSnapshots.Add(
                    NetworkPveGhostReaders.CreateShop(
                        state,
                        clientWorld.EntityManager.GetBuffer<
                            MatchShopListingGhost>(entities[index])));
            }
            return true;
        }

        private bool ReadAirdrops(
            NativeArray<Entity> entities,
            ref ulong fingerprint)
        {
            airdropSnapshots.Clear();
            for (var index = 0; index < entities.Length; index += 1)
            {
                var state = clientWorld.EntityManager
                    .GetComponentData<MatchAirdropGhostState>(
                        entities[index]);
                if (state.SnapshotTick <= 0)
                {
                    return false;
                }
                fingerprint = AddFingerprint(
                    fingerprint,
                    state.Sequence,
                    state.SnapshotTick);
                airdropSnapshots.Add(
                    NetworkPveGhostReaders.CreateAirdrop(state));
            }
            return true;
        }

        private bool ReadAirdropChannels(
            NativeArray<Entity> entities,
            ref ulong fingerprint)
        {
            airdropChannelSnapshots.Clear();
            for (var index = 0; index < entities.Length; index += 1)
            {
                var state = clientWorld.EntityManager
                    .GetComponentData<MatchAirdropChannelGhostState>(
                        entities[index]);
                if (state.SnapshotTick <= 0)
                {
                    return false;
                }
                fingerprint = AddFingerprint(
                    fingerprint,
                    state.PlayerEntityId,
                    state.SnapshotTick);
                airdropChannelSnapshots.Add(
                    NetworkPveGhostReaders
                        .CreateAirdropChannel(state));
            }
            return true;
        }
    }
}
