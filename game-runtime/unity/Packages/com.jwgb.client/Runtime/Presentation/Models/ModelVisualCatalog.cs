using System;
using System.Collections.Generic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    [Serializable]
    public sealed class HeroModelVisualEntry
    {
        public string HeroId;
        public string DisplayName;
        public string SourceName;
        public GameObject Prefab;
        public float Height = 2.2f;
        public float GroundOffset;
    }

    [Serializable]
    public sealed class MonsterModelVisualEntry
    {
        public string ModelId;
        public string DisplayName;
        public string Kind;
        public GameObject Prefab;
        public float Height = 1.7f;
        public float GroundOffset;
    }

    public readonly struct ModelVisualDefinition
    {
        public ModelVisualDefinition(
            string modelId,
            string displayName,
            GameObject prefab,
            float height,
            float groundOffset)
        {
            ModelId = modelId;
            DisplayName = displayName;
            Prefab = prefab;
            Height = height;
            GroundOffset = groundOffset;
        }

        public string ModelId { get; }

        public string DisplayName { get; }

        public GameObject Prefab { get; }

        public float Height { get; }

        public float GroundOffset { get; }

        public bool IsValid => Prefab != null;
    }

    [CreateAssetMenu(
        fileName = "ModelVisualCatalog",
        menuName = "JWGB/Model Visual Catalog")]
    public sealed class ModelVisualCatalog : ScriptableObject
    {
        public const string AssetPath =
            "Assets/Jwgb/Settings/Models/ModelVisualCatalog.asset";

        [SerializeField]
        private HeroModelVisualEntry[] heroes =
            Array.Empty<HeroModelVisualEntry>();

        [SerializeField]
        private MonsterModelVisualEntry[] monsters =
            Array.Empty<MonsterModelVisualEntry>();

        public int HeroCount => heroes?.Length ?? 0;

        public int MonsterCount => monsters?.Length ?? 0;

        public IReadOnlyList<HeroModelVisualEntry> Heroes => heroes;

        public IReadOnlyList<MonsterModelVisualEntry> Monsters => monsters;

        public bool TryResolveHero(
            string heroId,
            out ModelVisualDefinition definition)
        {
            if (heroes != null)
            {
                for (var index = 0; index < heroes.Length; index += 1)
                {
                    var entry = heroes[index];
                    if (entry != null &&
                        string.Equals(
                            entry.HeroId,
                            heroId,
                            StringComparison.Ordinal) &&
                        entry.Prefab != null)
                    {
                        definition = CreateDefinition(
                            entry.HeroId,
                            entry.DisplayName,
                            entry.Prefab,
                            entry.Height,
                            entry.GroundOffset);
                        return true;
                    }
                }
            }

            definition = default;
            return false;
        }

        public bool TryResolveMonster(
            string kind,
            int entityId,
            out ModelVisualDefinition definition)
        {
            return TryResolveMonster(
                kind,
                entityId,
                null,
                0,
                out definition);
        }

        public bool TryResolveMonster(
            string kind,
            int entityId,
            string element,
            out ModelVisualDefinition definition)
        {
            return TryResolveMonster(
                kind,
                entityId,
                element,
                0,
                out definition);
        }

        public bool TryResolveMonster(
            string kind,
            int entityId,
            string element,
            uint rootSeed,
            out ModelVisualDefinition definition)
        {
            if (TryResolveElementalMonster(
                    kind,
                    entityId,
                    element,
                    out definition))
            {
                return true;
            }

            if (string.Equals(
                    kind,
                    "core-boss",
                    StringComparison.Ordinal))
            {
                return TryResolveMonsterById(
                    $"M{27 + rootSeed % 6:D3}",
                    out definition);
            }

            var count = 0;
            if (monsters != null)
            {
                for (var index = 0; index < monsters.Length; index += 1)
                {
                    var entry = monsters[index];
                    if (entry != null &&
                        entry.Prefab != null &&
                        string.Equals(
                            entry.Kind,
                            kind,
                            StringComparison.Ordinal))
                    {
                        count += 1;
                    }
                }
            }

            if (count == 0)
            {
                definition = default;
                return false;
            }

            var target = (int)(Math.Abs((long)entityId) % count);
            for (var index = 0; index < monsters.Length; index += 1)
            {
                var entry = monsters[index];
                if (entry == null ||
                    entry.Prefab == null ||
                    !string.Equals(
                        entry.Kind,
                        kind,
                        StringComparison.Ordinal))
                {
                    continue;
                }

                if (target > 0)
                {
                    target -= 1;
                    continue;
                }

                definition = CreateDefinition(
                    entry.ModelId,
                    entry.DisplayName,
                    entry.Prefab,
                    entry.Height,
                    entry.GroundOffset);
                return true;
            }

            definition = default;
            return false;
        }

        private bool TryResolveElementalMonster(
            string kind,
            int entityId,
            string element,
            out ModelVisualDefinition definition)
        {
            var modelId = kind switch
            {
                "pig" when !string.IsNullOrWhiteSpace(element) =>
                    Math.Abs((long)entityId) % 6 == 0
                        ? "M015"
                        : ElementalPigModelId(element),
                "dragon-king" when !string.IsNullOrWhiteSpace(element) =>
                    ElementalDragonModelId(element),
                _ => null
            };
            if (!string.IsNullOrEmpty(modelId))
            {
                return TryResolveMonsterById(
                    modelId,
                    out definition);
            }

            definition = default;
            return false;
        }

        private bool TryResolveMonsterById(
            string modelId,
            out ModelVisualDefinition definition)
        {
            if (monsters != null)
            {
                for (var index = 0; index < monsters.Length; index += 1)
                {
                    var entry = monsters[index];
                    if (entry != null &&
                        entry.Prefab != null &&
                        string.Equals(
                            entry.ModelId,
                            modelId,
                            StringComparison.Ordinal))
                    {
                        definition = CreateDefinition(
                            entry.ModelId,
                            entry.DisplayName,
                            entry.Prefab,
                            entry.Height,
                            entry.GroundOffset);
                        return true;
                    }
                }
            }

            definition = default;
            return false;
        }

        private static string ElementalPigModelId(string element)
        {
            return element switch
            {
                "earth" => "M018",
                "wood" => "M019",
                "water" => "M020",
                "fire" => "M021",
                "metal" => "M022",
                _ => null
            };
        }

        private static string ElementalDragonModelId(string element)
        {
            return element switch
            {
                "earth" => "M034",
                "wood" => "M035",
                "water" => "M036",
                "fire" => "M037",
                "metal" => "M038",
                _ => null
            };
        }

        public string[] ValidateEntries()
        {
            var errors = new List<string>();
            var heroIds = new HashSet<string>(StringComparer.Ordinal);
            var modelIds = new HashSet<string>(StringComparer.Ordinal);
            if (heroes == null || heroes.Length != 38)
            {
                errors.Add($"Expected 38 heroes, found {HeroCount}.");
            }
            if (monsters == null || monsters.Length != 38)
            {
                errors.Add($"Expected 38 monsters, found {MonsterCount}.");
            }

            if (heroes != null)
            {
                for (var index = 0; index < heroes.Length; index += 1)
                {
                    var entry = heroes[index];
                    if (entry == null ||
                        string.IsNullOrWhiteSpace(entry.HeroId) ||
                        !heroIds.Add(entry.HeroId))
                    {
                        errors.Add($"Invalid hero entry at index {index}.");
                    }
                    else if (entry.Prefab == null)
                    {
                        errors.Add($"{entry.HeroId} has no prefab.");
                    }
                }
            }

            if (monsters != null)
            {
                for (var index = 0; index < monsters.Length; index += 1)
                {
                    var entry = monsters[index];
                    if (entry == null ||
                        string.IsNullOrWhiteSpace(entry.ModelId) ||
                        string.IsNullOrWhiteSpace(entry.Kind) ||
                        !modelIds.Add(entry.ModelId))
                    {
                        errors.Add($"Invalid monster entry at index {index}.");
                    }
                    else if (entry.Prefab == null)
                    {
                        errors.Add($"{entry.ModelId} has no prefab.");
                    }
                }
            }

            foreach (var kind in ModelVisualCatalogDefaults.MonsterKinds)
            {
                var found = false;
                if (monsters != null)
                {
                    for (var index = 0;
                        index < monsters.Length && !found;
                        index += 1)
                    {
                        found = monsters[index] != null &&
                            monsters[index].Prefab != null &&
                            string.Equals(
                                monsters[index].Kind,
                                kind,
                                StringComparison.Ordinal);
                    }
                }
                if (!found)
                {
                    errors.Add($"{kind} has no model.");
                }
            }

            return errors.ToArray();
        }

        public void ReplaceEntries(
            HeroModelVisualEntry[] heroEntries,
            MonsterModelVisualEntry[] monsterEntries)
        {
            heroes = heroEntries ?? Array.Empty<HeroModelVisualEntry>();
            monsters = monsterEntries ?? Array.Empty<MonsterModelVisualEntry>();
        }

        private static ModelVisualDefinition CreateDefinition(
            string modelId,
            string displayName,
            GameObject prefab,
            float height,
            float groundOffset)
        {
            return new ModelVisualDefinition(
                modelId,
                displayName,
                prefab,
                Mathf.Max(0.1f, height),
                groundOffset);
        }
    }
}
