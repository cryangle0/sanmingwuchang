using System;
using System.Collections.Generic;
using Jwgb.Content;

namespace Jwgb.Sim.Deterministic
{
    internal static class ActiveSystem
    {
        public static void Resolve(
            SimulationState state,
            List<SimEvent> events)
        {
            foreach (var player in state.Players.Values)
            {
                if (player.LifeState != LifeState.Alive ||
                    !player.Intent.CastActive ||
                    player.ActiveCooldownTicks > 0 ||
                    player.HardControlTicks > 0 ||
                    player.IceCoffinTicks > 0)
                {
                    continue;
                }

                var active = ActiveCatalog.Get(player.ActiveAbilityId);
                switch (active.Effect)
                {
                    case ActiveEffect.WindWall:
                        WindWallSystem.Create(state, player, active);
                        break;
                    case ActiveEffect.SelfCombatBuff:
                        player.ActiveBuffTicks = active.DurationTicks;
                        break;
                    case ActiveEffect.MobileChannelAreaDamage:
                        player.WhirlwindTicks = active.DurationTicks;
                        player.WhirlwindNextPulseTick =
                            state.Tick + active.PulseIntervalTicks;
                        break;
                    case ActiveEffect.SelfLockInvulnerability:
                        player.IceCoffinTicks = active.DurationTicks;
                        break;
                    case ActiveEffect.SelfShield:
                        ShieldSystem.AddActive(
                            state,
                            player,
                            active.Id,
                            active.ShieldAmount,
                            active.DurationTicks);
                        break;
                    case ActiveEffect.CapsuleSweepBlink:
                        BlinkSystem.Resolve(
                            state,
                            events,
                            player,
                            active);
                        break;
                    default:
                        throw new ArgumentOutOfRangeException();
                }

                player.ActiveCooldownTicks = active.CooldownTicks;
                events.Add(
                    new SimEvent
                    {
                        Type = "active-cast",
                        Tick = state.Tick,
                        EntityId = player.EntityId,
                        HeroId = player.HeroId,
                        ActiveAbilityId = active.Id,
                        ActiveName = active.Name
                    });
            }
        }

    }
}
