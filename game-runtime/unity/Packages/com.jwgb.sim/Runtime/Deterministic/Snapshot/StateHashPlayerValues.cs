using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class StateHashValues
    {
        public static object BuildPlayers(SimulationState state)
        {
            var values = new List<object>(state.Players.Count);
            foreach (var player in state.Players.Values)
            {
                values.Add(BuildPlayer(state, player));
            }

            return values;
        }

        public static object BuildPlayerRuntime(SimulationState state)
        {
            var values = new List<object>(state.Players.Count);
            foreach (var player in state.Players.Values)
            {
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = player.EntityId,
                        ["attackPeriodTicks"] = player.AttackPeriodTicks,
                        ["hardControlTicks"] = player.HardControlTicks,
                        ["respawnTarget"] = player.RespawnTarget.HasValue
                            ? StateHashBuilder.BuildVector(
                                player.RespawnTarget.Value.X,
                                player.RespawnTarget.Value.Z)
                            : null,
                        ["reviveProtectionTicks"] =
                            player.ReviveProtectionTicks,
                        ["moveRemainderX"] = player.MoveRemainderX,
                        ["moveRemainderZ"] = player.MoveRemainderZ,
                        ["intent"] = BuildIntent(player.Intent)
                    });
            }

            return values;
        }

        private static object BuildPlayer(
            SimulationState state,
            PlayerState player)
        {
            return new Dictionary<string, object>
            {
                ["entityId"] = player.EntityId,
                ["playerId"] = player.PlayerId,
                ["heroId"] = player.HeroId,
                ["activeAbilityId"] = player.ActiveAbilityId,
                ["position"] = StateHashBuilder.BuildVector(
                    player.Position.X,
                    player.Position.Z),
                ["facing"] = StateHashBuilder.BuildVector(
                    player.Facing.X,
                    player.Facing.Z),
                ["hp"] = player.Hp,
                ["maxHp"] = player.MaxHp,
                ["attackPower"] = player.AttackPower,
                ["moveSpeedMmPerSecond"] = player.MoveSpeedMmPerSecond,
                ["attackRangeMm"] = player.AttackRangeMm,
                ["attacksPerSecondMilli"] = player.AttacksPerSecondMilli,
                ["livesRemaining"] = player.LivesRemaining,
                ["trueDeaths"] = player.TrueDeaths,
                ["lifeState"] = SimulationText.LifeState(player.LifeState),
                ["attackCooldownTicks"] = player.AttackCooldownTicks,
                ["activeCooldownTicks"] = player.ActiveCooldownTicks,
                ["activeBuffTicks"] = player.ActiveBuffTicks,
                ["armedCriticalTicks"] = player.ArmedCriticalTicks,
                ["armedMissingHpDamagePercent"] =
                    player.ArmedMissingHpDamagePercent,
                ["armedActiveId"] = player.ArmedActiveId,
                ["activeLifestealTicks"] = player.ActiveLifestealTicks,
                ["activeLifestealPercent"] = player.ActiveLifestealPercent,
                ["activeDamageReductionTicks"] =
                    player.ActiveDamageReductionTicks,
                ["activeDamageReductionBasisPoints"] =
                    player.ActiveDamageReductionBasisPoints,
                ["activeSpeedBonusTicks"] = player.ActiveSpeedBonusTicks,
                ["activeSpeedBonusPercent"] =
                    player.ActiveSpeedBonusPercent,
                ["worldInteractionLockTicks"] =
                    player.WorldInteractionLockTicks,
                ["polymorphTicks"] = player.PolymorphTicks,
                ["polymorphSpeedBonusPercent"] =
                    player.PolymorphSpeedBonusPercent,
                ["stealthTicks"] = player.StealthTicks,
                ["dormantBootsSpeedTicks"] = player.DormantBootsSpeedTicks,
                ["dormantBootsCooldownTicks"] =
                    player.DormantBootsCooldownTicks,
                ["dormantBootsStealthEpisodeActive"] =
                    player.DormantBootsStealthEpisodeActive,
                ["dormantBootsTriggeredThisEpisode"] =
                    player.DormantBootsTriggeredThisEpisode,
                ["displacementLockTicks"] = player.DisplacementLockTicks,
                ["treasureSenseTicks"] = player.TreasureSenseTicks,
                ["activeBountyStreak"] = player.ActiveBountyStreak,
                ["hardControlTicks"] = player.HardControlTicks,
                ["slowTicks"] = player.SlowTicks,
                ["slowBasisPoints"] = player.SlowBasisPoints,
                ["silenceTicks"] = player.SilenceTicks,
                ["silenceCooldownPenaltyTicks"] =
                    player.SilenceCooldownPenaltyTicks,
                ["blindTicks"] = player.BlindTicks,
                ["blindMissPercent"] = player.BlindMissPercent,
                ["blindPreventsCritical"] = player.BlindPreventsCritical,
                ["b15SpeedBoostTicks"] = player.B15SpeedBoostTicks,
                ["b15SpeedBonusPercent"] = player.B15SpeedBonusPercent,
                ["b21FirstHitReady"] = player.B21FirstHitReady,
                ["b25NextBasicBonusPercent"] =
                    player.B25NextBasicBonusPercent,
                ["b25AttackSpeedBoostTicks"] =
                    player.B25AttackSpeedBoostTicks,
                ["b25AttackSpeedBonusPercent"] =
                    player.B25AttackSpeedBonusPercent,
                ["b27SpeedBoostTicks"] = player.B27SpeedBoostTicks,
                ["b27SpeedBonusPercent"] = player.B27SpeedBonusPercent,
                ["b30NextAfterimageTick"] =
                    player.B30NextAfterimageTick,
                ["b36Stacks"] = player.B36Stacks,
                ["b36MovingTicks"] = player.B36MovingTicks,
                ["b38NextHealTick"] = player.B38NextHealTick,
                ["b40KillCount"] = player.B40KillCount,
                ["b40BonusMaxHp"] = player.B40BonusMaxHp,
                ["b42SpeedBoostTicks"] = player.B42SpeedBoostTicks,
                ["b42SpeedBonusPercent"] = player.B42SpeedBonusPercent,
                ["lastCombatTick"] = player.LastCombatTick,
                ["totalShield"] = ShieldSystem.GetTotal(player),
                ["pvpCombatTicks"] = player.PvpCombatTicks,
                ["whirlwindTicks"] = player.WhirlwindTicks,
                ["whirlwindNextPulseTick"] =
                    player.WhirlwindNextPulseTick,
                ["b19RetriggerLockTicks"] =
                    player.B19RetriggerLockTicks,
                ["b20ReviveBuffTicks"] = player.B20ReviveBuffTicks,
                ["invulnerableTicks"] = player.InvulnerableTicks,
                ["iceCoffinTicks"] = player.IceCoffinTicks,
                ["nightCloakStillTicks"] = player.NightCloakStillTicks,
                ["nightCloakStealthed"] = player.NightCloakStealthed,
                ["flightActive"] = player.FlightActive,
                ["taibaiChannelTicks"] = player.TaibaiChannelTicks,
                ["taibaiTargetHeroId"] = player.TaibaiTargetHeroId,
                ["taibaiCooldownTicks"] = player.TaibaiCooldownTicks,
                ["heishanGambleCount"] = player.HeishanGambleCount,
                ["consumableVisionTicks"] = player.ConsumableVisionTicks,
                ["consumableRevealTicks"] = player.ConsumableRevealTicks,
                ["attackPeriodTicks"] = player.AttackPeriodTicks,
                ["respawnTarget"] = player.RespawnTarget.HasValue
                    ? StateHashBuilder.BuildVector(
                        player.RespawnTarget.Value.X,
                        player.RespawnTarget.Value.Z)
                    : null,
                ["respawnFlightDeadlineTick"] =
                    player.RespawnFlightDeadlineTick,
                ["respawnRetryUntilTick"] = player.RespawnRetryUntilTick,
                ["respawnAttemptCount"] = player.RespawnAttemptCount,
                ["reviveProtectionTicks"] =
                    player.ReviveProtectionTicks,
                ["moveRemainderX"] = player.MoveRemainderX,
                ["moveRemainderZ"] = player.MoveRemainderZ,
                ["intent"] = BuildIntent(player.Intent),
                ["b20ChargeAvailable"] = HasAvailableB20(state, player),
                ["hasNineTurnPill"] = HasNineTurnPill(player),
                ["passives"] = BuildPassives(player),
                ["equipment"] = BuildEquipment(player),
                ["inventoryEquipment"] = BuildEquipment(player.InventoryEquipment),
                ["gold"] = player.Gold,
                ["experience"] = player.Experience,
                ["level"] = player.Level,
                ["gems"] = player.Gems,
                ["shields"] = BuildShields(player)
            };
        }

        private static object BuildIntent(PlayerIntent intent)
        {
            return new Dictionary<string, object>
            {
                ["sequence"] = intent.Sequence,
                ["movement"] = StateHashBuilder.BuildVector(
                    intent.Movement.X,
                    intent.Movement.Z),
                ["aim"] = StateHashBuilder.BuildVector(
                    intent.Aim.X,
                    intent.Aim.Z),
                ["attack"] = intent.Attack,
                ["targetEntityId"] = intent.TargetEntityId,
                // Extended intent fields exist in the TS oracle but are
                // never set by fixture inputs.
                ["secondaryTargetEntityId"] = null,
                ["castActive"] = intent.CastActive,
                ["alternateActive"] = false,
                ["interact"] = intent.Interact
            };
        }

        private static bool HasAvailableB20(
            SimulationState state,
            PlayerState player)
        {
            for (var index = 0; index < player.Passives.Count; index += 1)
            {
                if (player.Passives[index].PassiveId ==
                    GameplayIds.PassiveRevive)
                {
                    return !state.ConsumedB20PlayerIds.Contains(
                        player.PlayerId);
                }
            }

            return false;
        }

        private static bool HasNineTurnPill(PlayerState player)
        {
            for (var index = 0; index < player.Equipment.Count; index += 1)
            {
                if (player.Equipment[index].EquipmentId ==
                    GameplayIds.NineTurnPill)
                {
                    return true;
                }
            }

            return false;
        }
    }
}
