using Jwgb.Core;
using Unity.Entities;

namespace Jwgb.Sim
{
    public static class SimulationWorldConfigurator
    {
        public static void ConfigureFixedRate(World world)
        {
            var fixedStepGroup =
                world.GetExistingSystemManaged<FixedStepSimulationSystemGroup>();
            if (fixedStepGroup != null)
            {
                fixedStepGroup.Timestep =
                    1f / SimulationConstants.TicksPerSecond;
            }
        }
    }
}
