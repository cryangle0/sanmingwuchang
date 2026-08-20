using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class SnapshotFactory
    {
        /// <summary>
        /// Reduced snapshot for server-side bot intent planning: tick,
        /// match summary and player snapshots only. Skips the state
        /// hash, every PVE/world collection and the per-player loadout
        /// arrays (passives/equipment/shields stay empty), which
        /// dominate full-snapshot cost, so the authoritative session
        /// can build it every tick without the 20 Hz allocation bill.
        /// All scalar player fields carry the same values a full
        /// snapshot would; planners must not read loadout arrays.
        /// </summary>
        public static WorldSnapshot CreatePlanning(SimulationState state)
        {
            var players = new PlayerSnapshot[state.Players.Count];
            var index = 0;
            foreach (var player in state.Players.Values)
            {
                players[index] = CreatePlayer(
                    state,
                    player,
                    includeCollections: false);
                index += 1;
            }

            return new WorldSnapshot
            {
                Tick = state.Tick,
                RootSeed = state.RootSeed,
                ArenaRadiusMm = state.ArenaRadiusMm,
                MapGeometryHash = state.MapGeometryHash,
                PveEnabled = state.PveEnabled,
                PvePopulation = state.PvePopulation,
                Match = new MatchSnapshot
                {
                    Status = state.Match.Status,
                    StartedAtTick = state.Match.StartedAtTick,
                    FinishedAtTick = state.Match.FinishedAtTick,
                    WinnerEntityId = state.Match.WinnerEntityId,
                    Placements = state.Match.Placements.ToArray()
                },
                Players = players
            };
        }

        private static PlayerSnapshot CreatePlayer(
            SimulationState state,
            PlayerState player)
        {
            return CreatePlayer(state, player, includeCollections: true);
        }

        private static PlayerSnapshot CreatePlayer(
            SimulationState state,
            PlayerState player,
            bool includeCollections)
        {
            var hasB20 = false;
            for (var index = 0; index < player.Passives.Count; index += 1)
            {
                if (player.Passives[index].PassiveId == GameplayIds.PassiveRevive)
                {
                    hasB20 = true;
                    break;
                }
            }

            var hasPill = false;
            for (var index = 0; index < player.Equipment.Count; index += 1)
            {
                if (player.Equipment[index].EquipmentId == GameplayIds.NineTurnPill)
                {
                    hasPill = true;
                    break;
                }
            }

            var snapshot = new PlayerSnapshot
            {
                EntityId = player.EntityId,
                PlayerId = player.PlayerId,
                HeroId = player.HeroId,
                ActiveAbilityId = player.ActiveAbilityId,
                Position = player.Position,
                Facing = player.Facing,
                Hp = player.Hp,
                MaxHp = player.MaxHp,
                AttackPower = player.AttackPower,
                MoveSpeedMmPerSecond = player.MoveSpeedMmPerSecond,
                AttackRangeMm = player.AttackRangeMm,
                AttacksPerSecondMilli = player.AttacksPerSecondMilli,
                LivesRemaining = player.LivesRemaining,
                TrueDeaths = player.TrueDeaths,
                LifeState = player.LifeState,
                AttackCooldownTicks = player.AttackCooldownTicks,
                ActiveCooldownTicks = player.ActiveCooldownTicks,
                ActiveBuffTicks = player.ActiveBuffTicks,
                HardControlTicks = player.HardControlTicks,
                SlowTicks = player.SlowTicks,
                SlowBasisPoints = player.SlowBasisPoints,
                SilenceTicks = player.SilenceTicks,
                SilenceCooldownPenaltyTicks =
                    player.SilenceCooldownPenaltyTicks,
                BlindTicks = player.BlindTicks,
                BlindMissPercent = player.BlindMissPercent,
                B15SpeedBoostTicks = player.B15SpeedBoostTicks,
                B15SpeedBonusPercent = player.B15SpeedBonusPercent,
                B21FirstHitReady = player.B21FirstHitReady,
                B25NextBasicBonusPercent =
                    player.B25NextBasicBonusPercent,
                B25AttackSpeedBoostTicks =
                    player.B25AttackSpeedBoostTicks,
                B25AttackSpeedBonusPercent =
                    player.B25AttackSpeedBonusPercent,
                B27SpeedBoostTicks = player.B27SpeedBoostTicks,
                B27SpeedBonusPercent = player.B27SpeedBonusPercent,
                B30NextAfterimageTick = player.B30NextAfterimageTick,
                B36Stacks = player.B36Stacks,
                B36MovingTicks = player.B36MovingTicks,
                B38NextHealTick = player.B38NextHealTick,
                B40KillCount = player.B40KillCount,
                B40BonusMaxHp = player.B40BonusMaxHp,
                B42SpeedBoostTicks = player.B42SpeedBoostTicks,
                B42SpeedBonusPercent = player.B42SpeedBonusPercent,
                LastCombatTick = player.LastCombatTick,
                PvpCombatTicks = player.PvpCombatTicks,
                TotalShield = ShieldSystem.GetTotal(player),
                WhirlwindTicks = player.WhirlwindTicks,
                WhirlwindNextPulseTick = player.WhirlwindNextPulseTick,
                B19RetriggerLockTicks = player.B19RetriggerLockTicks,
                B20ReviveBuffTicks = player.B20ReviveBuffTicks,
                InvulnerableTicks = player.InvulnerableTicks,
                IceCoffinTicks = player.IceCoffinTicks,
                AttackPeriodTicks = player.AttackPeriodTicks,
                RespawnTarget = player.RespawnTarget,
                ReviveProtectionTicks = player.ReviveProtectionTicks,
                MoveRemainderX = player.MoveRemainderX,
                MoveRemainderZ = player.MoveRemainderZ,
                Intent = player.Intent,
                Gold = player.Gold,
                Experience = player.Experience,
                Level = player.Level,
                Gems = player.Gems,
                WorldInteractionLockTicks =
                    player.WorldInteractionLockTicks,
                TaibaiChannelTicks = player.TaibaiChannelTicks,
                TaibaiTargetHeroId = player.TaibaiTargetHeroId,
                TaibaiCooldownTicks = player.TaibaiCooldownTicks,
                HeishanGambleCount = player.HeishanGambleCount,
                B20ChargeAvailable =
                    hasB20 &&
                    !state.ConsumedB20PlayerIds.Contains(player.PlayerId),
                HasNineTurnPill = hasPill
            };
            if (includeCollections)
            {
                snapshot.Passives = player.Passives.ToArray();
                snapshot.Equipment = player.Equipment.ToArray();
                snapshot.InventoryEquipment =
                    player.InventoryEquipment.ToArray();
                snapshot.Shields = CreateShields(player);
            }
            return snapshot;
        }

        private static ShieldSnapshot[] CreateShields(PlayerState player)
        {
            var ordered = new List<ShieldState>(player.Shields);
            ordered.Sort(
                (left, right) =>
                    left.CreationSequence.CompareTo(
                        right.CreationSequence));
            var snapshots = new ShieldSnapshot[ordered.Count];
            for (var index = 0; index < ordered.Count; index += 1)
            {
                var shield = ordered[index];
                var absorbs = new string[shield.Absorbs.Count];
                for (var formIndex = 0;
                    formIndex < absorbs.Length;
                    formIndex += 1)
                {
                    absorbs[formIndex] = SimulationText.DamageForm(
                        shield.Absorbs[formIndex]);
                }

                snapshots[index] = new ShieldSnapshot
                {
                    SourceKind = shield.SourceKind,
                    SourceId = shield.SourceId,
                    ExpiresAtTick = shield.ExpiresAtTick,
                    CreationSequence = shield.CreationSequence,
                    Absorbs = absorbs,
                    BreakEffect = shield.BreakEffect == null
                        ? null
                        : new ShieldBreakEffectSnapshot
                        {
                            SourceEntityId =
                                shield.BreakEffect.SourceEntityId,
                            SourceElement = SimulationText.Element(
                                shield.BreakEffect.SourceElement),
                            Damage = shield.BreakEffect.Damage,
                            RadiusMm = shield.BreakEffect.RadiusMm
                        },
                    RemainingAmount = shield.RemainingAmount
                };
            }

            return snapshots;
        }
    }
}
