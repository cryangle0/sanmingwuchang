using System;
using System.Collections.Generic;
using Jwgb.Core;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using Unity.Collections;
using Unity.Entities;

namespace Jwgb.Client
{
    public sealed partial class NetworkMatchRuntime
    {
        private PlayerSnapshot CreatePlayer(
            Entity entity,
            MatchPlayerGhostState state)
        {
            var passives =
                clientWorld.EntityManager.GetBuffer<
                    MatchPlayerPassiveGhost>(entity);
            var passiveSnapshots =
                new PassiveLoadoutEntry[passives.Length];
            for (var index = 0;
                index < passives.Length;
                index += 1)
            {
                passiveSnapshots[index] = new PassiveLoadoutEntry(
                    passives[index].PassiveId.ToString(),
                    passives[index].Level);
            }

            var equipment =
                clientWorld.EntityManager.GetBuffer<
                    MatchPlayerEquipmentGhost>(entity);
            var equipmentSnapshots =
                new List<EquippedEquipmentInstance>();
            var inventorySnapshots =
                new List<EquippedEquipmentInstance>();
            for (var index = 0;
                index < equipment.Length;
                index += 1)
            {
                var instance =
                    NetworkGhostSnapshotReaders.CreateEquipment(
                        equipment[index]);
                if (equipment[index].IsInventory)
                {
                    inventorySnapshots.Add(instance);
                }
                else
                {
                    equipmentSnapshots.Add(instance);
                }
            }

            var shields =
                clientWorld.EntityManager.GetBuffer<
                    MatchPlayerShieldGhost>(entity);
            var shieldSnapshots =
                new ShieldSnapshot[shields.Length];
            for (var index = 0;
                index < shields.Length;
                index += 1)
            {
                var shield = shields[index];
                shieldSnapshots[index] = new ShieldSnapshot
                {
                    SourceKind = shield.SourceKind.ToString(),
                    SourceId = shield.SourceId.ToString(),
                    ExpiresAtTick = shield.ExpiresAtTick,
                    CreationSequence = shield.CreationSequence,
                    Absorbs = Split(shield.Absorbs),
                    BreakEffect = shield.HasBreakEffect
                        ? new ShieldBreakEffectSnapshot
                        {
                            SourceEntityId =
                                shield.BreakSourceEntityId,
                            SourceElement =
                                shield.BreakSourceElement.ToString(),
                            Damage = shield.BreakDamage,
                            RadiusMm = shield.BreakRadiusMm
                        }
                        : null,
                    RemainingAmount = shield.RemainingAmount
                };
            }

            return new PlayerSnapshot
            {
                EntityId = state.EntityId,
                PlayerId = state.PlayerId.ToString(),
                HeroId = state.HeroId.ToString(),
                ActiveAbilityId = state.ActiveAbilityId.ToString(),
                Position = new Int2Mm(
                    state.PositionX,
                    state.PositionZ),
                Facing = new Int2Mm(
                    state.FacingX,
                    state.FacingZ),
                Hp = state.Hp,
                MaxHp = state.MaxHp,
                AttackPower = state.AttackPower,
                MoveSpeedMmPerSecond =
                    state.MoveSpeedMmPerSecond,
                AttackRangeMm = state.AttackRangeMm,
                AttacksPerSecondMilli =
                    state.AttacksPerSecondMilli,
                LivesRemaining = state.LivesRemaining,
                TrueDeaths = state.TrueDeaths,
                LifeState = (LifeState)state.LifeState,
                AttackCooldownTicks =
                    state.AttackCooldownTicks,
                ActiveCooldownTicks =
                    state.ActiveCooldownTicks,
                ActiveBuffTicks = state.ActiveBuffTicks,
                Gold = state.Gold,
                Experience = state.Experience,
                Level = state.Level,
                Gems = state.Gems,
                WorldInteractionLockTicks =
                    state.WorldInteractionLockTicks,
                PvpCombatTicks = state.PvpCombatTicks,
                TaibaiChannelTicks =
                    state.TaibaiChannelTicks,
                TaibaiTargetHeroId =
                    state.TaibaiTargetHeroId.ToString(),
                TaibaiCooldownTicks =
                    state.TaibaiCooldownTicks,
                HeishanGambleCount =
                    state.HeishanGambleCount,
                TotalShield = state.TotalShield,
                WhirlwindTicks = state.WhirlwindTicks,
                B19RetriggerLockTicks =
                    state.B19RetriggerLockTicks,
                B20ReviveBuffTicks =
                    state.B20ReviveBuffTicks,
                InvulnerableTicks = state.InvulnerableTicks,
                IceCoffinTicks = state.IceCoffinTicks,
                B20ChargeAvailable =
                    state.B20ChargeAvailable,
                HasNineTurnPill = state.HasNineTurnPill,
                Passives = passiveSnapshots,
                Equipment = equipmentSnapshots.ToArray(),
                InventoryEquipment =
                    inventorySnapshots.ToArray(),
                Shields = shieldSnapshots
            };
        }

        private static string[] Split(FixedString128Bytes value)
        {
            var text = value.ToString();
            return string.IsNullOrEmpty(text)
                ? Array.Empty<string>()
                : text.Split('|');
        }
    }
}
