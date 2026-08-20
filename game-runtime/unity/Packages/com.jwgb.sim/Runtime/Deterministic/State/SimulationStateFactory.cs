using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class SimulationStateFactory
    {
        public static SimulationState Create(
            GameSimulationOptions options)
        {
            var mapField = options.MapEnabled
                ? new MapCollisionField(
                    MapGeometryCatalog.GeometryHash,
                    MapGeometryCatalog.Boundary,
                    MapGeometryCatalog.WallPieces)
                : null;
            var state = new SimulationState
            {
                RootSeed = unchecked((uint)options.RootSeed),
                ArenaRadiusMm = options.MapEnabled
                    ? checked((int)MapGeometryCatalog.InitialSafeRadiusMm)
                    : GameplayRules.ArenaRadiusMm,
                Random = new RandomStreams(options.RootSeed),
                PveEnabled = options.PveEnabled,
                PvePopulation = options.PvePopulation ==
                    PvePopulation.Full
                        ? "full"
                        : "demo",
                MapGeometryHash = options.MapEnabled
                    ? MapGeometryCatalog.GeometryHash
                    : null,
                MapField = mapField
            };
            StormZoneSystem.InitializeStormZone(state);
            if (options.MapEnabled)
            {
                var courts = MapGeometryCatalog.Courts;
                var courtIndex = (int)state.Random.StormLayout.NextInt(
                    (ulong)courts.Length);
                state.StormZone.SelectedCourtId = courts[courtIndex].Id;
            }

            var staticSolids = options.StaticSolids;
            if (staticSolids == null)
            {
                return state;
            }

            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < staticSolids.Length; index += 1)
            {
                var solid = staticSolids[index];
                if (!ids.Add(solid.SolidId))
                {
                    throw new ArgumentException(
                        $"Duplicate static solid {solid.SolidId}.",
                        nameof(staticSolids));
                }

                state.StaticSolids.Add(solid);
            }

            state.StaticSolids.Sort(
                (left, right) =>
                    string.CompareOrdinal(left.SolidId, right.SolidId));
            return state;
        }

        public static PlayerState AddPlayer(
            SimulationState state,
            AddPlayerOptions options)
        {
            if (state.Players.Count >= SpawnCapacity(state))
            {
                throw new InvalidOperationException(
                    "Player spawn capacity exhausted.");
            }

            if (options == null)
            {
                throw new ArgumentNullException(nameof(options));
            }

            var playerId = NormalizePlayerId(options.PlayerId);
            if (state.EntityIdByPlayerId.ContainsKey(playerId))
            {
                throw new InvalidOperationException($"Duplicate player {playerId}.");
            }

            var hero = HeroCatalog.Get(options.HeroId);
            var activeAbilityId = string.IsNullOrEmpty(options.ActiveAbilityId)
                ? hero.Active.Id
                : options.ActiveAbilityId;
            ActiveCatalog.Get(activeAbilityId);

            var passives = ValidatePassives(options.Passives);
            var equipmentIds = ValidateEquipment(options.EquipmentIds);
            var equipmentStats = EquipmentCatalog.GetStatTotals(equipmentIds);
            var spawn = options.HasPosition
                ? new SpawnSelection(
                    options.Position,
                    new Int2Mm(0, 1_000))
                : TakeInitialSpawn(state);
            var maxHp = checked(hero.Level1.MaxHp + equipmentStats.MaxHpFlat);
            var attacksPerSecondMilli = checked(
                hero.Level1.AttacksPerSecondMilli *
                (100 + equipmentStats.AttackSpeedPercent) /
                100);
            var entityId = state.NextEntityId;
            var player = new PlayerState
            {
                EntityId = entityId,
                PlayerId = playerId,
                HeroId = hero.Id,
                BasicAttackKind = hero.BasicAttackKind,
                Element = hero.Element,
                ActiveAbilityId = activeAbilityId,
                Position = spawn.Position,
                Facing = spawn.Facing,
                Hp = maxHp,
                MaxHp = maxHp,
                AttackPower = checked(hero.Level1.Attack + equipmentStats.AttackFlat),
                MoveSpeedMmPerSecond = checked(
                    hero.Level1.MoveSpeedMmPerSecond +
                    equipmentStats.MoveSpeedFlat),
                AttackRangeMm = checked(
                    hero.Level1.AttackRangeMm +
                    equipmentStats.BasicAttackRangeFlatMm),
                AttacksPerSecondMilli = attacksPerSecondMilli,
                AttackPeriodTicks = DivideCeiling(
                    SimulationConstants.TicksPerSecond * 1_000,
                    attacksPerSecondMilli),
                LivesRemaining = GameplayRules.PlayerLives,
                LifeState = LifeState.Alive,
                Intent = PlayerIntent.Neutral()
            };
            player.Passives.AddRange(passives);
            for (var index = 0; index < equipmentIds.Count; index += 1)
            {
                player.Equipment.Add(
                    new EquippedEquipmentInstance(
                        state.NextEquipmentInstanceId,
                        equipmentIds[index],
                        state.Tick,
                        0));
                state.NextEquipmentInstanceId += 1;
            }

            state.NextEntityId += 1;
            state.Players.Add(entityId, player);
            state.EntityIdByPlayerId.Add(playerId, entityId);
            return player;
        }

        private static string NormalizePlayerId(string value)
        {
            var normalized = value?.Trim();
            if (string.IsNullOrEmpty(normalized) || normalized.Length > 64)
            {
                throw new ArgumentException(
                    "Player id length must be 1-64.",
                    nameof(value));
            }

            return normalized;
        }

        private static List<PassiveLoadoutEntry> ValidatePassives(
            PassiveLoadoutEntry[] passives)
        {
            passives ??= Array.Empty<PassiveLoadoutEntry>();
            if (passives.Length > 4)
            {
                throw new ArgumentException("Passive loadout capacity exceeded.");
            }

            var result = new List<PassiveLoadoutEntry>(passives.Length);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < passives.Length; index += 1)
            {
                var entry = passives[index];
                PassiveCatalog.Get(entry.PassiveId);
                if (entry.Level < 1 || entry.Level > 5)
                {
                    throw new ArgumentOutOfRangeException(nameof(passives));
                }

                if (!ids.Add(entry.PassiveId))
                {
                    throw new ArgumentException("Duplicate passive in loadout.");
                }

                result.Add(entry);
            }

            return result;
        }

        private static List<string> ValidateEquipment(string[] equipmentIds)
        {
            equipmentIds ??= Array.Empty<string>();
            if (equipmentIds.Length > 3)
            {
                throw new ArgumentException("Equipped equipment capacity exceeded.");
            }

            var result = new List<string>(equipmentIds.Length);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < equipmentIds.Length; index += 1)
            {
                var id = equipmentIds[index];
                EquipmentCatalog.Get(id);
                if (!ids.Add(id))
                {
                    throw new ArgumentException("Duplicate equipped equipment.");
                }

                result.Add(id);
            }

            return result;
        }

        private static int SpawnCapacity(SimulationState state)
        {
            return state.MapField == null
                ? GameplayRules.SpawnPoints.Count
                : MapGeometryCatalog.SpawnPoints.Length;
        }

        private static SpawnSelection TakeInitialSpawn(
            SimulationState state)
        {
            var capacity = SpawnCapacity(state);
            var available = new List<int>(capacity);
            for (var index = 0; index < capacity; index += 1)
            {
                if (!state.InitialSpawnIndices.Contains(index))
                {
                    available.Add(index);
                }
            }

            var selected = available[
                (int)state.Random.Spawn.NextInt((ulong)available.Count)];
            state.InitialSpawnIndices.Add(selected);
            if (state.MapField == null)
            {
                return new SpawnSelection(
                    GameplayRules.SpawnPoints[selected],
                    new Int2Mm(0, 1_000));
            }

            var mapSpawn = MapGeometryCatalog.SpawnPoints[selected];
            return new SpawnSelection(
                ToInt2(mapSpawn.Position),
                ToInt2(mapSpawn.Facing));
        }

        private static Int2Mm ToInt2(MapPointMmRecord point)
        {
            return new Int2Mm(
                checked((int)point.X),
                checked((int)point.Z));
        }

        private static int DivideCeiling(int numerator, int denominator)
        {
            return checked((numerator + denominator - 1) / denominator);
        }

        private readonly struct SpawnSelection
        {
            public SpawnSelection(Int2Mm position, Int2Mm facing)
            {
                Position = position;
                Facing = facing;
            }

            public Int2Mm Position { get; }
            public Int2Mm Facing { get; }
        }
    }
}
