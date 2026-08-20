using System;

namespace Jwgb.Client
{
    internal sealed class ClientReconnectWindow
    {
        private readonly float durationSeconds;
        private float expiresAt = float.NegativeInfinity;

        public ClientReconnectWindow(float durationSeconds)
        {
            if (durationSeconds <= 0f)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(durationSeconds));
            }
            this.durationSeconds = durationSeconds;
        }

        public bool IsOpen(float now)
        {
            return now < expiresAt;
        }

        public int SecondsRemaining(float now)
        {
            return IsOpen(now)
                ? Math.Max(1, (int)Math.Ceiling(expiresAt - now))
                : 0;
        }

        public void Open(float now)
        {
            expiresAt = now + durationSeconds;
        }

        public void Close()
        {
            expiresAt = float.NegativeInfinity;
        }
    }
}
