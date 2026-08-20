using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class AirdropSystem
    {
        private static Int2Mm? SelectLandingPoint(
            SimulationState state)
        {
            var candidates = LegacyAirdropPoints;
            var start = (int)state.Random.Airdrop.NextInt(
                (ulong)candidates.Length);
            for (var offset = 0; offset < candidates.Length; offset += 1)
            {
                var candidate =
                    candidates[(start + offset) % candidates.Length];
                if (IsLegalLandingPoint(state, candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static bool IsLegalLandingPoint(
            SimulationState state,
            Int2Mm position)
        {
            const int reservationRadius = LandingReservationRadiusMm;
            if (!IsInsideLegacyArena(position, reservationRadius) ||
                TouchesStaticSolid(state, position, reservationRadius))
            {
                return false;
            }

            var safeRadius = StormZoneSystem.NormalStormSafeRadiusMm(
                state.Tick);
            if (safeRadius <= reservationRadius)
            {
                return false;
            }

            long legalSafe = safeRadius - reservationRadius;
            if (IntegerMath.DistanceSquared(
                    position,
                    new Int2Mm(0, 0)) >
                legalSafe * legalSafe)
            {
                return false;
            }

            foreach (var player in state.Players.Values)
            {
                if (player.LifeState == LifeState.Eliminated)
                {
                    continue;
                }

                long clearance = reservationRadius +
                    GameplayRules.PlayerCapsuleRadiusMm;
                if (IntegerMath.DistanceSquared(
                        player.Position,
                        position) <= clearance * clearance)
                {
                    return false;
                }
            }

            foreach (var monster in state.Monsters.Values)
            {
                if (monster.Hp <= 0 ||
                    (monster.Kind != MonsterKind.DragonKing &&
                     monster.Kind != MonsterKind.CoreBoss))
                {
                    continue;
                }

                long clearance =
                    reservationRadius + monster.CollisionRadiusMm;
                if (IntegerMath.DistanceSquared(
                        monster.Position,
                        position) <= clearance * clearance)
                {
                    return false;
                }
            }

            return true;
        }

        private static bool IsInsideLegacyArena(
            Int2Mm position,
            int radiusMm)
        {
            long legalRadius = GameplayRules.ArenaRadiusMm - radiusMm;
            return ((long)position.X * position.X) +
                ((long)position.Z * position.Z) <=
                legalRadius * legalRadius;
        }

        private static bool TouchesStaticSolid(
            SimulationState state,
            Int2Mm position,
            int radiusMm)
        {
            for (var index = 0; index < state.StaticSolids.Count; index += 1)
            {
                var solid = state.StaticSolids[index];
                if (position.X >= solid.MinimumX - radiusMm &&
                    position.X <= solid.MaximumX + radiusMm &&
                    position.Z >= solid.MinimumZ - radiusMm &&
                    position.Z <= solid.MaximumZ + radiusMm)
                {
                    return true;
                }
            }

            return false;
        }
    }
}
