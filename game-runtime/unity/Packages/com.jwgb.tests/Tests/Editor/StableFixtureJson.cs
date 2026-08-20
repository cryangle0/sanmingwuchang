using System.Globalization;
using System.Text;

namespace Jwgb.Tests
{
    internal static class StableFixtureJson
    {
        public static string BuildHashInput(string text)
        {
            var length = text.Length;
            return "{\"text\":" +
                Quote(text) +
                ",\"values\":[" +
                length.ToString(CultureInfo.InvariantCulture) +
                "," +
                (length * 3).ToString(CultureInfo.InvariantCulture) +
                "]}";
        }

        private static string Quote(string value)
        {
            var builder = new StringBuilder(value.Length + 2);
            builder.Append('"');

            foreach (var codeUnit in value)
            {
                switch (codeUnit)
                {
                    case '"':
                        builder.Append("\\\"");
                        break;
                    case '\\':
                        builder.Append("\\\\");
                        break;
                    case '\b':
                        builder.Append("\\b");
                        break;
                    case '\f':
                        builder.Append("\\f");
                        break;
                    case '\n':
                        builder.Append("\\n");
                        break;
                    case '\r':
                        builder.Append("\\r");
                        break;
                    case '\t':
                        builder.Append("\\t");
                        break;
                    default:
                        if (codeUnit < 0x20)
                        {
                            builder.Append("\\u");
                            builder.Append(((int)codeUnit).ToString("x4"));
                        }
                        else
                        {
                            builder.Append(codeUnit);
                        }

                        break;
                }
            }

            builder.Append('"');
            return builder.ToString();
        }
    }
}
