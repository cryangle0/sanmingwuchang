using System;

namespace Jwgb.Core
{
    public static class Hash32
    {
        private const uint FnvOffset = 0x811c9dc5;
        private const uint FnvPrime = 0x01000193;

        public static uint HashString(string value)
        {
            if (value == null)
            {
                throw new ArgumentNullException(nameof(value));
            }

            var hash = FnvOffset;
            unchecked
            {
                for (var index = 0; index < value.Length; index += 1)
                {
                    hash ^= value[index];
                    hash *= FnvPrime;
                }
            }

            return hash;
        }

        public static uint HashText(string value)
        {
            if (value == null)
            {
                throw new ArgumentNullException(nameof(value));
            }

            var hash = FnvOffset;
            unchecked
            {
                for (var index = 0; index < value.Length; index += 1)
                {
                    var codeUnit = value[index];
                    hash ^= (byte)(codeUnit & 0xff);
                    hash *= FnvPrime;
                    hash ^= (byte)(codeUnit >> 8);
                    hash *= FnvPrime;
                }
            }

            return hash;
        }

        public static string ToHex8(uint value)
        {
            return value.ToString("x8");
        }
    }
}
