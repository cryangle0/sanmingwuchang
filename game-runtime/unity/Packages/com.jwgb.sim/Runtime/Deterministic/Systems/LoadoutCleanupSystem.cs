using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of packages/sim/src/systems/loadout-cleanup.ts.
    /// Active projectiles/zones/target-effects/loot-reveals and the active
    /// summon kinds (decoy / stone-arhat / bean-soldier) do not exist in the
    /// deterministic slice, so those clears are no-ops here.
    /// </summary>
    internal static class LoadoutCleanupSystem
    {
        public static void ClearOwnedActiveStateForReplacement(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            string activeId)
        {
            _ = events;
            if (player.ArmedActiveId == activeId)
            {
                player.ArmedActiveId = null;
                player.ArmedCriticalTicks = 0;
                player.ArmedMissingHpDamagePercent = 0;
            }

            player.ActiveBountyStreak = 0;
            WindWallSystem.RemoveOwned(state, player.EntityId);
        }

        public static void ClearRemovedPassiveState(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            string passiveId)
        {
            for (var index = player.Shields.Count - 1; index >= 0; index -= 1)
            {
                var shield = player.Shields[index];
                if (shield.SourceKind == "passive" &&
                    shield.SourceId == passiveId)
                {
                    player.Shields.RemoveAt(index);
                }
            }

            if (passiveId == GameplayIds.WolfSpirit)
            {
                RemoveOwnedSummons(
                    state,
                    events,
                    player,
                    SummonKind.WolfSpirit);
            }
            else if (passiveId == GameplayIds.FireSpirit)
            {
                RemoveOwnedSummons(
                    state,
                    events,
                    player,
                    SummonKind.FireSpirit);
            }
            else if (passiveId == GameplayIds.StoneStatue)
            {
                RemoveOwnedSummons(
                    state,
                    events,
                    player,
                    SummonKind.StoneStatue);
            }
            else if (passiveId == GameplayIds.Afterimage)
            {
                var afterimages = new List<int>();
                foreach (var afterimage in state.Afterimages.Values)
                {
                    if (afterimage.OwnerEntityId == player.EntityId)
                    {
                        afterimages.Add(afterimage.EntityId);
                    }
                }

                for (var index = 0; index < afterimages.Count; index += 1)
                {
                    state.Afterimages.Remove(afterimages[index]);
                }

                player.B30NextAfterimageTick = 0;
            }
            else if (passiveId == GameplayIds.ColdArrow)
            {
                var projectiles = new List<int>();
                foreach (var projectile in state.Projectiles.Values)
                {
                    if (projectile.OwnerEntityId == player.EntityId &&
                        projectile.Kind == "cold-arrow")
                    {
                        projectiles.Add(projectile.EntityId);
                    }
                }

                for (var index = 0; index < projectiles.Count; index += 1)
                {
                    state.Projectiles.Remove(projectiles[index]);
                }
            }
            else if (passiveId == GameplayIds.Bounty)
            {
                for (var index = state.BountyMarks.Count - 1;
                    index >= 0;
                    index -= 1)
                {
                    if (state.BountyMarks[index].SourceEntityId ==
                        player.EntityId)
                    {
                        state.BountyMarks.RemoveAt(index);
                    }
                }
            }
            else if (passiveId == GameplayIds.Tenacity)
            {
                player.B40KillCount = 0;
                player.B40BonusMaxHp = 0;
                EquipmentInventorySystem.RebuildEquipmentStats(player);
            }

            if (passiveId == GameplayIds.Momentum)
            {
                player.B36Stacks = 0;
                player.B36MovingTicks = 0;
            }
            else if (passiveId == GameplayIds.Rage)
            {
                player.B25NextBasicBonusPercent = 0;
                player.B25AttackSpeedBoostTicks = 0;
                player.B25AttackSpeedBonusPercent = 0;
            }
            else if (passiveId == GameplayIds.Sprint)
            {
                player.B27SpeedBoostTicks = 0;
                player.B27SpeedBonusPercent = 0;
            }
            else if (passiveId == GameplayIds.BountyHunter)
            {
                player.B42SpeedBoostTicks = 0;
                player.B42SpeedBonusPercent = 0;
            }

            foreach (var targetState in state.PassiveTargetStates.Values)
            {
                if (targetState.SourceEntityId != player.EntityId)
                {
                    continue;
                }

                if (passiveId == GameplayIds.Burn)
                {
                    targetState.BurnStacks = 0;
                }
                else if (passiveId == GameplayIds.Poison)
                {
                    targetState.PoisonStacks = 0;
                    targetState.PoisonExpiresAtTick = 0;
                    targetState.PoisonNextTick = 0;
                }
                else if (passiveId == GameplayIds.FireSpirit)
                {
                    targetState.FireBurnDamagePerSecond = 0;
                    targetState.FireBurnExpiresAtTick = 0;
                    targetState.FireBurnNextTick = 0;
                    targetState.FireBurnSourceEntityId = null;
                }
                else if (passiveId == GameplayIds.Stun)
                {
                    targetState.StunCooldownTicks = 0;
                }
                else if (passiveId == GameplayIds.Counter)
                {
                    targetState.CounterCooldownTicks = 0;
                }
                else if (passiveId == GameplayIds.Pickpocket)
                {
                    targetState.PickpocketCooldownTicks = 0;
                }
                else if (passiveId == GameplayIds.Ambush)
                {
                    targetState.LastBasicHitTick = 0;
                    targetState.RevealExpiresAtTick = 0;
                }
            }
        }

        private static void RemoveOwnedSummons(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            SummonKind kind)
        {
            var removed = new List<SummonState>();
            foreach (var summon in state.Summons.Values)
            {
                if (summon.OwnerEntityId == player.EntityId &&
                    summon.Kind == kind)
                {
                    removed.Add(summon);
                }
            }

            for (var index = 0; index < removed.Count; index += 1)
            {
                state.Summons.Remove(removed[index].EntityId);
                events.Add(
                    new SimEvent
                    {
                        Type = "summon-expired",
                        Tick = state.Tick,
                        EntityId = removed[index].EntityId,
                        SourceEntityId = player.EntityId,
                        Detail = SimulationText.SummonKind(
                            removed[index].Kind)
                    });
            }
        }
    }
}
