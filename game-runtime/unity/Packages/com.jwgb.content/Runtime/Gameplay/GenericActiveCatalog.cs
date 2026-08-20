namespace Jwgb.Content
{
    public static class GenericActiveCatalog
    {
        public static bool TryGet(string id, out ActiveDefinition definition)
        {
            if (string.IsNullOrEmpty(id) || id[0] != 'D')
            {
                definition = null;
                return false;
            }

            return GeneratedGameplayCatalog.TryGetActive(id, out definition);
        }
    }
}
