using System;
using Jwgb.Sim.Deterministic;
using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    public partial struct MatchServerTickRateSystem : ISystem
    {
        public void OnCreate(ref SystemState state)
        {
            state.RequireForUpdate<ClientServerTickRate>();
        }

        public void OnUpdate(ref SystemState state)
        {
            var tickRate = SystemAPI.GetSingletonRW<ClientServerTickRate>();
            tickRate.ValueRW.SimulationTickRate =
                MatchNetworkDefaults.SimulationRate;
            tickRate.ValueRW.NetworkTickRate =
                MatchNetworkDefaults.SnapshotRate;
            state.Enabled = false;
        }
    }

    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    [UpdateAfter(typeof(NetworkReceiveSystemGroup))]
    public partial struct MatchServerTransportStateSystem : ISystem
    {
        private EntityQuery connectedQuery;

        public void OnCreate(ref SystemState state)
        {
            state.RequireForUpdate<NetworkStreamDriver>();
            connectedQuery = state.GetEntityQuery(
                ComponentType.ReadOnly<NetworkId>());
        }

        public void OnUpdate(ref SystemState state)
        {
            var driver = SystemAPI.GetSingletonRW<NetworkStreamDriver>();
            MatchNetworkRuntimeState.RecordServerTransport(
                driver.ValueRW.DriverStore.HasListeningInterfaces,
                connectedQuery.CalculateEntityCount());
            foreach (var connectionEvent in
                driver.ValueRO.ConnectionEventsForTick)
            {
                if (connectionEvent.State ==
                    ConnectionState.State.Disconnected)
                {
                    MatchNetworkRuntimeState.ReleasePlayer(
                        connectionEvent.Id.Value);
                }
            }
        }
    }

    [WorldSystemFilter(
        WorldSystemFilterFlags.ClientSimulation |
        WorldSystemFilterFlags.ThinClientSimulation)]
    public partial struct MatchClientInputSendSystem : ISystem
    {
        private double nextSendAt;
        private int sequence;

        public void OnCreate(ref SystemState state)
        {
            var query = new EntityQueryBuilder(Allocator.Temp)
                .WithAll<NetworkId, NetworkStreamInGame>();
            state.RequireForUpdate(state.GetEntityQuery(query));
        }

        public void OnUpdate(ref SystemState state)
        {
            if (MatchNetworkRuntimeState.ClientEntityId <= 0 ||
                SystemAPI.Time.ElapsedTime < nextSendAt)
            {
                return;
            }
            nextSendAt =
                SystemAPI.Time.ElapsedTime +
                (1.0 / MatchNetworkDefaults.SimulationRate);

            var input = MatchNetworkRuntimeState.TakeClientInput();
            sequence = checked(sequence + 1);
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (_, connection) in
                SystemAPI.Query<RefRO<NetworkId>>()
                    .WithAll<NetworkStreamInGame>()
                    .WithEntityAccess())
            {
                var inputRpc = new MatchInputRpc
                {
                    Sequence = sequence,
                    MoveX = input.MoveX,
                    MoveZ = input.MoveZ,
                    AimX = input.AimX,
                    AimZ = input.AimZ,
                    Attack = input.Attack,
                    CastActive = input.CastActive,
                    Interact = input.Interact
                };
                var request = commands.CreateEntity();
                commands.AddComponent(
                    request,
                    inputRpc);
                commands.AddComponent(
                    request,
                    new SendRpcCommandRequest
                    {
                        TargetConnection = connection
                    });
                MatchNetworkRuntimeState.RecordInputRpcSent(inputRpc);
            }
            commands.Playback(state.EntityManager);
        }
    }

    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    public partial struct MatchServerInputReceiveSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (input, receive, entity) in
                SystemAPI.Query<
                        RefRO<MatchInputRpc>,
                        RefRO<ReceiveRpcCommandRequest>>()
                    .WithEntityAccess())
            {
                var networkId = state.EntityManager
                    .GetComponentData<NetworkId>(
                        receive.ValueRO.SourceConnection)
                    .Value;
                MatchNetworkRuntimeState.TryAcceptInput(
                    networkId,
                    input.ValueRO);
                commands.DestroyEntity(entity);
            }
            commands.Playback(state.EntityManager);
        }
    }

    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    public partial struct MatchServerStatePublishSystem : ISystem
    {
        private int lastSentTick;

        public void OnUpdate(ref SystemState state)
        {
            if (!MatchNetworkRuntimeState.TryGetServerSnapshot(
                    out var snapshot))
            {
                return;
            }
            if (snapshot.Tick < lastSentTick)
            {
                lastSentTick = 0;
            }
            if (snapshot.Tick <= lastSentTick ||
                snapshot.Tick - lastSentTick <
                    MatchNetworkDefaults.SimulationRate /
                    MatchNetworkDefaults.SnapshotRate)
            {
                return;
            }

            lastSentTick = snapshot.Tick;
            MatchNetworkRuntimeState.PublishReplicationSnapshot(
                snapshot);
            var remaining = 0;
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                if (snapshot.Players[index].LifeState !=
                    LifeState.Eliminated)
                {
                    remaining += 1;
                }
            }

            var sentCount = 0;
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (_, connection) in
                SystemAPI.Query<RefRO<NetworkId>>()
                    .WithAll<NetworkStreamInGame>()
                    .WithEntityAccess())
            {
                var request = commands.CreateEntity();
                commands.AddComponent(
                    request,
                    new MatchStateRpc
                    {
                        MatchSequence =
                            MatchNetworkRuntimeState
                                .ServerMatchSequence,
                        Tick = snapshot.Tick,
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
                        StateHash = Convert.ToUInt32(
                            snapshot.StateHash,
                            16)
                    });
                commands.AddComponent(
                    request,
                    new SendRpcCommandRequest
                    {
                        TargetConnection = connection
                    });
                sentCount += 1;
            }
            commands.Playback(state.EntityManager);
            MatchNetworkRuntimeState.RecordStateRpcsSent(sentCount);
        }
    }

    [WorldSystemFilter(
        WorldSystemFilterFlags.ClientSimulation |
        WorldSystemFilterFlags.ThinClientSimulation)]
    public partial struct MatchClientStateReceiveSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (matchState, entity) in
                SystemAPI.Query<RefRO<MatchStateRpc>>()
                    .WithAll<ReceiveRpcCommandRequest>()
                    .WithEntityAccess())
            {
                MatchNetworkRuntimeState.RecordClientState(
                    matchState.ValueRO);
                commands.DestroyEntity(entity);
            }
            commands.Playback(state.EntityManager);
        }
    }
}
