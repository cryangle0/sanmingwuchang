using System;
using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of advanceEquipmentRuntime from
    /// packages/sim/src/systems/equipment-runtime.ts. Equipment-proc
    /// events, keen-ears reveals, and equipment burn damage only trigger
    /// for equipment/effects that never occur in the deterministic
    /// fixtures; the timer bookkeeping below matches the TS oracle.
    /// </summary>
    internal static class EquipmentRuntimeSystem
    {
        private const int OutOfCombatTicks =
            5 * SimulationConstants.TicksPerSecond;
        private const int NightCloakStillTicks =
            2 * SimulationConstants.TicksPerSecond;
        private const int FlightDelayTicks =
            5 * SimulationConstants.TicksPerSecond;

        private const string MedicineGourd = "B5";
        private const string DormantBoots = "B14";
        private const string TenThousandYearLingzhi = "P5";
        private const string NightCloak = "P13";
        private const string ComboShoes = "P16";
        private const string CloudRide = "G4";

        public static void Advance(
            SimulationState state,
            List<SimEvent> events)
        {
            foreach (var player in state.Players.Values)
            {
                AdvancePersonalEquipment(state, events, player);
            }

            AdvanceComboShoesStates(state);
            AdvanceEquipmentBurn(state, events);
        }

        private static bool HasEquipment(PlayerState player, string id)
        {
            for (var index = 0; index < player.Equipment.Count; index += 1)
            {
                if (player.Equipment[index].EquipmentId == id)
                {
                    return true;
                }
            }

            return false;
        }

        private static bool IsStealthed(PlayerState player)
        {
            return player.StealthTicks > 0 || player.NightCloakStealthed;
        }

        private static void BreakEquipmentStealth(PlayerState player)
        {
            player.NightCloakStillTicks = 0;
            player.NightCloakStealthed = false;
        }

        private static void AdvancePersonalEquipment(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            if (!HasEquipment(player, DormantBoots))
            {
                EquipmentStateSystem.ClearDormantBootsState(player);
            }
            else
            {
                player.DormantBootsSpeedTicks = Math.Max(
                    0,
                    player.DormantBootsSpeedTicks - 1);
                player.DormantBootsCooldownTicks = Math.Max(
                    0,
                    player.DormantBootsCooldownTicks - 1);
                if (IsStealthed(player))
                {
                    if (!player.DormantBootsStealthEpisodeActive)
                    {
                        player.DormantBootsStealthEpisodeActive = true;
                        player.DormantBootsTriggeredThisEpisode = false;
                    }
                }
                else
                {
                    player.DormantBootsStealthEpisodeActive = false;
                    player.DormantBootsTriggeredThisEpisode = false;
                }
            }

            if (player.LifeState != LifeState.Alive)
            {
                BreakEquipmentStealth(player);
                player.FlightActive = false;
                return;
            }

            var outOfCombat =
                state.Tick - player.LastCombatTick >= OutOfCombatTicks;
            var healAmount = 0;
            if (HasEquipment(player, MedicineGourd))
            {
                healAmount += 8;
            }

            if (HasEquipment(player, TenThousandYearLingzhi))
            {
                healAmount += 8;
            }

            if (outOfCombat &&
                healAmount > 0 &&
                state.Tick > 0 &&
                state.Tick % SimulationConstants.TicksPerSecond == 0)
            {
                var before = player.Hp;
                player.Hp = Math.Min(player.MaxHp, player.Hp + healAmount);
                if (player.Hp > before)
                {
                    events.Add(
                        new SimEvent
                        {
                            Type = "equipment-proc",
                            Tick = state.Tick,
                            SourceEntityId = player.EntityId,
                            Amount = player.Hp - before
                        });
                }
            }

            if (HasEquipment(player, NightCloak) &&
                outOfCombat &&
                player.Intent.Movement.X == 0 &&
                player.Intent.Movement.Z == 0)
            {
                player.NightCloakStillTicks += 1;
                if (player.NightCloakStillTicks >= NightCloakStillTicks)
                {
                    player.NightCloakStealthed = true;
                    player.StealthTicks = Math.Max(player.StealthTicks, 2);
                }
            }
            else
            {
                BreakEquipmentStealth(player);
            }

            player.FlightActive =
                outOfCombat &&
                state.Tick - player.LastCombatTick >= FlightDelayTicks &&
                HasEquipment(player, CloudRide);
        }

        private static void AdvanceComboShoesStates(SimulationState state)
        {
            foreach (var targetState in state.PassiveTargetStates.Values)
            {
                if (targetState.ComboShoesStacks <= 0)
                {
                    targetState.ComboShoesExpiresAtTick = 0;
                    continue;
                }

                state.Players.TryGetValue(
                    targetState.SourceEntityId,
                    out var source);
                state.Players.TryGetValue(
                    targetState.TargetEntityId,
                    out var targetPlayer);
                state.Monsters.TryGetValue(
                    targetState.TargetEntityId,
                    out var targetMonster);
                var sourceValid =
                    source != null &&
                    source.LifeState == LifeState.Alive &&
                    HasEquipment(source, ComboShoes);
                var targetValid = targetPlayer != null
                    ? targetPlayer.LifeState == LifeState.Alive
                    : targetMonster != null && targetMonster.Hp > 0;
                if (!sourceValid ||
                    !targetValid ||
                    targetState.ComboShoesExpiresAtTick <= state.Tick)
                {
                    targetState.ComboShoesStacks = 0;
                    targetState.ComboShoesExpiresAtTick = 0;
                }
            }
        }

        private const int EquipmentBurnDurationTicks =
            2 * SimulationConstants.TicksPerSecond;
        private const int EquipmentBurnDamagePerSecond = 20;

        public static void ApplyEquipmentBurn(
            SimulationState state,
            PlayerState source,
            int targetEntityId)
        {
            if (!HasEquipment(source, "P2"))
            {
                return;
            }

            var targetState = PassiveRuntimeSystem.GetOrCreateTargetState(
                state,
                source.EntityId,
                targetEntityId);
            targetState.EquipmentBurnDamagePerSecond =
                EquipmentBurnDamagePerSecond;
            targetState.EquipmentBurnExpiresAtTick = Math.Max(
                targetState.EquipmentBurnExpiresAtTick,
                state.Tick + EquipmentBurnDurationTicks);
            targetState.EquipmentBurnNextTick =
                state.Tick + SimulationConstants.TicksPerSecond;
            targetState.EquipmentBurnSourceEntityId = source.EntityId;
        }

        private static void AdvanceEquipmentBurn(
            SimulationState state,
            List<SimEvent> events)
        {
            foreach (var targetState in state.PassiveTargetStates.Values)
            {
                if (targetState.EquipmentBurnExpiresAtTick <= state.Tick)
                {
                    targetState.EquipmentBurnDamagePerSecond = 0;
                    targetState.EquipmentBurnExpiresAtTick = 0;
                    targetState.EquipmentBurnNextTick = 0;
                    targetState.EquipmentBurnSourceEntityId = null;
                    continue;
                }

                if (targetState.EquipmentBurnDamagePerSecond <= 0 ||
                    targetState.EquipmentBurnNextTick > state.Tick)
                {
                    continue;
                }

                PlayerState source = null;
                if (targetState.EquipmentBurnSourceEntityId.HasValue)
                {
                    state.Players.TryGetValue(
                        targetState.EquipmentBurnSourceEntityId.Value,
                        out source);
                }

                if (source == null ||
                    source.LifeState == LifeState.Eliminated)
                {
                    targetState.EquipmentBurnNextTick +=
                        SimulationConstants.TicksPerSecond;
                    continue;
                }

                var applied = 0;
                if (state.Players.TryGetValue(
                        targetState.TargetEntityId,
                        out var targetPlayer))
                {
                    applied = DamageSystem.Apply(
                        state,
                        events,
                        new DamageRequest(
                            source.EntityId,
                            targetPlayer.EntityId,
                            targetState.EquipmentBurnDamagePerSecond,
                            DamageCause.Active,
                            DamageForm.Dot,
                            periodic: true));
                }
                else if (state.Monsters.TryGetValue(
                        targetState.TargetEntityId,
                        out var targetMonster))
                {
                    applied = MonsterDamageSystem.Apply(
                        state,
                        events,
                        source.EntityId,
                        targetMonster,
                        targetState.EquipmentBurnDamagePerSecond,
                        source.Element,
                        periodic: true);
                }

                if (applied > 0)
                {
                    events.Add(
                        new SimEvent
                        {
                            Type = "equipment-proc",
                            Tick = state.Tick,
                            EquipmentId = "P2",
                            SourceEntityId = source.EntityId,
                            TargetEntityId = targetState.TargetEntityId,
                            Detail = "basic-attack-burn",
                            Amount = applied,
                            DurationTicks = Math.Max(
                                0,
                                targetState.EquipmentBurnExpiresAtTick -
                                state.Tick)
                        });
                }

                targetState.EquipmentBurnNextTick +=
                    SimulationConstants.TicksPerSecond;
            }
        }
    }
}
