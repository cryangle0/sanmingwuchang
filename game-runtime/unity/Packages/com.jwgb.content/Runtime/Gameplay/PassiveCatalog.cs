using System;
namespace Jwgb.Content
{
    public static class PassiveCatalog
    {
        public static PassiveDefinition Get(string id)
        {
            return GeneratedGameplayCatalog.GetPassive(id);
        }

        public static int LevelValue(int[] values, int level)
        {
            if (values == null || level < 1 || level > values.Length)
            {
                throw new ArgumentOutOfRangeException(nameof(level));
            }

            return values[level - 1];
        }
    }
}
