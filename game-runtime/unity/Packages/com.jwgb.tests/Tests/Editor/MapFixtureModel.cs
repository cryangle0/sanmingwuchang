using System;

namespace Jwgb.Tests
{
    [Serializable]
    public sealed class MapFixtureDocument
    {
        public string schema;
        public string geometryHash;
        public int boundaryVertexCount;
        public int wallPieceCount;
        public int spawnPointCount;
        public MapFixtureBlockedQuery[] blockedQueries;
        public MapFixtureMovementQuery[] movementQueries;
        public MapFixtureSweepQuery[] sweepQueries;
    }

    [Serializable]
    public sealed class MapFixtureBlockedQuery
    {
        public long x;
        public long z;
        public long radiusMm;
        public bool insideBoundary;
        public string wallPieceId;
    }

    [Serializable]
    public sealed class MapFixtureMovementQuery
    {
        public long fromX;
        public long fromZ;
        public long toX;
        public long toZ;
        public long radiusMm;
        public long resultX;
        public long resultZ;
    }

    [Serializable]
    public sealed class MapFixtureSweepQuery
    {
        public long startX;
        public long startZ;
        public long endX;
        public long endZ;
        public long sweepDistanceMm;
        public long radiusMm;
        public bool hit;
        public long distanceMm;
        public string pieceId;
    }
}
