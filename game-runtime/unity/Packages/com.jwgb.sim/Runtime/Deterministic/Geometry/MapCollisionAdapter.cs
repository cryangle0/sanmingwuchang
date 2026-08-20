using Jwgb.Content;
using Jwgb.Core;

namespace Jwgb.Sim.Deterministic
{
    internal static class MapCollisionAdapter
    {
        public static MapPointMmRecord ToMapPoint(Int2Mm point)
        {
            return new MapPointMmRecord(point.X, point.Z);
        }

        public static Int2Mm ToSimPoint(MapPointMmRecord point)
        {
            return new Int2Mm(
                checked((int)point.X),
                checked((int)point.Z));
        }

        public static Int2Mm ResolveMovement(
            MapCollisionField field,
            Int2Mm from,
            Int2Mm to,
            int radiusMm,
            WallTraversal traversal = default)
        {
            return ToSimPoint(
                field.ResolveMovement(
                    ToMapPoint(from),
                    ToMapPoint(to),
                    radiusMm,
                    traversal));
        }

        public static Int2Mm ResolveDisplacement(
            MapCollisionField field,
            Int2Mm origin,
            Int2Mm destination,
            int radiusMm,
            WallTraversal traversal = default)
        {
            return ToSimPoint(
                field.ResolveDisplacementPath(
                    ToMapPoint(origin),
                    ToMapPoint(destination),
                    radiusMm,
                    traversal));
        }
    }
}
