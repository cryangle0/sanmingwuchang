using System;
using System.Collections.Generic;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;

namespace Jwgb.Server
{
    public sealed class NetworkInputTimeline
    {
        private readonly Dictionary<int, Queue<PlayerIntent>>
            pendingByEntity =
                new Dictionary<int, Queue<PlayerIntent>>();

        public void SetConnected(int entityId, bool connected)
        {
            if (connected)
            {
                if (!pendingByEntity.ContainsKey(entityId))
                {
                    pendingByEntity.Add(
                        entityId,
                        new Queue<PlayerIntent>());
                }
                return;
            }
            pendingByEntity.Remove(entityId);
        }

        public bool Enqueue(AcceptedNetworkInput input)
        {
            if (!pendingByEntity.TryGetValue(
                    input.EntityId,
                    out var pending))
            {
                return false;
            }
            pending.Enqueue(PlayerIntent.Create(
                input.Sequence,
                input.MoveX,
                input.MoveZ,
                input.AimX,
                input.AimZ,
                input.Attack,
                null,
                input.CastActive,
                input.Interact));
            return true;
        }

        public void PrepareTick(
            Dictionary<int, PlayerIntent> destination,
            Action<int, int> recordProcessed)
        {
            if (destination == null)
            {
                throw new ArgumentNullException(
                    nameof(destination));
            }
            if (recordProcessed == null)
            {
                throw new ArgumentNullException(
                    nameof(recordProcessed));
            }

            destination.Clear();
            foreach (var pair in pendingByEntity)
            {
                if (pair.Value.Count == 0)
                {
                    continue;
                }
                var intent = pair.Value.Dequeue();
                destination.Add(pair.Key, intent);
                recordProcessed(pair.Key, intent.Sequence);
            }
        }

        public int PendingCount(int entityId)
        {
            return pendingByEntity.TryGetValue(
                entityId,
                out var pending)
                    ? pending.Count
                    : 0;
        }

        public void ClearPending()
        {
            foreach (var pending in pendingByEntity.Values)
            {
                pending.Clear();
            }
        }
    }
}
