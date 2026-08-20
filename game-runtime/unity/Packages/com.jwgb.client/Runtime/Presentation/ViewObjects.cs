using UnityEngine;

namespace Jwgb.Client.Presentation
{
    /// <summary>
    /// Destroys view scene objects safely in both play mode and
    /// edit-mode tests.
    /// </summary>
    internal static class ViewObjects
    {
        public static void DestroyObject(Object target)
        {
            if (target == null)
            {
                return;
            }
            if (Application.isPlaying)
            {
                Object.Destroy(target);
            }
            else
            {
                Object.DestroyImmediate(target);
            }
        }
    }
}
