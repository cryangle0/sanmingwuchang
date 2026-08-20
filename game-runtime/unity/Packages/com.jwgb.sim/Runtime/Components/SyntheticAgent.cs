using Unity.Entities;

namespace Jwgb.Sim
{
    public enum SyntheticAgentKind : byte
    {
        Player = 1,
        Monster = 2,
        Summon = 3
    }

    public struct SyntheticAgent : IComponentData
    {
        public SyntheticAgentKind Kind;
        public ushort Phase;
        public int SpeedMmPerSecond;
    }
}
