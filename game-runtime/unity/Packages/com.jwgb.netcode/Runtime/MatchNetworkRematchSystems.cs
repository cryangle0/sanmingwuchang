using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    [WorldSystemFilter(
        WorldSystemFilterFlags.ClientSimulation |
        WorldSystemFilterFlags.ThinClientSimulation)]
    public partial struct MatchClientRematchSendSystem : ISystem
    {
        public void OnCreate(ref SystemState state)
        {
            var query = new EntityQueryBuilder(Allocator.Temp)
                .WithAll<NetworkId, NetworkStreamInGame>();
            state.RequireForUpdate(state.GetEntityQuery(query));
        }

        public void OnUpdate(ref SystemState state)
        {
            if (!MatchNetworkRuntimeState.TryConsumeClientRematch(
                    out var requestSequence))
            {
                return;
            }
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (_, connection) in
                SystemAPI.Query<RefRO<NetworkId>>()
                    .WithAll<NetworkStreamInGame>()
                    .WithEntityAccess())
            {
                var request = commands.CreateEntity();
                commands.AddComponent(
                    request,
                    new MatchRematchRequestRpc
                    {
                        RequestSequence = requestSequence
                    });
                commands.AddComponent(
                    request,
                    new SendRpcCommandRequest
                    {
                        TargetConnection = connection
                    });
                break;
            }
            commands.Playback(state.EntityManager);
        }
    }

    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    public partial struct MatchServerRematchReceiveSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (_, receive, entity) in
                SystemAPI.Query<
                        RefRO<MatchRematchRequestRpc>,
                        RefRO<ReceiveRpcCommandRequest>>()
                    .WithEntityAccess())
            {
                var networkId = state.EntityManager
                    .GetComponentData<NetworkId>(
                        receive.ValueRO.SourceConnection)
                    .Value;
                MatchNetworkRuntimeState.RecordServerRematchVote(
                    networkId);
                commands.DestroyEntity(entity);
            }
            commands.Playback(state.EntityManager);
        }
    }
}
