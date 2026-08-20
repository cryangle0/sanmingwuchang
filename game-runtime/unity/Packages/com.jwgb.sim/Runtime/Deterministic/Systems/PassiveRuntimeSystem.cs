using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static partial class PassiveRuntimeSystem
    {
        public static PassiveTargetState GetOrCreateTargetState(
            SimulationState state,
            int sourceEntityId,
            int targetEntityId)
        {
            var key = sourceEntityId + ":" + targetEntityId;
            if (state.PassiveTargetStates.TryGetValue(
                    key,
                    out var existing))
            {
                return existing;
            }

            var created = new PassiveTargetState
            {
                SourceEntityId = sourceEntityId,
                TargetEntityId = targetEntityId
            };
            state.PassiveTargetStates.Add(key, created);
            return created;
        }

        public static void MarkCombatActivity(
            SimulationState state,
            int? sourceEntityId,
            int targetEntityId)
        {
            if (state.Players.TryGetValue(targetEntityId, out var target))
            {
                target.LastCombatTick = state.Tick;
                target.B21FirstHitReady = false;
            }

            if (!sourceEntityId.HasValue ||
                !TryGetCreditedPlayer(
                    state,
                    sourceEntityId.Value,
                    out var source))
            {
                return;
            }

            source.LastCombatTick = state.Tick;
            if (state.Players.ContainsKey(sourceEntityId.Value))
            {
                var targetState = GetOrCreateTargetState(
                    state,
                    source.EntityId,
                    targetEntityId);
                targetState.LastBasicHitTick = state.Tick;
            }
        }

        public static bool TryFind(
            PlayerState player,
            string passiveId,
            out PassiveLoadoutEntry loadout)
        {
            for (var index = 0; index < player.Passives.Count; index += 1)
            {
                if (player.Passives[index].PassiveId == passiveId)
                {
                    loadout = player.Passives[index];
                    return true;
                }
            }

            loadout = default;
            return false;
        }

        public static int ScaleMagnitude(int value, PlayerState player)
        {
            var basisPoints = 10_000;
            if (player.ActiveBuffTicks > 0)
            {
                var active = ActiveCatalog.Get(player.ActiveAbilityId);
                if (active.Effect == ActiveEffect.SelfCombatBuff)
                {
                    basisPoints =
                        active.PassiveEffectMagnitudeBasisPoints;
                }
            }

            return checked(value * basisPoints / 10_000);
        }

        public static void ApplyFireSpiritBurn(
            SimulationState state,
            int sourceEntityId,
            int targetEntityId,
            int damagePerSecond,
            int durationTicks)
        {
            var targetState = GetOrCreateTargetState(
                state,
                sourceEntityId,
                targetEntityId);
            targetState.FireBurnDamagePerSecond =
                System.Math.Max(
                    targetState.FireBurnDamagePerSecond,
                    damagePerSecond);
            targetState.FireBurnExpiresAtTick =
                System.Math.Max(
                    targetState.FireBurnExpiresAtTick,
                    state.Tick + durationTicks);
            targetState.FireBurnNextTick =
                state.Tick + SimulationConstants.TicksPerSecond;
            targetState.FireBurnSourceEntityId = sourceEntityId;
        }

        private static bool TryGetCreditedPlayer(
            SimulationState state,
            int sourceEntityId,
            out PlayerState player)
        {
            if (state.Players.TryGetValue(sourceEntityId, out player))
            {
                return true;
            }

            if (state.Summons.TryGetValue(
                    sourceEntityId,
                    out var summon) &&
                state.Players.TryGetValue(
                    summon.OwnerEntityId,
                    out player))
            {
                return true;
            }

            player = null;
            return false;
        }
    }
}
