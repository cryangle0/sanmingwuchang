using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Jwgb.Core
{
    public static class StableJson
    {
        public static string Serialize(object value)
        {
            var builder = new StringBuilder(1_024);
            WriteValue(builder, value);
            return builder.ToString();
        }

        private static void WriteValue(StringBuilder builder, object value)
        {
            if (value == null)
            {
                builder.Append("null");
                return;
            }

            if (value is string text)
            {
                WriteString(builder, text);
                return;
            }

            if (value is bool boolean)
            {
                builder.Append(boolean ? "true" : "false");
                return;
            }

            if (value is IDictionary<string, object> dictionary)
            {
                WriteObject(builder, dictionary);
                return;
            }

            if (value is IEnumerable sequence)
            {
                WriteArray(builder, sequence);
                return;
            }

            if (value is IFormattable formattable)
            {
                builder.Append(formattable.ToString(null, CultureInfo.InvariantCulture));
                return;
            }

            throw new ArgumentException(
                $"Unsupported stable JSON value type: {value.GetType().FullName}.",
                nameof(value));
        }

        private static void WriteObject(
            StringBuilder builder,
            IDictionary<string, object> dictionary)
        {
            var keys = new List<string>(dictionary.Keys);
            keys.Sort(StringComparer.Ordinal);
            builder.Append('{');
            for (var index = 0; index < keys.Count; index += 1)
            {
                if (index > 0)
                {
                    builder.Append(',');
                }

                var key = keys[index];
                WriteString(builder, key);
                builder.Append(':');
                WriteValue(builder, dictionary[key]);
            }

            builder.Append('}');
        }

        private static void WriteArray(StringBuilder builder, IEnumerable sequence)
        {
            builder.Append('[');
            var first = true;
            foreach (var item in sequence)
            {
                if (!first)
                {
                    builder.Append(',');
                }

                first = false;
                WriteValue(builder, item);
            }

            builder.Append(']');
        }

        private static void WriteString(StringBuilder builder, string value)
        {
            builder.Append('"');
            for (var index = 0; index < value.Length; index += 1)
            {
                var character = value[index];
                switch (character)
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
                        if (character < 0x20)
                        {
                            builder.Append("\\u");
                            builder.Append(((int)character).ToString("x4"));
                        }
                        else
                        {
                            builder.Append(character);
                        }

                        break;
                }
            }

            builder.Append('"');
        }
    }
}
