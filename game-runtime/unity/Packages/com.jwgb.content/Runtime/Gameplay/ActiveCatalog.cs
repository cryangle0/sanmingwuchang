namespace Jwgb.Content
{
    public static class ActiveCatalog
    {
        public static ActiveDefinition Get(string id)
        {
            return GeneratedGameplayCatalog.GetActive(id);
        }
    }
}
