using Unity.Entities;

namespace Jwgb.Sim
{
    public struct SyntheticStressState : IComponentData
    {
        public int PlayerCount;
        public int MonsterCount;
        public int SummonCount;
        public int ArenaRadiusMm;
    }
}
