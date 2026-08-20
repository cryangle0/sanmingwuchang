using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class LethalProtectionSystem
    {
        private const int DirectionCount = 8;

        public static bool Resolve(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            if (player.Hp > 0 || player.LifeState != LifeState.Alive)
            {
                return false;
            }

            return TryFeignDeath(state, events, player) ||
                TryPassiveRevive(state, events, player) ||
                TryNineTurnPill(state, events, player);
        }

        public static int GetOutgoingDamageBasisPoints(PlayerState player)
        {
            if (player.B20ReviveBuffTicks <= 0)
            {
                return 10_000;
            }

            return PassiveCatalog
                .Get(GameplayIds.PassiveRevive)
                .Level5DamageMultiplierBasisPoints;
        }

        public static bool HasControlImmunity(PlayerState player)
        {
            return player.B20ReviveBuffTicks > 0;
        }

        private static bool TryFeignDeath(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.FeignDeath,
                    out var loadout) ||
                player.B19RetriggerLockTicks > 0)
            {
                return false;
            }

            var definition = PassiveCatalog.Get(GameplayIds.FeignDeath);
            var chance = PassiveCatalog.LevelValue(
                definition.ChancePercentByLevel,
                loadout.Level);
            if (state.Random.Combat.NextInt(100) >= chance)
            {
                return false;
            }

            var previous = player.Position;
            var next = previous;
            if (loadout.Level == 5)
            {
                var directionIndex =
                    (int)state.Random.Combat.NextInt(DirectionCount);
                var offsets = CreateDirectionOffsets(
                    definition.Level5BlinkDistanceMm);
                next = FarthestLegalPoint(
                    previous,
                    offsets[directionIndex],
                    state.ArenaRadiusMm);
                player.Position = next;
            }

            var hpRestored = RestoreFromZero(
                player,
                PassiveCatalog.LevelValue(
                    definition.HealMaxHpPercentByLevel,
                    loadout.Level));
            player.B19RetriggerLockTicks =
                definition.PostSuccessRetriggerLockTicks;
            events.Add(
                new SimEvent
                {
                    Type = "lethal-protection",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    Protection = "b19-feign-death",
                    HpRestored = hpRestored,
                    PreviousPosition = previous,
                    NewPosition = next,
                    DidBlink = !previous.Equals(next)
                });
            return true;
        }

        private static bool TryPassiveRevive(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.PassiveRevive,
                    out var loadout) ||
                state.ConsumedB20PlayerIds.Contains(player.PlayerId))
            {
                return false;
            }

            var definition = PassiveCatalog.Get(GameplayIds.PassiveRevive);
            state.ConsumedB20PlayerIds.Add(player.PlayerId);
            var hpRestored = RestoreFromZero(
                player,
                PassiveCatalog.LevelValue(
                    definition.HealMaxHpPercentByLevel,
                    loadout.Level));
            player.B20ReviveBuffTicks =
                loadout.Level == 5 ? definition.Level5BuffTicks : 0;
            events.Add(
                new SimEvent
                {
                    Type = "lethal-protection",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    Protection = "b20-passive-revive",
                    HpRestored = hpRestored,
                    BuffTicks = player.B20ReviveBuffTicks
                });
            return true;
        }

        private static bool TryNineTurnPill(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player)
        {
            var equipmentIndex = -1;
            for (var index = 0; index < player.Equipment.Count; index += 1)
            {
                if (player.Equipment[index].EquipmentId ==
                    GameplayIds.NineTurnPill)
                {
                    equipmentIndex = index;
                    break;
                }
            }

            if (equipmentIndex < 0)
            {
                return false;
            }

            var instance = player.Equipment[equipmentIndex];
            var definition = EquipmentCatalog.Get(GameplayIds.NineTurnPill);
            player.Equipment.RemoveAt(equipmentIndex);
            var hpRestored = RestoreFromZero(
                player,
                definition.RestoreHpPercent);
            player.InvulnerableTicks = definition.InvulnerableTicks;
            events.Add(
                new SimEvent
                {
                    Type = "lethal-protection",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    Protection = "g1-nine-turn-pill",
                    HpRestored = hpRestored,
                    ConsumedEquipmentInstanceId = instance.InstanceId,
                    InvulnerableTicks = player.InvulnerableTicks
                });
            return true;
        }

        private static int RestoreFromZero(
            PlayerState player,
            int maxHpPercent)
        {
            var restored = Math.Max(
                1,
                checked(player.MaxHp * maxHpPercent / 100));
            player.Hp = Math.Min(player.MaxHp, restored);
            return player.Hp;
        }

        private static Int2Mm[] CreateDirectionOffsets(int distanceMm)
        {
            var diagonal = checked(
                (int)IntegerMath.IntegerSquareRoot(
                    checked((long)distanceMm * distanceMm / 2)));
            return new[]
            {
                new Int2Mm(distanceMm, 0),
                new Int2Mm(diagonal, diagonal),
                new Int2Mm(0, distanceMm),
                new Int2Mm(-diagonal, diagonal),
                new Int2Mm(-distanceMm, 0),
                new Int2Mm(-diagonal, -diagonal),
                new Int2Mm(0, -distanceMm),
                new Int2Mm(diagonal, -diagonal)
            };
        }

        private static Int2Mm FarthestLegalPoint(
            Int2Mm origin,
            Int2Mm offset,
            int arenaRadiusMm)
        {
            var legalBasisPoints = 0;
            var illegalBasisPoints = 10_001;
            while (illegalBasisPoints - legalBasisPoints > 1)
            {
                var candidateBasisPoints =
                    (legalBasisPoints + illegalBasisPoints) / 2;
                var candidate = PointAlongOffset(
                    origin,
                    offset,
                    candidateBasisPoints);
                if (IntegerMath.DistanceSquared(
                        candidate,
                        new Int2Mm(0, 0)) <=
                    (long)arenaRadiusMm * arenaRadiusMm)
                {
                    legalBasisPoints = candidateBasisPoints;
                }
                else
                {
                    illegalBasisPoints = candidateBasisPoints;
                }
            }

            return PointAlongOffset(origin, offset, legalBasisPoints);
        }

        private static Int2Mm PointAlongOffset(
            Int2Mm origin,
            Int2Mm offset,
            int basisPoints)
        {
            return new Int2Mm(
                checked(
                    origin.X +
                    (int)((long)offset.X * basisPoints / 10_000)),
                checked(
                    origin.Z +
                    (int)((long)offset.Z * basisPoints / 10_000)));
        }
    }
}
