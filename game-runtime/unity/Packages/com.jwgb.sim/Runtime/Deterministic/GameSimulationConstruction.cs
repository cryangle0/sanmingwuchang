using System;
using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    public sealed partial class GameSimulation
    {
        private void InitializeRuntime()
        {
            AirdropSystem.Initialize(state);
            PveSpawnSystem.Initialize(state, pendingEvents);
        }

        private static StaticSolidRect[] CopyStaticSolids(
            IReadOnlyList<StaticSolidRect> values)
        {
            if (values == null || values.Count == 0)
            {
                return Array.Empty<StaticSolidRect>();
            }

            var result = new StaticSolidRect[values.Count];
            for (var index = 0; index < values.Count; index += 1)
            {
                result[index] = values[index];
            }

            return result;
        }

        private static string[] CopyEquipmentIds(PlayerState player)
        {
            var result = new string[player.Equipment.Count];
            for (var index = 0; index < result.Length; index += 1)
            {
                result[index] = player.Equipment[index].EquipmentId;
            }

            return result;
        }
    }
}
