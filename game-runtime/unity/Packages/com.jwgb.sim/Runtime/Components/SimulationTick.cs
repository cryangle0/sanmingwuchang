using Unity.Entities;

namespace Jwgb.Sim
{
    public struct SimulationTick : IComponentData
    {
        public uint Value;
    }
}
