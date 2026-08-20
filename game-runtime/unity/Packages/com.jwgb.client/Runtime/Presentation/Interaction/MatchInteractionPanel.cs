using System;
using Jwgb.Core;
using Jwgb.Sim.Deterministic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Jwgb.Client.Presentation
{
    internal sealed partial class MatchInteractionPanel
    {
        private enum PanelMode : byte
        {
            World = 0,
            Loadout = 1
        }

        private readonly MatchInteractionPanelElements elements;
        private readonly Action<SimulationTransactionRequest> execute;
        private PanelMode mode;
        private WorldSnapshot snapshot;
        private PlayerSnapshot player;
        private int lastContentTick = -1;
        private bool forceContentRefresh = true;
        private string focusedAirdropId;
        private string lastWorldContext;

        public MatchInteractionPanel(
            VisualElement parent,
            Action<SimulationTransactionRequest> execute)
        {
            this.execute = execute ??
                throw new ArgumentNullException(nameof(execute));
            elements = MatchInteractionPanelBuilder.Build(parent);
            elements.Toggle.clicked += OpenLoadout;
            elements.WorldTab.clicked += OpenWorld;
            elements.LoadoutTab.clicked += OpenLoadout;
            elements.Close.clicked += Close;
            elements.AirdropAction.clicked += OpenFocusedAirdrop;
            ApplyMode();
        }

        public void Dispose()
        {
            elements.Root.RemoveFromHierarchy();
        }

        public void Refresh(
            WorldSnapshot nextSnapshot,
            int localEntityId)
        {
            snapshot = nextSnapshot;
            player = FindPlayer(nextSnapshot, localEntityId);
            if (nextSnapshot != null &&
                nextSnapshot.Tick < lastContentTick)
            {
                lastContentTick = -1;
                forceContentRefresh = true;
            }
            if (snapshot == null || player == null)
            {
                elements.Toggle.style.display = DisplayStyle.None;
                elements.Panel.style.display = DisplayStyle.None;
                elements.AirdropBanner.style.display =
                    DisplayStyle.None;
                return;
            }

            elements.Toggle.style.display = DisplayStyle.Flex;
            UpdateAirdrop();
            var worldContext = WorldContextKey();
            if (!string.IsNullOrEmpty(worldContext) &&
                worldContext != lastWorldContext)
            {
                mode = PanelMode.World;
                elements.Panel.style.display = DisplayStyle.Flex;
                forceContentRefresh = true;
            }
            lastWorldContext = worldContext;

            if (elements.Panel.resolvedStyle.display ==
                    DisplayStyle.None)
            {
                return;
            }
            if (!forceContentRefresh &&
                snapshot.Tick - lastContentTick <
                    SimulationConstants.TicksPerSecond / 5)
            {
                return;
            }

            forceContentRefresh = false;
            lastContentTick = snapshot.Tick;
            BuildContent();
        }

        public void ShowResult(ClientTransactionResult result)
        {
            if (result == null)
            {
                return;
            }

            elements.Status.text = result.Accepted
                ? "ACCEPTED"
                : Humanize(result.Code);
            elements.Status.style.color = result.Accepted
                ? new Color(0.34f, 0.86f, 0.48f)
                : new Color(0.96f, 0.52f, 0.28f);
            forceContentRefresh = true;
            if (result.Snapshot != null && player != null)
            {
                Refresh(result.Snapshot, player.EntityId);
            }
        }

        private void BuildContent()
        {
            elements.Content.Clear();
            ApplyMode();
            if (mode == PanelMode.World)
            {
                BuildWorldContent();
            }
            else
            {
                BuildLoadoutContent();
            }
        }

        private void OpenWorld()
        {
            mode = PanelMode.World;
            elements.Panel.style.display = DisplayStyle.Flex;
            forceContentRefresh = true;
            BuildContentIfReady();
        }

        private void OpenLoadout()
        {
            mode = PanelMode.Loadout;
            elements.Panel.style.display = DisplayStyle.Flex;
            forceContentRefresh = true;
            BuildContentIfReady();
        }

        private void Close()
        {
            elements.Panel.style.display = DisplayStyle.None;
        }

        private void BuildContentIfReady()
        {
            if (snapshot != null && player != null)
            {
                BuildContent();
                forceContentRefresh = false;
                lastContentTick = snapshot.Tick;
            }
        }

        private void ApplyMode()
        {
            var world = mode == PanelMode.World;
            elements.Title.text = world
                ? "WORLD INTERACTIONS"
                : "LOADOUT";
            SetSelected(elements.WorldTab, world);
            SetSelected(elements.LoadoutTab, !world);
        }

        private void Submit(SimulationTransactionRequest request)
        {
            try
            {
                execute(request);
                elements.Status.text = "PENDING";
                elements.Status.style.color =
                    new Color(0.95f, 0.72f, 0.32f);
            }
            catch (Exception exception)
            {
                elements.Status.text =
                    Humanize(exception.Message);
                elements.Status.style.color =
                    new Color(0.96f, 0.52f, 0.28f);
            }
        }

        private void AddSection(string title)
        {
            var label = new Label(title);
            label.style.marginTop = 8;
            label.style.marginBottom = 4;
            label.style.fontSize = 12;
            label.style.color = new Color(0.95f, 0.72f, 0.32f);
            label.style.unityFontStyleAndWeight = FontStyle.Bold;
            elements.Content.Add(label);
        }

        private VisualElement AddRow(string text)
        {
            var row = new VisualElement();
            row.style.flexDirection = FlexDirection.Row;
            row.style.flexWrap = Wrap.Wrap;
            row.style.alignItems = Align.Center;
            row.style.paddingTop = 5;
            row.style.paddingBottom = 5;
            row.style.borderBottomWidth = 1;
            row.style.borderBottomColor =
                new Color(0.25f, 0.29f, 0.29f, 0.55f);
            var label = new Label(text);
            label.style.flexGrow = 1;
            label.style.minWidth = 150;
            label.style.whiteSpace = WhiteSpace.Normal;
            label.style.fontSize = 11;
            row.Add(label);
            elements.Content.Add(row);
            return row;
        }

        private Button AddAction(
            VisualElement row,
            string label,
            string tooltip,
            Action action,
            bool enabled = true,
            string disabledReason = null)
        {
            var button = new Button(action)
            {
                text = label,
                tooltip = enabled
                    ? tooltip
                    : disabledReason ?? tooltip
            };
            button.style.minWidth = 62;
            button.style.height = 30;
            button.style.marginLeft = 4;
            button.style.marginTop = 2;
            button.style.marginBottom = 2;
            button.style.whiteSpace = WhiteSpace.Normal;
            button.style.borderTopLeftRadius = 4;
            button.style.borderTopRightRadius = 4;
            button.style.borderBottomLeftRadius = 4;
            button.style.borderBottomRightRadius = 4;
            button.SetEnabled(enabled);
            row.Add(button);
            return button;
        }

        private static PlayerSnapshot FindPlayer(
            WorldSnapshot value,
            int entityId)
        {
            if (value == null)
            {
                return null;
            }
            for (var index = 0; index < value.Players.Length; index += 1)
            {
                if (value.Players[index].EntityId == entityId)
                {
                    return value.Players[index];
                }
            }
            return null;
        }

        private static long DistanceSquared(
            Int2Mm left,
            Int2Mm right)
        {
            var dx = (long)left.X - right.X;
            var dz = (long)left.Z - right.Z;
            return (dx * dx) + (dz * dz);
        }

        private static string Humanize(string value)
        {
            return string.IsNullOrWhiteSpace(value)
                ? "TRANSACTION FAILED"
                : value.Replace('-', ' ').ToUpperInvariant();
        }

        private static void SetSelected(
            Button button,
            bool selected)
        {
            button.style.backgroundColor = selected
                ? new Color(0.92f, 0.45f, 0.12f)
                : new Color(0.10f, 0.12f, 0.12f, 0.98f);
            button.style.color = selected
                ? new Color(0.04f, 0.045f, 0.04f)
                : new Color(0.94f, 0.96f, 0.94f);
        }
    }
}
