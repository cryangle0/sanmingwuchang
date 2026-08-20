using System;

namespace Jwgb.Client.Presentation
{
    public readonly struct HeroModelSourceDefinition
    {
        public HeroModelSourceDefinition(
            string heroId,
            string sourceName,
            string displayName,
            float height = 2.2f)
        {
            HeroId = heroId;
            SourceName = sourceName;
            DisplayName = displayName;
            Height = height;
        }

        public string HeroId { get; }

        public string SourceName { get; }

        public string DisplayName { get; }

        public float Height { get; }
    }

    public readonly struct MonsterModelSourceDefinition
    {
        public MonsterModelSourceDefinition(
            string modelId,
            string sourceName,
            string kind)
        {
            ModelId = modelId;
            SourceName = sourceName;
            Kind = kind;
        }

        public string ModelId { get; }

        public string SourceName { get; }

        public string Kind { get; }

        public float Height => Kind switch
        {
            "elite-tank" or "elite-ranged" => 2.6f,
            "dragon-king" => 3.8f,
            "core-boss" => 4.4f,
            _ => 1.7f
        };
    }

    public static class ModelVisualCatalogDefaults
    {
        public static readonly string[] MonsterKinds =
        {
            "ground-melee",
            "ground-ranged",
            "flying",
            "pig",
            "elite-tank",
            "elite-ranged",
            "dragon-king",
            "core-boss"
        };

        public static readonly HeroModelSourceDefinition[] Heroes =
        {
            Hero("H001", "铁山公主", "铁扇公主"),
            Hero("H002", "红孩儿"),
            Hero("H003", "蜘蛛精"),
            Hero("H004", "蝎子精"),
            Hero("H005", "多目怪"),
            Hero("H006", "九头虫", height: 2.4f),
            Hero("H007", "黄风怪", height: 2.4f),
            Hero("H008", "太上老君"),
            Hero("H009", "孙悟空"),
            Hero("H010", "二郎神"),
            Hero("H011", "哪吒"),
            Hero("H012", "六耳猕猴"),
            Hero("H013", "大鹏雕", height: 2.5f),
            Hero("H014", "白骨精"),
            Hero("H015", "猪八戒"),
            Hero("H016", "白龙马"),
            Hero("H017", "青狮精", "青狮怪"),
            Hero("H018", "牛魔王"),
            Hero("H019", "独角四大王", "独角兕大王"),
            Hero("H020", "黄眉老祖"),
            Hero("H021", "金角大王"),
            Hero("H022", "银角大王"),
            Hero("H023", "黄袍怪"),
            Hero("H024", "虎力大仙"),
            Hero("H025", "鹿力大仙"),
            Hero("H026", "文殊菩萨"),
            Hero("H027", "普贤菩萨"),
            Hero("H028", "镇元大仙"),
            Hero("H029", "如来", "如来佛祖"),
            Hero("H030", "观音菩萨"),
            Hero("H031", "托塔李天王"),
            Hero("H032", "唐僧"),
            Hero("H033", "沙和尚"),
            Hero("H034", "黑熊精"),
            Hero("H035", "白象精"),
            Hero("H036", "灵感大王"),
            Hero("H037", "羊力大仙"),
            Hero("H038", "赛太岁")
        };

        public static readonly MonsterModelSourceDefinition[] Monsters =
        {
            Monster("M001", "倚海龙", "ground-melee"),
            Monster("M002", "刁钻古怪", "ground-ranged"),
            Monster("M003", "南山大王（精英怪）", "elite-tank"),
            Monster("M004", "古怪刁钻", "ground-melee"),
            Monster("M005", "如意真仙", "ground-ranged"),
            Monster("M006", "孔雀公主（飞行）", "flying"),
            Monster("M007", "寅将军（精英怪）", "elite-ranged"),
            Monster("M008", "巴山虎", "ground-melee"),
            Monster("M009", "晦月魔君（飞行）", "flying"),
            Monster("M010", "树鬼", "ground-melee"),
            Monster("M011", "混天大圣（飞行）", "flying"),
            Monster("M012", "火鸦精", "flying"),
            Monster("M013", "熊山君（精英怪）", "elite-tank"),
            Monster("M014", "特处士（精英怪）", "elite-ranged"),
            Monster("M015", "玉面狐狸（肥猪）", "pig"),
            Monster("M016", "碧水金睛兽（飞行）", "flying"),
            Monster("M017", "红鳞大蟒", "ground-melee"),
            Monster("M018", "肥猪（土）", "pig"),
            Monster("M019", "肥猪（木）", "pig"),
            Monster("M020", "肥猪（水）", "pig"),
            Monster("M021", "肥猪（火）", "pig"),
            Monster("M022", "肥猪（金）", "pig"),
            Monster("M023", "苍狼精", "ground-melee"),
            Monster("M024", "虎精小妖", "ground-melee"),
            Monster("M025", "蛇精小妖", "ground-ranged"),
            Monster("M026", "蜘蛛仔", "ground-melee"),
            Monster("M027", "超级BOSS九灵元圣", "core-boss"),
            Monster("M028", "超级BOSS地涌夫人", "core-boss"),
            Monster("M029", "超级BOSS白鹿魔王", "core-boss"),
            Monster("M030", "超级BOSS辟寒大王", "core-boss"),
            Monster("M031", "超级BOSS辟尘大王", "core-boss"),
            Monster("M032", "超级BOSS辟暑大王", "core-boss"),
            Monster("M033", "黄狮精", "ground-melee"),
            Monster("M034", "龙王（土）", "dragon-king"),
            Monster("M035", "龙王（木）", "dragon-king"),
            Monster("M036", "龙王（水）", "dragon-king"),
            Monster("M037", "龙王（火）", "dragon-king"),
            Monster("M038", "龙王（金）", "dragon-king")
        };

        public static bool TryGetHeroIdBySourceName(
            string sourceName,
            out string heroId)
        {
            for (var index = 0; index < Heroes.Length; index += 1)
            {
                if (string.Equals(
                    Heroes[index].SourceName,
                    sourceName,
                    StringComparison.Ordinal))
                {
                    heroId = Heroes[index].HeroId;
                    return true;
                }
            }

            heroId = null;
            return false;
        }

        private static HeroModelSourceDefinition Hero(
            string heroId,
            string sourceName,
            string displayName = null,
            float height = 2.2f)
        {
            return new HeroModelSourceDefinition(
                heroId,
                sourceName,
                displayName ?? sourceName,
                height);
        }

        private static MonsterModelSourceDefinition Monster(
            string modelId,
            string sourceName,
            string kind)
        {
            return new MonsterModelSourceDefinition(
                modelId,
                sourceName,
                kind);
        }
    }
}
