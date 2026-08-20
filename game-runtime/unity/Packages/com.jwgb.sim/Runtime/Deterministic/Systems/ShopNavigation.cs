using System;
using System.Collections.Generic;
using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    /// <summary>
    /// Port of the route-graph navigation distance helpers from
    /// packages/sim/src/systems/shop.ts. All inputs are static content,
    /// so memoized results are deterministic.
    /// </summary>
    internal static class ShopNavigation
    {
        private sealed class RouteNeighbor
        {
            public RouteNeighbor(string nodeId, long distanceMm)
            {
                NodeId = nodeId;
                DistanceMm = distanceMm;
            }

            public string NodeId { get; }

            public long DistanceMm { get; }
        }

        private static readonly Dictionary<string, Int2Mm> NodeById =
            BuildNodes();
        private static readonly Dictionary<string, List<RouteNeighbor>>
            Graph = BuildGraph();
        private static readonly Dictionary<string, string>
            NearestNodeCache = new Dictionary<string, string>(
                StringComparer.Ordinal);
        private static readonly Dictionary<string, Dictionary<string, long>>
            DistancesByStart =
                new Dictionary<string, Dictionary<string, long>>(
                    StringComparer.Ordinal);
        private static readonly Dictionary<string, long>
            NavigationDistanceCache = new Dictionary<string, long>(
                StringComparer.Ordinal);

        public static long NavigationDistanceMm(Int2Mm left, Int2Mm right)
        {
            var leftKey = PositionKey(left);
            var rightKey = PositionKey(right);
            var cacheKey = string.CompareOrdinal(leftKey, rightKey) < 0
                ? leftKey + "|" + rightKey
                : rightKey + "|" + leftKey;
            if (NavigationDistanceCache.TryGetValue(cacheKey, out var cached))
            {
                return cached;
            }

            var startId = NearestRouteNode(left);
            var endId = NearestRouteNode(right);
            long distance;
            if (startId != null &&
                endId != null &&
                RouteDistancesFrom(startId).TryGetValue(
                    endId,
                    out var routeDistance))
            {
                distance =
                    LinearDistanceMm(left, NodeById[startId]) +
                    routeDistance +
                    LinearDistanceMm(NodeById[endId], right);
            }
            else
            {
                distance = LinearDistanceMm(left, right);
            }

            NavigationDistanceCache[cacheKey] = distance;
            return distance;
        }

        public static long LinearDistanceMm(Int2Mm left, Int2Mm right)
        {
            return (long)Math.Truncate(
                Math.Sqrt(IntegerMath.DistanceSquared(left, right)));
        }

        private static string PositionKey(Int2Mm position)
        {
            return position.X + "," + position.Z;
        }

        private static string NearestRouteNode(Int2Mm position)
        {
            var key = PositionKey(position);
            if (NearestNodeCache.TryGetValue(key, out var cached))
            {
                return cached;
            }

            string nearest = null;
            var nearestDistance = long.MaxValue;
            var nodes = MapGeometryCatalog.RouteNodes;
            for (var index = 0; index < nodes.Length; index += 1)
            {
                var node = nodes[index];
                var nodePosition = new Int2Mm(
                    checked((int)node.Position.X),
                    checked((int)node.Position.Z));
                var candidateDistance = IntegerMath.DistanceSquared(
                    position,
                    nodePosition);
                if (candidateDistance < nearestDistance ||
                    (candidateDistance == nearestDistance &&
                     (nearest == null ||
                      string.CompareOrdinal(node.Id, nearest) < 0)))
                {
                    nearest = node.Id;
                    nearestDistance = candidateDistance;
                }
            }

            NearestNodeCache[key] = nearest;
            return nearest;
        }

        private static Dictionary<string, long> RouteDistancesFrom(
            string startId)
        {
            if (DistancesByStart.TryGetValue(startId, out var cached))
            {
                return cached;
            }

            var distances = new Dictionary<string, long>(
                StringComparer.Ordinal)
            {
                [startId] = 0
            };
            var unvisited = new HashSet<string>(
                NodeById.Keys,
                StringComparer.Ordinal);
            while (unvisited.Count > 0)
            {
                string currentId = null;
                var currentDistance = long.MaxValue;
                foreach (var nodeId in unvisited)
                {
                    var distance = distances.TryGetValue(
                        nodeId,
                        out var known)
                            ? known
                            : long.MaxValue;
                    if (distance < currentDistance ||
                        (distance == currentDistance &&
                         distance != long.MaxValue &&
                         (currentId == null ||
                          string.CompareOrdinal(nodeId, currentId) < 0)))
                    {
                        currentId = nodeId;
                        currentDistance = distance;
                    }
                }

                if (currentId == null || currentDistance == long.MaxValue)
                {
                    break;
                }

                unvisited.Remove(currentId);
                if (!Graph.TryGetValue(currentId, out var neighbors))
                {
                    continue;
                }

                for (var index = 0; index < neighbors.Count; index += 1)
                {
                    var neighbor = neighbors[index];
                    if (!unvisited.Contains(neighbor.NodeId))
                    {
                        continue;
                    }

                    var candidate = currentDistance + neighbor.DistanceMm;
                    var existing = distances.TryGetValue(
                        neighbor.NodeId,
                        out var knownDistance)
                            ? knownDistance
                            : long.MaxValue;
                    if (candidate < existing)
                    {
                        distances[neighbor.NodeId] = candidate;
                    }
                }
            }

            DistancesByStart[startId] = distances;
            return distances;
        }

        private static Dictionary<string, Int2Mm> BuildNodes()
        {
            var nodes = new Dictionary<string, Int2Mm>(
                StringComparer.Ordinal);
            var records = MapGeometryCatalog.RouteNodes;
            for (var index = 0; index < records.Length; index += 1)
            {
                nodes[records[index].Id] = new Int2Mm(
                    checked((int)records[index].Position.X),
                    checked((int)records[index].Position.Z));
            }

            return nodes;
        }

        private static Dictionary<string, List<RouteNeighbor>> BuildGraph()
        {
            var graph = new Dictionary<string, List<RouteNeighbor>>(
                StringComparer.Ordinal);
            var nodes = MapGeometryCatalog.RouteNodes;
            for (var index = 0; index < nodes.Length; index += 1)
            {
                graph[nodes[index].Id] = new List<RouteNeighbor>();
            }

            var edges = MapGeometryCatalog.RouteEdges;
            for (var index = 0; index < edges.Length; index += 1)
            {
                var edge = edges[index];
                if (graph.TryGetValue(edge.A, out var aNeighbors))
                {
                    aNeighbors.Add(new RouteNeighbor(edge.B, edge.LengthMm));
                }

                if (graph.TryGetValue(edge.B, out var bNeighbors))
                {
                    bNeighbors.Add(new RouteNeighbor(edge.A, edge.LengthMm));
                }
            }

            foreach (var neighbors in graph.Values)
            {
                neighbors.Sort(
                    (left, right) => string.CompareOrdinal(
                        left.NodeId,
                        right.NodeId));
            }

            return graph;
        }
    }
}
