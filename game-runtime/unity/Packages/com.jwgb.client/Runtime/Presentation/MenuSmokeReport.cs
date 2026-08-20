using System;

namespace Jwgb.Client.Presentation
{
    [Serializable]
    internal sealed class MenuSmokeReport
    {
        public string schema;
        public string unityVersion;
        public int heroChoiceCount;
        public string firstHeroId;
        public string lastHeroId;
        public string selectedHeroId;
        public bool localModeButtonPresent;
        public bool onlineModeButtonPresent;
        public bool onlineControlsPresent;
        public bool reconnectControlsPresent;
        public int competitorMinimum;
        public int competitorMaximum;
        public int defaultCompetitorCount;
        public bool startButtonVisible;
        public bool hasActiveSession;
        public int screenWidth;
        public int screenHeight;
    }
}
