using System.Collections.Generic;

namespace Jwgb.Content
{
    public static class EquipmentCatalog
    {
        public static EquipmentDefinition Get(string id)
        {
            return GeneratedGameplayCatalog.GetEquipment(id);
        }

        public static EquipmentStatTotals GetStatTotals(IReadOnlyList<string> ids)
        {
            return GeneratedGameplayCatalog.GetStatTotals(ids);
        }
    }
}
