using Unity.Burst;
using Unity.Entities;

namespace Jwgb.Sim
{
    [BurstCompile]
    [UpdateInGroup(typeof(FixedStepSimulationSystemGroup))]
    public partial struct SyntheticMotionSystem : ISystem
    {
        [BurstCompile]
        public void OnCreate(ref SystemState state)
        {
            state.RequireForUpdate<SimulationTick>();
            state.RequireForUpdate<SyntheticStressState>();
        }

        [BurstCompile]
        public void OnUpdate(ref SystemState state)
        {
            var tick = SystemAPI.GetSingletonRW<SimulationTick>();
            var stressState = SystemAPI.GetSingleton<SyntheticStressState>();
            tick.ValueRW.Value += 1;

            state.Dependency = new SyntheticMotionJob
            {
                Tick = tick.ValueRO.Value,
                ArenaRadiusMm = stressState.ArenaRadiusMm
            }.ScheduleParallel(state.Dependency);
        }
    }
}
