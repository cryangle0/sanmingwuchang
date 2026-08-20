using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class PlayerSpeedSystem
    {
        public static int Current(
            SimulationState state,
            PlayerState player)
        {
            var active = ActiveCatalog.Get(player.ActiveAbilityId);
            var activeBasisPoints =
                player.WhirlwindTicks > 0 &&
                active.Effect == ActiveEffect.MobileChannelAreaDamage
                    ? active.SelfMoveMultiplierBasisPoints
                    : 10_000;
            var momentumPerStack = 0;
            if (PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.Momentum,
                    out var momentum))
            {
                momentumPerStack = PassiveCatalog.LevelValue(
                    PassiveCatalog.Get(GameplayIds.Momentum)
                        .MoveBonusBasisPointsByLevel,
                    momentum.Level);
            }

            var percentBonus =
                ActivePercentBonus(player) +
                HuntSpeedBonus(state, player) +
                StormWardSpeedBonus(state, player);
            var speedWithPercent = checked(
                player.MoveSpeedMmPerSecond *
                (100 + percentBonus) /
                100);
            var speedWithMomentum = checked(
                speedWithPercent *
                (10_000 + player.B36Stacks * momentumPerStack) /
                10_000);
            var slowBasisPoints = IgnoresSlow(player)
                ? 10_000
                : player.SlowBasisPoints;
            return checked(
                (int)(
                    (long)speedWithMomentum *
                    activeBasisPoints *
                    slowBasisPoints /
                    100_000_000));
        }

        private static int ActivePercentBonus(PlayerState player)
        {
            return
                (player.B15SpeedBoostTicks > 0
                    ? player.B15SpeedBonusPercent
                    : 0) +
                (player.B27SpeedBoostTicks > 0
                    ? player.B27SpeedBonusPercent
                    : 0) +
                (player.B42SpeedBoostTicks > 0
                    ? player.B42SpeedBonusPercent
                    : 0);
        }

        private static bool IgnoresSlow(PlayerState player)
        {
            return player.B27SpeedBoostTicks > 0 &&
                PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.Sprint,
                    out var sprint) &&
                sprint.Level == 5;
        }

        private static int HuntSpeedBonus(
            SimulationState state,
            PlayerState player)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.Hunt,
                    out var hunt))
            {
                return 0;
            }

            var definition = PassiveCatalog.Get(GameplayIds.Hunt);
            var range = PassiveCatalog.LevelValue(
                definition.RangeMmByLevel,
                hunt.Level);
            var rangeSquared = (long)range * range;
            foreach (var target in state.Players.Values)
            {
                if (target.EntityId != player.EntityId &&
                    target.LifeState == LifeState.Alive &&
                    (long)target.Hp * 100 <
                    (long)target.MaxHp * 30 &&
                    IntegerMath.DistanceSquared(
                        player.Position,
                        target.Position) <= rangeSquared)
                {
                    return PassiveCatalog.LevelValue(
                        definition.SpeedBonusPercentByLevel,
                        hunt.Level);
                }
            }

            foreach (var target in state.Monsters.Values)
            {
                if (target.Hp > 0 &&
                    (long)target.Hp * 100 <
                    (long)target.MaxHp * 30 &&
                    IntegerMath.DistanceSquared(
                        player.Position,
                        target.Position) <= rangeSquared)
                {
                    return PassiveCatalog.LevelValue(
                        definition.SpeedBonusPercentByLevel,
                        hunt.Level);
                }
            }

            return 0;
        }

        private static int StormWardSpeedBonus(
            SimulationState state,
            PlayerState player)
        {
            if (!PassiveRuntimeSystem.TryFind(
                    player,
                    GameplayIds.StormWard,
                    out var ward) ||
                !StormSystem.IsInNormalStormZone(
                    state,
                    player.Position))
            {
                return 0;
            }

            return PassiveCatalog.LevelValue(
                PassiveCatalog.Get(GameplayIds.StormWard)
                    .StormSpeedBonusPercentByLevel,
                ward.Level);
        }
    }
}
