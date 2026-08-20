namespace Jwgb.Core
{
    public static class StableHash32
    {
        public static string Compute(object value)
        {
            return Hash32.ToHex8(Hash32.HashText(StableJson.Serialize(value)));
        }
    }
}
