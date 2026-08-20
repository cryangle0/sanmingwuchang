using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class BlinkSystem
    {
        private const int DirectionScale = 1_000;

        public static void Resolve(
            SimulationState state,
            List<SimEvent> events,
            PlayerState player,
            ActiveDefinition definition)
        {
            var previous = player.Position;
            var direction = ResolveDirection(player);
            var arenaDistance = state.MapField == null
                ? ArenaLimitedDistance(
                    state,
                    previous,
                    direction,
                    definition.DistanceMm)
                : BoundaryLimitedDistance(
                    state.MapField,
                    previous,
                    direction,
                    definition.DistanceMm);
            var blocking = state.MapField == null
                ? FirstBlockingSolid(
                    state,
                    previous,
                    direction,
                    arenaDistance,
                    definition.MaxContinuousSolidChordMm)
                : FirstBlockingPiece(
                    state.MapField,
                    previous,
                    direction,
                    arenaDistance,
                    definition.MaxContinuousSolidChordMm);
            var stoppedDistance = blocking.HasValue
                ? Math.Max(0, blocking.Value.EntryDistanceMm - 1)
                : arenaDistance;
            var actualDistance = state.MapField == null
                ? stoppedDistance
                : LastLandableDistance(
                    state.MapField,
                    previous,
                    direction,
                    stoppedDistance);
            var next = PositionAtDistance(
                previous,
                direction,
                actualDistance);
            player.Position = next;
            player.MoveRemainderX = 0;
            player.MoveRemainderZ = 0;
            var deltaX = (long)next.X - previous.X;
            var deltaZ = (long)next.Z - previous.Z;
            events.Add(
                new SimEvent
                {
                    Type = "blink",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    PreviousPosition = previous,
                    NewPosition = next,
                    RequestedDistanceMm = definition.DistanceMm,
                    ActualDistanceMm = checked(
                        (int)IntegerMath.IntegerSquareRoot(
                            checked((deltaX * deltaX) + (deltaZ * deltaZ)))),
                    BlockingSolidId = blocking.HasValue
                        ? blocking.Value.SolidId
                        : null
                });
        }

        private static Int2Mm ResolveDirection(PlayerState player)
        {
            if (player.Intent.Aim.X != 0 || player.Intent.Aim.Z != 0)
            {
                return IntegerMath.NormalizeAxisPair(
                    player.Intent.Aim.X,
                    player.Intent.Aim.Z);
            }

            if (player.Facing.X != 0 || player.Facing.Z != 0)
            {
                return IntegerMath.NormalizeAxisPair(
                    player.Facing.X,
                    player.Facing.Z);
            }

            return new Int2Mm(0, DirectionScale);
        }

        private static int ArenaLimitedDistance(
            SimulationState state,
            Int2Mm origin,
            Int2Mm direction,
            int requestedDistance)
        {
            if (IsInsideArena(
                state,
                PositionAtDistance(origin, direction, requestedDistance)))
            {
                return requestedDistance;
            }

            var legal = 0;
            var illegal = requestedDistance + 1;
            while (illegal - legal > 1)
            {
                var candidate = (legal + illegal) / 2;
                if (IsInsideArena(
                    state,
                    PositionAtDistance(origin, direction, candidate)))
                {
                    legal = candidate;
                }
                else
                {
                    illegal = candidate;
                }
            }

            return legal;
        }

        private static bool IsInsideArena(
            SimulationState state,
            Int2Mm position)
        {
            var legalRadius =
                state.ArenaRadiusMm -
                GameplayRules.PlayerCapsuleRadiusMm;
            return IntegerMath.DistanceSquared(
                position,
                new Int2Mm(0, 0)) <=
                (long)legalRadius * legalRadius;
        }

        private static BlockingSolid? FirstBlockingSolid(
            SimulationState state,
            Int2Mm origin,
            Int2Mm direction,
            int requestedDistance,
            int maximumChord)
        {
            int? entryDistance = null;
            string entrySolidId = null;
            for (var distance = 0;
                distance <= requestedDistance;
                distance += 1)
            {
                var solid = FirstSolidAtPosition(
                    state,
                    PositionAtDistance(origin, direction, distance));
                if (!solid.HasValue)
                {
                    entryDistance = null;
                    entrySolidId = null;
                    continue;
                }

                if (!entryDistance.HasValue)
                {
                    entryDistance = distance;
                    entrySolidId = solid.Value.SolidId;
                }

                if (distance - entryDistance.Value > maximumChord ||
                    distance == requestedDistance)
                {
                    return new BlockingSolid(
                        entrySolidId ?? solid.Value.SolidId,
                        entryDistance.Value);
                }
            }

            return null;
        }

        private static StaticSolidRect? FirstSolidAtPosition(
            SimulationState state,
            Int2Mm position)
        {
            var radius = GameplayRules.PlayerCapsuleRadiusMm;
            for (var index = 0; index < state.StaticSolids.Count; index += 1)
            {
                var solid = state.StaticSolids[index];
                if (position.X >= solid.MinimumX - radius &&
                    position.X <= solid.MaximumX + radius &&
                    position.Z >= solid.MinimumZ - radius &&
                    position.Z <= solid.MaximumZ + radius)
                {
                    return solid;
                }
            }

            return null;
        }

        private static Int2Mm PositionAtDistance(
            Int2Mm origin,
            Int2Mm direction,
            int distanceMm)
        {
            return new Int2Mm(
                checked(
                    origin.X +
                    (int)((long)direction.X * distanceMm / DirectionScale)),
                checked(
                    origin.Z +
                    (int)((long)direction.Z * distanceMm / DirectionScale)));
        }

        private readonly struct BlockingSolid
        {
            public BlockingSolid(string solidId, int entryDistanceMm)
            {
                SolidId = solidId;
                EntryDistanceMm = entryDistanceMm;
            }

            public string SolidId { get; }
            public int EntryDistanceMm { get; }
        }
    }
}
