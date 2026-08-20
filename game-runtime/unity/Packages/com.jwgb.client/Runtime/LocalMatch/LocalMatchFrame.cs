using Jwgb.Sim.Deterministic;

namespace Jwgb.Client
{
    public sealed class LocalMatchFrame
    {
        public WorldSnapshot Snapshot { get; set; }

        public SimEvent[] Events { get; set; }
    }
}
