using System;
using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    [WorldSystemFilter(
        WorldSystemFilterFlags.ClientSimulation |
        WorldSystemFilterFlags.ThinClientSimulation)]
    public partial struct MatchClientJoinSystem : ISystem
    {
        public void OnCreate(ref SystemState state)
        {
            var query = new EntityQueryBuilder(Allocator.Temp)
                .WithAll<NetworkId>()
                .WithNone<NetworkStreamInGame>();
            state.RequireForUpdate(state.GetEntityQuery(query));
        }

        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (networkId, connection) in
                SystemAPI.Query<RefRO<NetworkId>>()
                    .WithNone<NetworkStreamInGame>()
                    .WithEntityAccess())
            {
                commands.AddComponent<NetworkStreamInGame>(connection);
                var request = commands.CreateEntity();
                commands.AddComponent(
                    request,
                    CreateJoinRequest());
                commands.AddComponent(
                    request,
                    new SendRpcCommandRequest
                    {
                        TargetConnection = connection
                    });
                MatchNetworkRuntimeState.RecordClientConnected(
                    networkId.ValueRO.Value);
            }
            commands.Playback(state.EntityManager);
        }

        private static MatchJoinRpc CreateJoinRequest()
        {
            return new MatchJoinRpc
            {
                ProtocolVersion =
                    MatchNetworkDefaults.ProtocolVersion,
                ReconnectTicket =
                    new FixedString64Bytes(
                        NetworkClientJoinOptions
                            .ReconnectTicket ??
                        string.Empty),
                RequestedHeroId =
                    new FixedString32Bytes(
                        NetworkClientJoinOptions
                            .RequestedHeroId),
                LastEventMatchSequence =
                    NetworkClientJoinOptions
                        .LastEventMatchSequence,
                LastEventCursor =
                    NetworkClientJoinOptions.LastEventCursor
            };
        }
    }

    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    public partial struct MatchServerJoinSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (request, receive, requestEntity) in
                SystemAPI.Query<
                        RefRO<MatchJoinRpc>,
                        RefRO<ReceiveRpcCommandRequest>>()
                    .WithEntityAccess())
            {
                ProcessJoin(
                    ref state,
                    commands,
                    request.ValueRO,
                    receive.ValueRO.SourceConnection,
                    requestEntity);
            }
            commands.Playback(state.EntityManager);
        }

        private static void ProcessJoin(
            ref SystemState state,
            EntityCommandBuffer commands,
            MatchJoinRpc request,
            Entity connection,
            Entity requestEntity)
        {
            var networkId = state.EntityManager
                .GetComponentData<NetworkId>(connection)
                .Value;
            if (request.ProtocolVersion !=
                    MatchNetworkDefaults.ProtocolVersion ||
                !MatchNetworkRuntimeState.TryAssignPlayer(
                    networkId,
                    request.ReconnectTicket,
                    request.RequestedHeroId,
                    out var entityId,
                    out var reconnectTicket,
                    out var assignedHeroId,
                    out var resumedSession))
            {
                commands.AddComponent<
                    NetworkStreamRequestDisconnect>(connection);
                commands.DestroyEntity(requestEntity);
                return;
            }

            EnsureConnectionComponents(
                ref state,
                commands,
                connection,
                entityId);
            var replayCursor = resumedSession
                ? MatchNetworkRuntimeState
                    .ResolveServerEventReplayCursor(
                        request.LastEventMatchSequence,
                        request.LastEventCursor)
                : 0;
            SendAccepted(
                commands,
                connection,
                entityId,
                reconnectTicket,
                assignedHeroId,
                resumedSession,
                replayCursor);
            SendReplay(
                commands,
                connection,
                resumedSession,
                replayCursor);
            commands.DestroyEntity(requestEntity);
        }

        private static void EnsureConnectionComponents(
            ref SystemState state,
            EntityCommandBuffer commands,
            Entity connection,
            int entityId)
        {
            if (!state.EntityManager.HasComponent<
                NetworkStreamInGame>(connection))
            {
                commands.AddComponent<
                    NetworkStreamInGame>(connection);
            }
            if (!state.EntityManager.HasComponent<
                MatchConnectionSlot>(connection))
            {
                commands.AddComponent(
                    connection,
                    new MatchConnectionSlot
                    {
                        EntityId = entityId
                    });
            }
        }

        private static void SendAccepted(
            EntityCommandBuffer commands,
            Entity connection,
            int entityId,
            FixedString64Bytes reconnectTicket,
            FixedString32Bytes assignedHeroId,
            bool resumedSession,
            int replayCursor)
        {
            var response = commands.CreateEntity();
            commands.AddComponent(
                response,
                new MatchJoinAcceptedRpc
                {
                    EntityId = entityId,
                    MatchSequence =
                        MatchNetworkRuntimeState
                            .ServerMatchSequence,
                    LastTransactionId =
                        MatchNetworkRuntimeState
                            .GetLastAcceptedTransactionId(
                                entityId),
                    LastEventCursor = replayCursor,
                    ReconnectTicket = reconnectTicket,
                    AssignedHeroId = assignedHeroId,
                    ResumedSession = resumedSession
                });
            commands.AddComponent(
                response,
                new SendRpcCommandRequest
                {
                    TargetConnection = connection
                });
        }

        private static void SendReplay(
            EntityCommandBuffer commands,
            Entity connection,
            bool resumedSession,
            int replayCursor)
        {
            var replayEvents = resumedSession
                ? MatchNetworkRuntimeState
                    .CaptureServerEventsSince(
                        MatchNetworkRuntimeState
                            .ServerMatchSequence,
                        replayCursor)
                : Array.Empty<MatchEventRpc>();
            for (var index = 0;
                index < replayEvents.Length;
                index += 1)
            {
                var replayRequest = commands.CreateEntity();
                commands.AddComponent(
                    replayRequest,
                    replayEvents[index]);
                commands.AddComponent(
                    replayRequest,
                    new SendRpcCommandRequest
                    {
                        TargetConnection = connection
                    });
            }
            MatchNetworkRuntimeState.RecordEventRpcsSent(
                replayEvents.Length,
                replay: true);
        }
    }

    [WorldSystemFilter(
        WorldSystemFilterFlags.ClientSimulation |
        WorldSystemFilterFlags.ThinClientSimulation)]
    public partial struct MatchClientAcceptedSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (accepted, entity) in
                SystemAPI.Query<RefRO<MatchJoinAcceptedRpc>>()
                    .WithAll<ReceiveRpcCommandRequest>()
                    .WithEntityAccess())
            {
                MatchNetworkRuntimeState.RecordClientAccepted(
                    accepted.ValueRO.EntityId,
                    accepted.ValueRO.MatchSequence,
                    accepted.ValueRO.LastTransactionId,
                    accepted.ValueRO.LastEventCursor,
                    accepted.ValueRO.ReconnectTicket,
                    accepted.ValueRO.AssignedHeroId,
                    accepted.ValueRO.ResumedSession);
                commands.DestroyEntity(entity);
            }
            commands.Playback(state.EntityManager);
        }
    }
}
