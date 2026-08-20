using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class MonsterDamageSystem
    {
        private static readonly string[] FlyingBookPool =
        {
            "B03", "B15", "B27", "B28", "B30"
        };

        private static readonly string[] PigBookPool =
        {
            "B31", "B32", "B33", "B34", "B35", "B41", "B42"
        };

        private static readonly string[] EliteTankBookPool =
        {
            "B16", "B17", "B18", "B20", "B21", "B24", "B38", "B40"
        };

        private static readonly string[] EliteRangedBookPool =
        {
            "B06", "B07", "B08", "B09", "B10", "B11", "B26", "B29"
        };

        /// <summary>Mirrors M1_GENERIC_ACTIVES order in the TS oracle.</summary>
        internal static readonly string[] GenericActiveIds =
        {
            "D1", "D3", "D4", "D6", "D7", "D9", "D10", "D11", "D12",
            "D13", "D14", "D15", "D16", "D17", "D18", "D19", "D20",
            "D21", "D22"
        };

        private static readonly Dictionary<FiveElement, string[]>
            DragonThemes = new Dictionary<FiveElement, string[]>
            {
                [FiveElement.Metal] = new[]
                {
                    "W1", "W4", "B6", "P1", "P11", "G6", "G8", "G9", "G10"
                },
                [FiveElement.Wood] = new[]
                {
                    "W2", "B5", "B8", "P4", "P5", "P7", "P14", "G5", "G9"
                },
                [FiveElement.Water] = new[]
                {
                    "W3", "B3", "B12", "B13", "P6", "P8", "P15", "G4", "G7"
                },
                [FiveElement.Fire] = new[]
                {
                    "W1", "B10", "B11", "P2", "P3", "P4", "G8", "G10"
                },
                [FiveElement.Earth] = new[]
                {
                    "W2", "W5", "W6", "B2", "B7", "P9", "P12", "G1", "G3"
                }
            };

        private static int MonsterGold(MonsterState monster)
        {
            return monster.Kind switch
            {
                MonsterKind.GroundMelee or MonsterKind.GroundRanged =>
                    monster.Ring == MonsterRing.Outer
                        ? 90
                        : monster.Ring == MonsterRing.Middle ? 140 : 180,
                MonsterKind.Flying =>
                    monster.Ring == MonsterRing.Outer
                        ? 140
                        : monster.Ring == MonsterRing.Middle ? 200 : 260,
                MonsterKind.Pig => 700,
                MonsterKind.EliteTank or MonsterKind.EliteRanged => 1_400,
                MonsterKind.DragonKing => 2_000,
                MonsterKind.CoreBoss => 3_000,
                _ => 0
            };
        }

        private static int MonsterExperience(MonsterState monster)
        {
            return monster.Kind switch
            {
                MonsterKind.GroundMelee or MonsterKind.GroundRanged =>
                    monster.Ring == MonsterRing.Outer
                        ? 28
                        : monster.Ring == MonsterRing.Middle ? 40 : 56,
                MonsterKind.Flying =>
                    monster.Ring == MonsterRing.Outer
                        ? 40
                        : monster.Ring == MonsterRing.Middle ? 56 : 78,
                MonsterKind.Pig => 80,
                MonsterKind.EliteTank or MonsterKind.EliteRanged => 200,
                MonsterKind.DragonKing => 300,
                MonsterKind.CoreBoss => 400,
                _ => 0
            };
        }

        private static string[] PassiveBookPool(MonsterState monster)
        {
            switch (monster.Kind)
            {
                case MonsterKind.Flying:
                    return FlyingBookPool;
                case MonsterKind.Pig:
                    return PigBookPool;
                case MonsterKind.EliteTank:
                    return EliteTankBookPool;
                case MonsterKind.EliteRanged:
                    return EliteRangedBookPool;
                default:
                {
                    var passives = GeneratedGameplayCatalog.Passives;
                    var pool = new string[passives.Length];
                    for (var index = 0; index < passives.Length; index += 1)
                    {
                        pool[index] = passives[index].Id;
                    }

                    return pool;
                }
            }
        }

        private static int PassiveBookCount(
            SimulationState state,
            MonsterState monster)
        {
            switch (monster.Kind)
            {
                case MonsterKind.GroundMelee:
                case MonsterKind.GroundRanged:
                    return state.Random.Combat.NextInt(100) < 10 ? 1 : 0;
                case MonsterKind.Flying:
                    return state.Random.Combat.NextInt(100) < 20 ? 1 : 0;
                case MonsterKind.Pig:
                    return state.Random.Combat.NextInt(100) < 55 ? 1 : 0;
                case MonsterKind.EliteTank:
                case MonsterKind.EliteRanged:
                    return 1;
                case MonsterKind.CoreBoss:
                    return 2;
                default:
                    return 0;
            }
        }

        private static string ChoosePassiveBook(
            SimulationState state,
            MonsterState monster)
        {
            var pool = PassiveBookPool(monster);
            return pool[state.Random.Combat.NextInt((ulong)pool.Length)];
        }

        private static int ChooseRarity(
            SimulationState state,
            MonsterState monster,
            int sourceEntityId)
        {
            // 0 white, 1 blue, 2 purple, 3 gold; -1 none.
            if (monster.Kind == MonsterKind.Pig)
            {
                var roll = (int)state.Random.Combat.NextInt(100);
                return roll < 60 ? 0 : roll < 90 ? 1 : 2;
            }

            if (monster.Kind == MonsterKind.EliteTank ||
                monster.Kind == MonsterKind.EliteRanged)
            {
                var roll = (int)state.Random.Combat.NextInt(100);
                return roll < 35 ? 0 : roll < 75 ? 1 : 2;
            }

            if (monster.Kind == MonsterKind.DragonKing)
            {
                var roll = (int)state.Random.Combat.NextInt(100);
                var rarity = roll < 55 ? 1 : roll < 90 ? 2 : 3;
                if (state.Players.TryGetValue(
                        sourceEntityId,
                        out var source) &&
                    monster.Element.HasValue &&
                    GameplayRules.ElementDamageBasisPoints(
                        source.Element,
                        monster.Element.Value) > 10_000 &&
                    rarity < 3)
                {
                    rarity += 1;
                }

                return rarity;
            }

            if (monster.Kind == MonsterKind.CoreBoss)
            {
                return state.Random.Combat.NextInt(100) < 75 ? 2 : 3;
            }

            return -1;
        }

        private static EquipmentRarity RarityFromRank(int rank)
        {
            return rank switch
            {
                0 => EquipmentRarity.White,
                1 => EquipmentRarity.Blue,
                2 => EquipmentRarity.Purple,
                _ => EquipmentRarity.Gold
            };
        }

        private static string ChooseEquipment(
            SimulationState state,
            MonsterState monster,
            int sourceEntityId)
        {
            if (monster.Kind == MonsterKind.Pig &&
                state.Random.Combat.NextInt(100) >= 20)
            {
                return null;
            }

            if ((monster.Kind == MonsterKind.EliteTank ||
                 monster.Kind == MonsterKind.EliteRanged) &&
                state.Random.Combat.NextInt(100) >= 65)
            {
                return null;
            }

            var rarityRank = ChooseRarity(state, monster, sourceEntityId);
            if (rarityRank < 0)
            {
                return null;
            }

            var rarity = RarityFromRank(rarityRank);
            var candidates = new List<EquipmentDefinition>();
            var all = GeneratedGameplayCatalog.Equipment;
            for (var index = 0; index < all.Length; index += 1)
            {
                if (all[index].Rarity == rarity &&
                    all[index].Id != GameplayIds.NineTurnPill)
                {
                    candidates.Add(all[index]);
                }
            }

            if (monster.Kind == MonsterKind.Pig)
            {
                var themed = candidates.FindAll(
                    equipment =>
                        equipment.Id == GameplayIds.TreasureBag ||
                        equipment.Id == GameplayIds.NightWatchLamp ||
                        equipment.Id == GameplayIds.ClothBag ||
                        equipment.Id == GameplayIds.GamblingMedal ||
                        equipment.Id == GameplayIds.DemonRevealingPearl);
                if (themed.Count > 0)
                {
                    candidates = themed;
                }
            }
            else if (monster.Kind == MonsterKind.EliteTank)
            {
                var themed = candidates.FindAll(
                    equipment => equipment.MaxHpFlat != 0);
                if (themed.Count > 0)
                {
                    candidates = themed;
                }
            }
            else if (monster.Kind == MonsterKind.EliteRanged)
            {
                var themed = candidates.FindAll(
                    equipment => equipment.AttackFlat != 0);
                if (themed.Count > 0)
                {
                    candidates = themed;
                }
            }
            else if (monster.Kind == MonsterKind.DragonKing &&
                monster.Element.HasValue)
            {
                var themeIds = DragonThemes[monster.Element.Value];
                var themed = candidates.FindAll(
                    equipment =>
                        System.Array.IndexOf(themeIds, equipment.Id) >= 0);
                if (themed.Count > 0)
                {
                    candidates = themed;
                }
            }

            if (candidates.Count == 0)
            {
                return null;
            }

            return candidates[
                (int)state.Random.Combat.NextInt((ulong)candidates.Count)].Id;
        }

        private static string ChooseCoreGoldenCudgel(SimulationState state)
        {
            if (state.GoldenCudgelDropped ||
                state.Random.Combat.NextInt(100) >= 5)
            {
                return null;
            }

            state.GoldenCudgelDropped = true;
            return GameplayIds.GoldenCudgel;
        }

        private static string ChooseActiveDrop(
            SimulationState state,
            MonsterState monster)
        {
            if (monster.Kind == MonsterKind.CoreBoss)
            {
                return GenericActiveIds[
                    state.Random.Combat.NextInt(
                        (ulong)GenericActiveIds.Length)];
            }

            if (monster.Kind == MonsterKind.EliteTank ||
                monster.Kind == MonsterKind.EliteRanged)
            {
                return state.Random.Combat.NextInt(100) < 10
                    ? GenericActiveIds[
                        state.Random.Combat.NextInt(
                            (ulong)GenericActiveIds.Length)]
                    : null;
            }

            return null;
        }

        private static LootDropState CreateCurrencyDrop(
            SimulationState state,
            MonsterState monster,
            int goldMultiplier,
            int experienceMultiplier)
        {
            var gems = monster.Kind == MonsterKind.CoreBoss ||
                monster.Kind == MonsterKind.DragonKing
                ? 3
                : monster.Kind == MonsterKind.EliteTank ||
                    monster.Kind == MonsterKind.EliteRanged
                    ? 2
                    : state.Random.Combat.NextInt(100) <
                        (monster.Kind == MonsterKind.Pig ? 60 : 30)
                        ? 1
                        : 0;
            return LootRuntime.CreateRuntimeLootDrop(
                state,
                monster.Position,
                "currency",
                gold: System.Math.Max(
                    0,
                    MonsterGold(monster) * goldMultiplier),
                experience: System.Math.Max(
                    0,
                    MonsterExperience(monster) * experienceMultiplier),
                gems: gems,
                expiresAtTick: state.Tick +
                    60 * SimulationConstants.TicksPerSecond);
        }

        private static List<LootDropState> CreateLootDrops(
            SimulationState state,
            MonsterState monster,
            int sourceEntityId,
            int goldMultiplier,
            int experienceMultiplier)
        {
            var drops = new List<LootDropState>
            {
                CreateCurrencyDrop(
                    state,
                    monster,
                    goldMultiplier,
                    experienceMultiplier)
            };
            // The TS oracle re-evaluates passiveBookCount in the loop
            // condition, drawing combat RNG again after a successful book
            // roll; keep the call in the condition to consume identical
            // draws.
            for (var index = 0;
                index < PassiveBookCount(state, monster);
                index += 1)
            {
                drops.Add(
                    LootRuntime.CreateRuntimeLootDrop(
                        state,
                        monster.Position,
                        "skill-book",
                        bookPassiveId: ChoosePassiveBook(state, monster)));
            }

            var equipmentId = ChooseEquipment(
                state,
                monster,
                sourceEntityId);
            if (equipmentId != null)
            {
                drops.Add(
                    LootRuntime.CreateRuntimeLootDrop(
                        state,
                        monster.Position,
                        "equipment",
                        equipmentId: equipmentId));
                if (monster.Kind == MonsterKind.CoreBoss)
                {
                    var goldenCudgel = ChooseCoreGoldenCudgel(state);
                    if (goldenCudgel != null)
                    {
                        drops.Add(
                            LootRuntime.CreateRuntimeLootDrop(
                                state,
                                monster.Position,
                                "equipment",
                                equipmentId: goldenCudgel));
                    }
                }
            }

            var activeId = ChooseActiveDrop(state, monster);
            if (activeId != null)
            {
                drops.Add(
                    LootRuntime.CreateRuntimeLootDrop(
                        state,
                        monster.Position,
                        "active",
                        activeId: activeId,
                        expiresAtTick: state.Tick +
                            120 * SimulationConstants.TicksPerSecond));
            }

            return drops;
        }
    }
}
