using System.Collections.Generic;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class StateHashBuilder
    {
        public static string Compute(SimulationState state)
        {
            return StableHash32.Compute(BuildHashInput(state));
        }

        /// <summary>
        /// Canonical stable-JSON hash payload; exposed for parity debugging
        /// against the TypeScript oracle (tools/migration dump scripts).
        /// </summary>
        internal static string ComputeCanonicalJson(SimulationState state)
        {
            return StableJson.Serialize(BuildHashInput(state));
        }

        private static Dictionary<string, object> BuildHashInput(
            SimulationState state)
        {
            var root = NewObject();
            root["tick"] = state.Tick;
            root["rootSeed"] = state.RootSeed;
            root["arenaRadiusMm"] = state.ArenaRadiusMm;
            root["stormZone"] = BuildStormZone(state);
            root["mapGeometryHash"] = state.MapGeometryHash;
            root["match"] = BuildMatch(state);
            root["eliminationOrder"] = new List<int>(state.EliminationOrder);
            root["staticSolids"] = BuildStaticSolids(state);
            root["random"] = BuildRandom(state);
            root["consumedB20PlayerIds"] = BuildConsumedB20Ids(state);
            root["initialSpawnIndices"] = BuildInitialSpawnIndices(state);
            root["nextEntityId"] = state.NextEntityId;
            root["nextEquipmentInstanceId"] =
                state.NextEquipmentInstanceId;
            root["nextShieldSequence"] = state.NextShieldSequence;
            root["terminalShopAssignments"] =
                BuildTerminalShopAssignments(state);
            root["goldenCudgelDropped"] = state.GoldenCudgelDropped;
            root["nextAirdropChannelSequence"] =
                state.NextAirdropChannelSequence;
            root["pveEnabled"] = state.PveEnabled;
            root["pvePopulation"] = state.PvePopulation;
            root["players"] = StateHashValues.BuildPlayers(state);
            root["monsters"] = StateHashValues.BuildMonsters(state);
            root["monsterRespawns"] =
                StateHashValues.BuildMonsterRespawns(state);
            root["coreBossRuntimes"] =
                StateHashValues.BuildCoreBossRuntimes(state);
            root["coreBossHazards"] =
                StateHashValues.BuildCoreBossHazards(state);
            root["coreBossRevealAnchors"] =
                StateHashValues.BuildCoreBossRevealAnchors(state);
            root["coreBossThreat"] =
                StateHashValues.BuildCoreBossThreat(state);
            root["pendingActiveReplacements"] =
                StateHashValues.BuildPendingActiveReplacements(state);
            root["pendingEquipmentPickups"] =
                StateHashValues.BuildPendingEquipmentPickups(state);
            root["lootDrops"] = StateHashValues.BuildLootDrops(state);
            root["summons"] = StateHashValues.BuildSummons(state);
            root["afterimages"] = StateHashValues.BuildAfterimages(state);
            root["bountyMarks"] = StateHashValues.BuildBountyMarks(state);
            root["activeLootReveals"] = new List<object>();
            root["equipmentReveals"] = new List<object>();
            root["passiveTargetStates"] =
                StateHashValues.BuildPassiveTargetStates(state);
            root["shops"] = StateHashValues.BuildShops(state);
            root["windWalls"] = StateHashValues.BuildWindWalls(state);
            root["projectiles"] = StateHashValues.BuildProjectiles(state);
            root["activeProjectiles"] = new List<object>();
            root["activeZones"] = new List<object>();
            root["activeTargetEffects"] = new List<object>();
            root["playerHistoryFrames"] =
                StateHashValues.BuildPlayerHistoryFrames(state);
            root["airdrops"] = StateHashValues.BuildAirdrops(state);
            root["airdropChannels"] =
                StateHashValues.BuildAirdropChannels(state);
            return root;
        }

        internal static Dictionary<string, object> NewObject()
        {
            return new Dictionary<string, object>();
        }

        internal static Dictionary<string, object> BuildVector(
            int x,
            int z)
        {
            return new Dictionary<string, object>
            {
                ["x"] = x,
                ["z"] = z
            };
        }

        private static object BuildStormZone(SimulationState state)
        {
            return new Dictionary<string, object>
            {
                ["selectedCourtId"] = state.StormZone.SelectedCourtId,
                ["courtAnnouncementTick"] =
                    state.StormZone.CourtAnnouncementTick,
                ["warningTick"] = state.StormZone.WarningTick,
                ["center"] = BuildVector(
                    state.StormZone.Center.X,
                    state.StormZone.Center.Z),
                ["radiusMm"] = state.StormZone.RadiusMm,
                ["courtAnnounced"] = state.StormZone.CourtAnnounced,
                ["apocalypseWarning"] = state.StormZone.ApocalypseWarning,
                ["apocalypseStarted"] = state.StormZone.ApocalypseStarted
            };
        }

        private static object BuildMatch(SimulationState state)
        {
            var placementGroups = new List<object>(
                state.Match.PlacementGroups.Count);
            for (var index = 0;
                index < state.Match.PlacementGroups.Count;
                index += 1)
            {
                placementGroups.Add(
                    new List<int>(state.Match.PlacementGroups[index]));
            }

            var awards = new List<object>(
                state.Match.CultivationAwards.Count);
            for (var index = 0;
                index < state.Match.CultivationAwards.Count;
                index += 1)
            {
                var award = state.Match.CultivationAwards[index];
                awards.Add(
                    new Dictionary<string, object>
                    {
                        ["entityId"] = award.EntityId,
                        ["amount"] = award.Amount
                    });
            }

            return new Dictionary<string, object>
            {
                ["status"] = SimulationText.MatchStatus(state.Match.Status),
                ["startedAtTick"] = state.Match.StartedAtTick,
                ["finishedAtTick"] = state.Match.FinishedAtTick,
                ["outcome"] = state.Match.Outcome,
                ["winnerEntityId"] = state.Match.WinnerEntityId,
                ["winnerEntityIds"] =
                    new List<int>(state.Match.WinnerEntityIds),
                ["placements"] = new List<int>(state.Match.Placements),
                ["placementGroups"] = placementGroups,
                ["voidAbortReason"] = state.Match.VoidAbortReason,
                ["mmrEligible"] = state.Match.MmrEligible,
                ["cultivationAwards"] = awards,
                ["diagnosticReplayRequired"] =
                    state.Match.DiagnosticReplayRequired
            };
        }

        private static object BuildStaticSolids(SimulationState state)
        {
            var values = new List<object>(state.StaticSolids.Count);
            for (var index = 0; index < state.StaticSolids.Count; index += 1)
            {
                var solid = state.StaticSolids[index];
                values.Add(
                    new Dictionary<string, object>
                    {
                        ["solidId"] = solid.SolidId,
                        ["minimumX"] = solid.MinimumX,
                        ["maximumX"] = solid.MaximumX,
                        ["minimumZ"] = solid.MinimumZ,
                        ["maximumZ"] = solid.MaximumZ
                    });
            }

            return values;
        }

        private static object BuildRandom(SimulationState state)
        {
            return new Dictionary<string, object>
            {
                ["spawn"] = state.Random.Spawn.Snapshot(),
                ["combat"] = state.Random.Combat.Snapshot(),
                ["storm"] = state.Random.Storm.Snapshot(),
                ["stormLayout"] = state.Random.StormLayout.Snapshot(),
                ["shop"] = state.Random.Shop.Snapshot(),
                ["blackMountain"] = state.Random.BlackMountain.Snapshot(),
                ["airdrop"] = state.Random.Airdrop.Snapshot()
            };
        }

        private static object BuildConsumedB20Ids(SimulationState state)
        {
            var ids = new List<string>(state.ConsumedB20PlayerIds);
            ids.Sort(System.StringComparer.Ordinal);
            return ids;
        }

        private static object BuildInitialSpawnIndices(SimulationState state)
        {
            var indices = new List<int>(state.InitialSpawnIndices);
            indices.Sort();
            return indices;
        }

        private static object BuildTerminalShopAssignments(
            SimulationState state)
        {
            var entries = new List<object>(
                state.TerminalShopAssignments.Count);
            foreach (var entry in state.TerminalShopAssignments)
            {
                entries.Add(new List<object> { entry.Key, entry.Value });
            }

            return entries;
        }
    }
}
