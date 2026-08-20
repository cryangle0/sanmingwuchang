using Unity.Collections;
using Unity.Entities;
using Unity.NetCode;

namespace Jwgb.Netcode
{
    [WorldSystemFilter(
        WorldSystemFilterFlags.ClientSimulation |
        WorldSystemFilterFlags.ThinClientSimulation)]
    public partial struct MatchClientTransactionSendSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            if (MatchNetworkRuntimeState.ClientEntityId <= 0)
            {
                return;
            }

            var commands = new EntityCommandBuffer(Allocator.Temp);
            var sent = false;
            foreach (var (_, connection) in
                SystemAPI.Query<RefRO<NetworkId>>()
                    .WithAll<NetworkStreamInGame>()
                    .WithEntityAccess())
            {
                if (sent)
                {
                    break;
                }

                while (MatchNetworkRuntimeState
                    .TryDequeueClientTransaction(out var transaction))
                {
                    var request = commands.CreateEntity();
                    commands.AddComponent(request, transaction);
                    commands.AddComponent(
                        request,
                        new SendRpcCommandRequest
                        {
                            TargetConnection = connection
                        });
                    MatchNetworkRuntimeState
                        .RecordTransactionRpcSent();
                    sent = true;
                    break;
                }
            }
            commands.Playback(state.EntityManager);
        }
    }

    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    public partial struct MatchServerTransactionReceiveSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (transaction, receive, entity) in
                SystemAPI.Query<
                        RefRO<MatchTransactionRpc>,
                        RefRO<ReceiveRpcCommandRequest>>()
                    .WithEntityAccess())
            {
                var networkId = state.EntityManager
                    .GetComponentData<NetworkId>(
                        receive.ValueRO.SourceConnection)
                    .Value;
                if (!MatchNetworkRuntimeState.TryAcceptTransaction(
                        networkId,
                        transaction.ValueRO,
                        out var immediateResult) &&
                    immediateResult.TransactionId > 0)
                {
                    MatchNetworkRuntimeState.QueueServerTransactionResult(
                        networkId,
                        immediateResult);
                }
                commands.DestroyEntity(entity);
            }
            commands.Playback(state.EntityManager);
        }
    }

    [WorldSystemFilter(WorldSystemFilterFlags.ServerSimulation)]
    [UpdateAfter(typeof(MatchServerTransactionReceiveSystem))]
    public partial struct MatchServerTransactionResultSendSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            while (MatchNetworkRuntimeState
                .TryDequeueServerTransactionResult(out var result))
            {
                var sent = false;
                foreach (var (networkId, connection) in
                    SystemAPI.Query<RefRO<NetworkId>>()
                        .WithAll<NetworkStreamInGame>()
                        .WithEntityAccess())
                {
                    if (networkId.ValueRO.Value != result.NetworkId)
                    {
                        continue;
                    }

                    var response = commands.CreateEntity();
                    commands.AddComponent(response, result.Result);
                    commands.AddComponent(
                        response,
                        new SendRpcCommandRequest
                        {
                            TargetConnection = connection
                        });
                    sent = true;
                    break;
                }

                if (sent)
                {
                    MatchNetworkRuntimeState
                        .RecordTransactionResultRpcSent();
                }
            }
            commands.Playback(state.EntityManager);
        }
    }

    [WorldSystemFilter(
        WorldSystemFilterFlags.ClientSimulation |
        WorldSystemFilterFlags.ThinClientSimulation)]
    public partial struct MatchClientTransactionResultReceiveSystem : ISystem
    {
        public void OnUpdate(ref SystemState state)
        {
            var commands = new EntityCommandBuffer(Allocator.Temp);
            foreach (var (result, entity) in
                SystemAPI.Query<RefRO<MatchTransactionResultRpc>>()
                    .WithAll<ReceiveRpcCommandRequest>()
                    .WithEntityAccess())
            {
                MatchNetworkRuntimeState.RecordClientTransactionResult(
                    result.ValueRO);
                commands.DestroyEntity(entity);
            }
            commands.Playback(state.EntityManager);
        }
    }
}
