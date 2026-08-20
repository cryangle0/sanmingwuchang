using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Client.Presentation
{
    public sealed partial class MatchHud
    {
        private PlayerSnapshot FindLocalPlayer(
            WorldSnapshot snapshot,
            out int remaining)
        {
            remaining = 0;
            PlayerSnapshot local = null;
            for (var index = 0; index < snapshot.Players.Length; index += 1)
            {
                var player = snapshot.Players[index];
                if (player.LifeState != LifeState.Eliminated)
                {
                    remaining += 1;
                }
                if (player.EntityId == LocalEntityId)
                {
                    local = player;
                }
            }
            return local;
        }

        private void UpdatePlayerStatus(PlayerSnapshot local)
        {
            elements.Hero.text = MatchHudText.HeroName(local.HeroId);
            elements.Hp.text =
                $"{local.Hp} / {local.MaxHp}   +{local.TotalShield}";
            elements.Lives.text =
                $"LIVES {local.LivesRemaining}   " +
                MatchHudText.LifeState(local.LifeState);
            elements.Gold.text =
                $"GOLD {local.Gold}   LV {local.Level}";
            MatchHudBuilder.SetPercent(
                elements.HpFill,
                local.MaxHp <= 0
                    ? 0f
                    : (float)local.Hp / local.MaxHp);
            MatchHudBuilder.SetPercent(
                elements.ShieldFill,
                local.MaxHp <= 0
                    ? 0f
                    : (float)local.TotalShield / local.MaxHp);
            var cooldownSeconds = Mathf.CeilToInt(
                (float)local.ActiveCooldownTicks /
                SimulationConstants.TicksPerSecond);
            elements.Ability.text = local.ActiveCooldownTicks <= 0
                ? "ACTIVE READY"
                : $"ACTIVE {cooldownSeconds}s";
        }
    }
}
