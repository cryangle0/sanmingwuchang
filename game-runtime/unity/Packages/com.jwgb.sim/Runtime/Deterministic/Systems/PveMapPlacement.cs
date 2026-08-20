using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class PveMapPlacement
    {
        public static Int2Mm Home(
            uint rootSeed,
            MonsterKind kind,
            int index)
        {
            if (kind == MonsterKind.GroundMelee ||
                kind == MonsterKind.GroundRanged ||
                kind == MonsterKind.Flying)
            {
                return CommonMonsterHome(kind, index);
            }

            if (kind == MonsterKind.Pig)
            {
                return Point(
                    MapGeometryCatalog.Pigs[
                        CandidateIndex(
                            rootSeed,
                            "pve-pigs",
                            index,
                            MapGeometryCatalog.Pigs.Length)].Position);
            }

            if (kind == MonsterKind.EliteTank)
            {
                return Point(MapGeometryCatalog.Elites[index].Position);
            }

            if (kind == MonsterKind.EliteRanged)
            {
                return Point(MapGeometryCatalog.Elites[index + 2].Position);
            }

            if (kind == MonsterKind.DragonKing)
            {
                return Point(Dragon(rootSeed, index).Position);
            }

            var courtIndex = CandidateIndex(
                rootSeed,
                "pve-court",
                0,
                MapGeometryCatalog.Courts.Length);
            return Point(MapGeometryCatalog.Courts[courtIndex].Center);
        }

        public static MapCourtGeometryRecord CoreCourt(uint rootSeed)
        {
            return MapGeometryCatalog.Courts[
                CandidateIndex(
                    rootSeed,
                    "pve-court",
                    0,
                    MapGeometryCatalog.Courts.Length)];
        }

        public static FiveElement DragonElement(
            uint rootSeed,
            int requestedIndex)
        {
            return Dragon(rootSeed, requestedIndex).Id switch
            {
                "DK1" => FiveElement.Metal,
                "DK2" => FiveElement.Wood,
                "DK3" => FiveElement.Water,
                "DK4" => FiveElement.Fire,
                "DK5" => FiveElement.Earth,
                var id => throw new System.InvalidOperationException(
                    $"Map dragon site {id} has no element.")
            };
        }

        private static MapNamedPointGeometryRecord Dragon(
            uint rootSeed,
            int requestedIndex)
        {
            return MapGeometryCatalog.Dragons[
                CandidateIndex(
                    rootSeed,
                    "pve-dragons",
                    requestedIndex,
                    MapGeometryCatalog.Dragons.Length)];
        }

        private static Int2Mm CommonMonsterHome(
            MonsterKind kind,
            int requestedIndex)
        {
            var code = kind == MonsterKind.GroundMelee
                ? "MEL"
                : kind == MonsterKind.GroundRanged ? "RNG" : "FLY";
            var seen = 0;
            foreach (var slot in MapGeometryCatalog.MonsterSlots)
            {
                if (slot.Kind != code)
                {
                    continue;
                }

                if (seen == requestedIndex)
                {
                    return Point(slot.Position);
                }

                seen += 1;
            }

            throw new System.ArgumentOutOfRangeException(
                nameof(requestedIndex));
        }

        private static int CandidateIndex(
            uint rootSeed,
            string stream,
            int requestedIndex,
            int capacity)
        {
            var indices = new int[capacity];
            for (var index = 0; index < capacity; index += 1)
            {
                indices[index] = index;
            }

            var random = new DeterministicRng(rootSeed).Fork(stream);
            for (var index = capacity - 1; index > 0; index -= 1)
            {
                var selected = (int)random.NextInt((ulong)(index + 1));
                (indices[index], indices[selected]) =
                    (indices[selected], indices[index]);
            }

            return indices[requestedIndex];
        }

        private static Int2Mm Point(MapPointMmRecord point)
        {
            return new Int2Mm(
                checked((int)point.X),
                checked((int)point.Z));
        }
    }
}
