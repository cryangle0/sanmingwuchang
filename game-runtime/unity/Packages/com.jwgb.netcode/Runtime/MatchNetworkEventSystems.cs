using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    public partial struct MatchServerEventPublishSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            var sentCount = 0;
            while (MatchNetworkRuntimeState.TryDequeueServerEvent(
                out var matchEvent))
            {
                foreach (var (_, connection) in
                    SystemAPI.Query<RefRO<NetworkId>>()
                        .WithAll<NetworkStreamInGame>()
                        .WithEntityAccess())
                {
                    var request = commands.CreateEntity();
                    commands.AddComponent(request, matchEvent);
                    commands.AddComponent(
                        request,
                        new SendRpcCommandRequest
                        {
                            TargetConnection = connection
                        });
                    sentCount += 1;
                }
            }
            commands.Playback(state.EntityManager);
            MatchNetworkRuntimeState.RecordEventRpcsSent(
                sentCount,
                replay: false);
        }
    }

    [WorldSystemFilter(
        WorldSystemFilterFlags.ClientSimulation |
        WorldSystemFilterFlags.ThinClientSimulation)]
    public partial struct MatchClientEventReceiveSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (matchEvent, entity) in
                SystemAPI.Query<RefRO<MatchEventRpc>>()
                    .WithAll<ReceiveRpcCommandRequest>()
                    .WithEntityAccess())
            {
                MatchNetworkRuntimeState.RecordClientEvent(
                    matchEvent.ValueRO);
                commands.DestroyEntity(entity);
            }
            commands.Playback(state.EntityManager);
        }
    }
}
