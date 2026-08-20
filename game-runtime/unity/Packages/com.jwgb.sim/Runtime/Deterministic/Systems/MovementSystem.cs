using System;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class MovementSystem
    {
        private const int MovementDenominator =
            1_000 * SimulationConstants.TicksPerSecond;

        public static void Advance(
            SimulationState state,
            System.Collections.Generic.List<SimEvent> events)
        {
            foreach (var player in state.Players.Values)
            {
                if (!CanMove(player))
                {
                    continue;
                }

                var movement = player.Intent.Movement;
                var aim = player.Intent.Aim;
                if (aim.X != 0 || aim.Z != 0)
                {
                    player.Facing = aim;
                }

                var hasMomentum = PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.Momentum,
                    out var momentum);
                if (movement.X != 0 || movement.Z != 0)
                {
                    player.B36MovingTicks += 1;
                    if (hasMomentum &&
                        player.B36MovingTicks >=
                        SimulationConstants.TicksPerSecond)
                    {
                        var maximumStacks = momentum.Level switch
                        {
                            1 => 5,
                            2 or 3 => 6,
                            4 => 7,
                            5 => 8,
                            _ => 0
                        };
                        player.B36Stacks = Math.Min(
                            maximumStacks,
                            player.B36Stacks + 1);
                        player.B36MovingTicks = 0;
                    }
                }
                else
                {
                    player.B36Stacks = 0;
                    player.B36MovingTicks = 0;
                    AfterimageSystem.ResetTimer(player);
                }

                var speed = PlayerSpeedSystem.Current(state, player);
                AxisStep(
                    movement.X,
                    speed,
                    player.MoveRemainderX,
                    out var deltaX,
                    out var remainderX);
                AxisStep(
                    movement.Z,
                    speed,
                    player.MoveRemainderZ,
                    out var deltaZ,
                    out var remainderZ);
                player.MoveRemainderX = remainderX;
                player.MoveRemainderZ = remainderZ;

                if (movement.X != 0 || movement.Z != 0)
                {
                    player.Facing = movement;
                }

                if (deltaX == 0 && deltaZ == 0)
                {
                    continue;
                }

                var previousPosition = player.Position;
                var requested = new Int2Mm(
                    checked(player.Position.X + deltaX),
                    checked(player.Position.Z + deltaZ));
                player.Position = state.MapField == null
                    ? IntegerMath.ClampToCircle(
                        requested,
                        state.ArenaRadiusMm -
                        GameplayRules.PlayerCapsuleRadiusMm)
                    : MapCollisionAdapter.ResolveMovement(
                        state.MapField,
                        player.Position,
                        requested,
                        GameplayRules.PlayerCapsuleRadiusMm,
                        WallTraversal.Flight(
                            FlightWallHeightBudgetMm(player)));
                ShopSystem.CancelHeroSwapIfOutsideTether(
                    state,
                    events,
                    player);
                AfterimageSystem.MaybeSpawn(
                    state,
                    player,
                    previousPosition);
            }
        }

        /// <summary>
        /// Height budget the player may cross flight-passable walls with, in
        /// millimeters. TypeScript reads it from the active flight equipment
        /// (movement.ts: flightTraversal(player.flightActive ? ... : 0)); flight
        /// equipment is not ported to the C# authority yet, so the budget is 0
        /// and <see cref="WallTraversal.Flight"/> collapses to walking.
        /// </summary>
        private static long FlightWallHeightBudgetMm(PlayerState player)
        {
            return 0;
        }

        private static bool CanMove(PlayerState player)
        {
            return
                (player.LifeState == LifeState.Alive ||
                 player.LifeState == LifeState.ReviveProtection) &&
                player.HardControlTicks == 0 &&
                player.IceCoffinTicks == 0;
        }

        private static void AxisStep(
            int input,
            int speed,
            int remainder,
            out int movement,
            out int nextRemainder)
        {
            var numerator = checked((input * speed) + remainder);
            movement = numerator / MovementDenominator;
            nextRemainder = numerator - (movement * MovementDenominator);
        }
    }
}
