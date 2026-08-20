using System;
using System.Collections.Generic;

namespace Jwgb.Sim.Deterministic
{
    public sealed partial class GameSimulation
    {
        private readonly long rootSeed;
        private readonly SimulationState state;
        private readonly bool captureReplayCheckpoints;
        private readonly List<SimEvent> pendingEvents =
            new List<SimEvent>();
        private readonly List<ReplayRosterEntry> replayRoster =
            new List<ReplayRosterEntry>();
        private readonly List<ReplayInputEntry> replayInputs =
            new List<ReplayInputEntry>();
        private readonly SortedDictionary<int, ReplayCheckpoint>
            replayCheckpoints =
                new SortedDictionary<int, ReplayCheckpoint>();
        private bool hasUnsupportedReplayMutation;

        public GameSimulation(
            long rootSeed,
            IReadOnlyList<StaticSolidRect> staticSolids = null,
            bool captureReplayCheckpoints = false)
            : this(
                new GameSimulationOptions
                {
                    RootSeed = rootSeed,
                    StaticSolids = CopyStaticSolids(staticSolids),
                    CaptureReplayCheckpoints =
                        captureReplayCheckpoints
                })
        {
        }

        public GameSimulation(GameSimulationOptions options)
        {
            if (options == null)
            {
                throw new ArgumentNullException(nameof(options));
            }

            rootSeed = options.RootSeed;
            captureReplayCheckpoints =
                options.CaptureReplayCheckpoints;
            state = SimulationStateFactory.Create(options);
            InitializeRuntime();
        }

        public int Tick => state.Tick;

        public int PlayerCount => state.Players.Count;

        public int AddPlayer(AddPlayerOptions options)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                throw new InvalidOperationException(
                    "Cannot join a finished match.");
            }

            var player = SimulationStateFactory.AddPlayer(state, options);
            pendingEvents.Add(
                new SimEvent
                {
                    Type = "player-added",
                    Tick = state.Tick,
                    EntityId = player.EntityId,
                    PlayerId = player.PlayerId,
                    HeroId = player.HeroId
                });
            replayRoster.Add(
                new ReplayRosterEntry
                {
                    EntityId = player.EntityId,
                    JoinedAtTick = state.Tick,
                    PlayerId = player.PlayerId,
                    HeroId = player.HeroId,
                    ActiveAbilityId = player.ActiveAbilityId,
                    HasPosition = options.HasPosition,
                    Position = options.Position,
                    Passives = player.Passives.ToArray(),
                    EquipmentIds = CopyEquipmentIds(player)
                });
            RecordReplayCheckpoint();
            return player.EntityId;
        }

        public bool SubmitIntent(int entityId, PlayerIntent intent)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return false;
            }

            var player = StateQueries.GetRequiredPlayer(state, entityId);
            if (intent.Sequence <= player.Intent.Sequence ||
                player.LifeState == LifeState.Eliminated)
            {
                return false;
            }

            player.Intent = intent;
            replayInputs.Add(
                new ReplayInputEntry
                {
                    AtTick = state.Tick,
                    EntityId = entityId,
                    Intent = intent
                });
            RecordReplayCheckpoint();
            return true;
        }

        public void Step(int count = 1)
        {
            if (count <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(count));
            }

            if (state.Match.Status == MatchStatus.Finished)
            {
                return;
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            for (var iteration = 0; iteration < count; iteration += 1)
            {
                state.Tick += 1;
                StormZoneSystem.Advance(state, pendingEvents);
                ShopSystem.Advance(state, pendingEvents);
                PassiveEconomySystem.Advance(state, pendingEvents);
                ShieldSystem.Advance(state);
                WindWallSystem.Advance(state);
                WhirlwindTimerSystem.Advance(state);
                LifeSystem.Advance(state, pendingEvents);
                PassiveKillSystem.Advance(state);
                PassiveRuntimeSystem.Advance(state, pendingEvents);
                EquipmentRuntimeSystem.Advance(state, pendingEvents);
                PassiveRuntimeSystem.AdvanceDamageOverTime(
                    state,
                    pendingEvents);
                ActiveWorldSystem.Advance(state, pendingEvents);
                ActiveSystem.Resolve(state, pendingEvents);
                MovementSystem.Advance(state, pendingEvents);
                AfterimageSystem.Advance(state, pendingEvents);
                WhirlwindSystem.ResolvePulses(state, pendingEvents);
                CombatSystem.ResolveBasicAttacks(state, pendingEvents);
                ProjectileSystem.Advance(state, pendingEvents);
                SummonSystem.Advance(state, pendingEvents);
                PveSystem.Advance(state, pendingEvents);
                StormSystem.Resolve(state, pendingEvents);
                AirdropSystem.Advance(state, pendingEvents);
                MatchSystem.ResolveOutcome(state, pendingEvents);
                RecordReplayCheckpoint();
                if (state.Match.FinishedAtTick.HasValue)
                {
                    break;
                }
            }
        }

        public int Damage(
            int targetEntityId,
            int amount,
            int? sourceEntityId = null,
            DamageForm form = DamageForm.True)
        {
            if (state.Match.Status == MatchStatus.Finished)
            {
                return 0;
            }

            MatchSystem.StartIfReady(state, pendingEvents);
            var applied = DamageSystem.ApplyDebugDamage(
                state,
                pendingEvents,
                targetEntityId,
                amount,
                sourceEntityId,
                form);
            MatchSystem.ResolveOutcome(state, pendingEvents);
            if (applied > 0)
            {
                hasUnsupportedReplayMutation = true;
            }

            return applied;
        }

        public bool HardControl(int entityId, int durationTicks)
        {
            if (durationTicks <= 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(durationTicks));
            }

            if (state.Match.Status == MatchStatus.Finished)
            {
                return false;
            }

            var player = StateQueries.GetRequiredPlayer(state, entityId);
            if (LethalProtectionSystem.HasControlImmunity(player))
            {
                return false;
            }

            player.HardControlTicks = Math.Max(
                player.HardControlTicks,
                durationTicks);
            player.WhirlwindTicks = 0;
            player.WhirlwindNextPulseTick = 0;
            AirdropSystem.Interrupt(
                state,
                pendingEvents,
                entityId,
                "hard-control");
            hasUnsupportedReplayMutation = true;
            return true;
        }

        public SimulationReplay ExportReplay()
        {
            if (hasUnsupportedReplayMutation)
            {
                throw new InvalidOperationException(
                    "Replay export only supports roster changes and accepted inputs.");
            }

            var checkpoints = new List<ReplayCheckpoint>(
                replayCheckpoints.Values);
            if (!captureReplayCheckpoints)
            {
                checkpoints.Clear();
            }

            return new SimulationReplay
            {
                RootSeed = rootSeed,
                StaticSolids = state.StaticSolids.ToArray(),
                MapEnabled = state.MapField != null,
                PveEnabled = state.PveEnabled,
                PvePopulation = state.PvePopulation == "full"
                    ? PvePopulation.Full
                    : PvePopulation.Demo,
                Roster = replayRoster.ToArray(),
                Inputs = replayInputs.ToArray(),
                Checkpoints = checkpoints.ToArray(),
                FinalTick = state.Tick,
                ExpectedStateHash = GetStateHash()
            };
        }

        private void RecordReplayCheckpoint()
        {
            if (!captureReplayCheckpoints)
            {
                return;
            }

            replayCheckpoints[state.Tick] = new ReplayCheckpoint
            {
                Tick = state.Tick,
                StateHash = GetStateHash()
            };
        }
    }
}
