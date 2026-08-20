using System.Collections.Generic;

namespace Jwgb.Content
{
    public static class HeroCatalog
    {
        public static IReadOnlyList<HeroDefinition> All =>
            GeneratedGameplayCatalog.Heroes;

        public static HeroDefinition Get(string id)
        {
            return GeneratedGameplayCatalog.GetHero(id);
        }
    }
}
