using System.Collections.Generic;
using Jwgb.Netcode;
using Jwgb.Sim.Deterministic;
using UnityEngine;

namespace Jwgb.Server
{
    [DisallowMultipleComponent]
    public sealed class AuthoritativeMatchRuntime : MonoBehaviour
    {
        private readonly SimulationTickClock clock =
            new SimulationTickClock(8);
        private readonly Dictionary<int, PlayerIntent> networkInputs =
            new Dictionary<int, PlayerIntent>();
        private readonly HashSet<int> networkControlledEntityIds =
            new HashSet<int>();
        private readonly NetworkBotTakeoverSchedule botTakeovers =
            new NetworkBotTakeoverSchedule(
                MatchNetworkDefaults.BotTakeoverDelayTicks);
        private readonly NetworkInputTimeline networkInputTimeline =
            new NetworkInputTimeline();
        private AuthoritativeMatchSession session;
        private bool loggedOutcome;
        private int matchSequence;

        public WorldSnapshot Snapshot => session?.Snapshot;

        public int MatchSequence => matchSequence;

        public int AppliedExternalInputCount =>
            session?.AppliedExternalInputCount ?? 0;

        public int LastAppliedExternalInputSequence =>
            session?.LastAppliedExternalInputSequence ?? 0;

        private void Awake()
        {
            session = CreateSession();
            MatchNetworkRuntimeState.ConfigureServerRoster(
                session.Snapshot.Players);
            PublishNetworkState();
            Application.runInBackground = true;
        }

        private void Update()
        {
            DrainNetworkControl();
            DrainNetworkTransactions();
            TryFinishMatchForRematchSmoke();
            TryRestartNetworkMatch();
            var tickCount = clock.Accumulate(Time.unscaledDeltaTime);
            for (var tick = 0; tick < tickCount; tick += 1)
            {
                botTakeovers.ApplyReady(
                    checked(session.CurrentTick + 1),
                    networkControlledEntityIds);
                networkInputTimeline.PrepareTick(
                    networkInputs,
                    MatchNetworkRuntimeState.RecordProcessedInput);
                var events = session.Step(
                    networkInputs,
                    networkControlledEntityIds);
                MatchNetworkRuntimeState.PublishServerEvents(
                    events,
                    matchSequence);
                PublishNetworkState();
            }

            if (!loggedOutcome &&
                session.Snapshot.Match.Status == MatchStatus.Finished)
            {
                loggedOutcome = true;
                Debug.Log(
                    $"JWGB authoritative match finished at tick " +
                    $"{session.Snapshot.Tick}, winner " +
                    $"{session.Snapshot.Match.WinnerEntityId?.ToString() ?? "draw"}, " +
                    $"hash {session.Snapshot.StateHash}");
            }
        }

        private void DrainNetworkTransactions()
        {
            while (MatchNetworkRuntimeState.TryDequeueServerTransaction(
                out var transaction))
            {
                if (!MatchNetworkRuntimeState.IsCurrentTransactionOwner(
                        transaction))
                {
                    continue;
                }

                var result = session.ExecuteTransaction(
                    transaction.Request);
                MatchNetworkRuntimeState.RecordServerTransactionResult(
                    transaction,
                    MatchNetworkTransactionCodec.EncodeResult(
                        transaction.TransactionId,
                        result,
                        transaction.MatchSequence));
                MatchNetworkRuntimeState.PublishServerEvents(
                    session.DrainEvents(),
                    matchSequence);
                PublishNetworkState();
            }
        }

        private void DrainNetworkControl()
        {
            while (MatchNetworkRuntimeState.TryDequeueAssignment(
                out var assignment))
            {
                if (assignment.Connected)
                {
                    if (assignment.ApplyHero)
                    {
                        session.AssignNetworkHero(
                            assignment.EntityId,
                            assignment.HeroId);
                        PublishNetworkState();
                    }
                    networkControlledEntityIds.Add(assignment.EntityId);
                    botTakeovers.Cancel(assignment.EntityId);
                    networkInputTimeline.SetConnected(
                        assignment.EntityId,
                        connected: true);
                }
                else
                {
                    networkInputs.Remove(assignment.EntityId);
                    networkInputTimeline.SetConnected(
                        assignment.EntityId,
                        connected: false);
                    networkControlledEntityIds.Add(assignment.EntityId);
                    session.SubmitDisconnectNeutralIntent(
                        assignment.EntityId);
                    botTakeovers.Schedule(
                        assignment.EntityId,
                        session.CurrentTick);
                }
            }

            while (MatchNetworkRuntimeState.TryDequeueServerInput(
                out var input))
            {
                networkInputTimeline.Enqueue(input);
            }
        }

        private void PublishNetworkState()
        {
            MatchNetworkRuntimeState.PublishServerSnapshot(
                session.Snapshot,
                matchSequence);
            MatchNetworkRuntimeState.PublishServerPlayerRuntime(
                session.GetPlayerRuntimeSnapshots());
        }

        private void TryRestartNetworkMatch()
        {
            if (!MatchNetworkRuntimeState.IsServerRematchReady)
            {
                return;
            }

            var connectedPlayers =
                MatchNetworkRuntimeState
                    .CaptureConnectedPlayersForRematch();
            matchSequence += 1;
            var nextSession = CreateSession();
            for (var index = 0;
                index < connectedPlayers.Length;
                index += 1)
            {
                nextSession.AssignNetworkHero(
                    connectedPlayers[index].EntityId,
                    connectedPlayers[index].HeroId);
            }

            session = nextSession;
            clock.Reset();
            networkInputs.Clear();
            networkControlledEntityIds.Clear();
            botTakeovers.Clear();
            networkInputTimeline.ClearPending();
            loggedOutcome = false;
            MatchNetworkRuntimeState.ConfigureServerRematchRoster(
                session.Snapshot.Players);
            for (var index = 0;
                index < connectedPlayers.Length;
                index += 1)
            {
                networkControlledEntityIds.Add(
                    connectedPlayers[index].EntityId);
            }
            PublishNetworkState();
            Debug.Log(
                $"JWGB authoritative rematch {matchSequence} started, " +
                $"{connectedPlayers.Length} connected players.");
        }

        private void TryFinishMatchForRematchSmoke()
        {
            var finishTick =
                ServerRuntimeOptions.RematchSmokeFinishTick;
            if (finishTick <= 0 ||
                matchSequence != 0 ||
                networkControlledEntityIds.Count == 0 ||
                session.Snapshot.Match.Status != MatchStatus.Running ||
                session.Snapshot.Tick < finishTick)
            {
                return;
            }

            session.FinishForSmoke();
            MatchNetworkRuntimeState.PublishServerEvents(
                session.DrainEvents(),
                matchSequence);
            PublishNetworkState();
            Debug.Log(
                "JWGB rematch smoke forced the first match to finish " +
                $"at tick {session.Snapshot.Tick}.");
        }

        private AuthoritativeMatchSession CreateSession()
        {
            var seed = unchecked(
                ServerRuntimeOptions.RootSeed +
                matchSequence * 1_000_003L);
            return new AuthoritativeMatchSession(
                seed,
                ServerRuntimeOptions.CompetitorCount,
                ServerRuntimeOptions.MapEnabled,
                ServerRuntimeOptions.PveEnabled);
        }
    }
}
