using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/equipment-state.ts.
    /// </summary>
    internal static class EquipmentStateSystem
    {
        public static void ClearDormantBootsState(PlayerState player)
        {
            player.DormantBootsSpeedTicks = 0;
            player.DormantBootsCooldownTicks = 0;
            player.DormantBootsStealthEpisodeActive = false;
            player.DormantBootsTriggeredThisEpisode = false;
        }

        public static void ClearComboShoesState(
            SimulationState state,
            int ownerEntityId)
        {
            foreach (var targetState in state.PassiveTargetStates.Values)
            {
                if (targetState.SourceEntityId == ownerEntityId)
                {
                    targetState.ComboShoesStacks = 0;
                    targetState.ComboShoesExpiresAtTick = 0;
                }
            }
        }

        public static void ClearComboShoesTargetState(
            SimulationState state,
            int targetEntityId)
        {
            foreach (var targetState in state.PassiveTargetStates.Values)
            {
                if (targetState.TargetEntityId == targetEntityId)
                {
                    targetState.ComboShoesStacks = 0;
                    targetState.ComboShoesExpiresAtTick = 0;
                }
            }
        }

        public static void ClearRemovedEquipmentState(
            SimulationState state,
            PlayerState player,
            string equipmentId)
        {
            if (equipmentId == "B14")
            {
                ClearDormantBootsState(player);
            }
            else if (equipmentId == "P16")
            {
                ClearComboShoesState(state, player.EntityId);
            }
            else if (equipmentId == GameplayIds.NightCloak)
            {
                player.NightCloakStillTicks = 0;
                player.NightCloakStealthed = false;
                player.StealthTicks = 0;
            }
            else if (equipmentId == GameplayIds.CloudRide)
            {
                player.FlightActive = false;
            }
        }

        public static void ClearEquipmentStateOnTrueDeath(
            SimulationState state,
            PlayerState player)
        {
            ClearDormantBootsState(player);
            ClearComboShoesState(state, player.EntityId);
            ClearComboShoesTargetState(state, player.EntityId);
            player.NightCloakStillTicks = 0;
            player.NightCloakStealthed = false;
            player.FlightActive = false;
        }
    }
}
