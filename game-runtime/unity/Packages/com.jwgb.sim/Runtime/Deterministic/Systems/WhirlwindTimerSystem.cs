namespace Jwgb.Sim.Deterministic
{
    internal static class WhirlwindTimerSystem
    {
        public static void Advance(SimulationState state)
        {
            foreach (var player in state.Players.Values)
            {
                if (player.HardControlTicks > 0)
                {
                    player.WhirlwindTicks = 0;
                    player.WhirlwindNextPulseTick = 0;
                    continue;
                }

                if (player.WhirlwindTicks > 0)
                {
                    player.WhirlwindTicks -= 1;
                }
            }
        }
    }
}
