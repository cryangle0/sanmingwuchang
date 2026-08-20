using System;
using System.Collections.Generic;

namespace Jwgb.Server
{
    internal sealed class NetworkBotTakeoverSchedule
    {
        private readonly Dictionary<int, int> takeoverTickByEntity =
            new Dictionary<int, int>();
        private readonly List<int> readyEntityIds =
            new List<int>();
        private readonly int delayTicks;

        public NetworkBotTakeoverSchedule(int delayTicks)
        {
            if (delayTicks <= 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(delayTicks));
            }
            this.delayTicks = delayTicks;
        }

        public int Count => takeoverTickByEntity.Count;

        public bool IsScheduled(int entityId)
        {
            return takeoverTickByEntity.ContainsKey(entityId);
        }

        public void Schedule(int entityId, int currentTick)
        {
            if (entityId <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(entityId));
            }
            if (currentTick < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(currentTick));
            }
            takeoverTickByEntity[entityId] = checked(
                currentTick + delayTicks);
        }

        public void Cancel(int entityId)
        {
            takeoverTickByEntity.Remove(entityId);
        }

        public void ApplyReady(
            int nextTick,
            ISet<int> externallyControlledEntityIds)
        {
            if (externallyControlledEntityIds == null)
            {
                throw new ArgumentNullException(
                    nameof(externallyControlledEntityIds));
            }
            if (nextTick < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(nextTick));
            }

            readyEntityIds.Clear();
            foreach (var pair in takeoverTickByEntity)
            {
                if (pair.Value <= nextTick)
                {
                    readyEntityIds.Add(pair.Key);
                }
            }
            for (var index = 0;
                index < readyEntityIds.Count;
                index += 1)
            {
                var entityId = readyEntityIds[index];
                takeoverTickByEntity.Remove(entityId);
                externallyControlledEntityIds.Remove(entityId);
            }
        }

        public void Clear()
        {
            takeoverTickByEntity.Clear();
            readyEntityIds.Clear();
        }
    }
}
