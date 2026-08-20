import { M0_RULES, MAP_COURTS } from '@jwgb/content';
import { TICKS_PER_SECOND, type Vec2Mm, vec2Mm } from '@jwgb/core';
import type { MutableSimulationState, SimEvent, StormZoneState } from '../types';

interface RadiusStage {
  readonly startTick: number;
  readonly endTick: number;
  readonly startRadiusMm: number;
  readonly endRadiusMm: number;
}

const NORMAL_STORM_STAGES: readonly RadiusStage[] = [
  { startTick: 0, endTick: 300 * TICKS_PER_SECOND, startRadiusMm: 520_000, endRadiusMm: 520_000 },
  {
    startTick: 300 * TICKS_PER_SECOND,
    endTick: 450 * TICKS_PER_SECOND,
    startRadiusMm: 520_000,
    endRadiusMm: 320_000,
  },
  {
    startTick: 450 * TICKS_PER_SECOND,
    endTick: 600 * TICKS_PER_SECOND,
    startRadiusMm: 320_000,
    endRadiusMm: 320_000,
  },
  {
    startTick: 600 * TICKS_PER_SECOND,
    endTick: 750 * TICKS_PER_SECOND,
    startRadiusMm: 320_000,
    endRadiusMm: 220_000,
  },
  {
    startTick: 750 * TICKS_PER_SECOND,
    endTick: 900 * TICKS_PER_SECOND,
    startRadiusMm: 220_000,
    endRadiusMm: 220_000,
  },
  {
    startTick: 900 * TICKS_PER_SECOND,
    endTick: 1_050 * TICKS_PER_SECOND,
    startRadiusMm: 220_000,
    endRadiusMm: 140_000,
  },
  {
    startTick: 1_050 * TICKS_PER_SECOND,
    endTick: 1_110 * TICKS_PER_SECOND,
    startRadiusMm: 140_000,
    endRadiusMm: 90_000,
  },
  {
    startTick: 1_110 * TICKS_PER_SECOND,
    endTick: 1_140 * TICKS_PER_SECOND,
    startRadiusMm: 90_000,
    endRadiusMm: 60_000,
  },
  {
    startTick: 1_140 * TICKS_PER_SECOND,
    endTick: 1_200 * TICKS_PER_SECOND,
    startRadiusMm: 60_000,
    endRadiusMm: 0,
  },
];

const ORIGIN = vec2Mm(0, 0);

export function initialStormZone(selectedCourtId: string | null): StormZoneState {
  return {
    selectedCourtId,
    courtAnnouncementTick: M0_RULES.stormCourtAnnouncementTick,
    warningTick: M0_RULES.stormWarningTick,
    center: vec2Mm(0, 0),
    radiusMm: 520_000,
    courtAnnounced: false,
    apocalypseWarning: false,
    apocalypseStarted: false,
  };
}

function selectedCourt(
  state: Pick<MutableSimulationState, 'stormZone'>,
): (typeof MAP_COURTS)[number] | null {
  const courtId = state.stormZone.selectedCourtId;
  return courtId === null ? null : (MAP_COURTS.find((court) => court.id === courtId) ?? null);
}

function interpolatePoint(from: Vec2Mm, to: Vec2Mm, elapsed: number, duration: number): Vec2Mm {
  if (duration <= 0 || elapsed <= 0) {
    return vec2Mm(from.x, from.z);
  }
  if (elapsed >= duration) {
    return vec2Mm(to.x, to.z);
  }
  return vec2Mm(
    from.x + Math.trunc(((to.x - from.x) * elapsed) / duration),
    from.z + Math.trunc(((to.z - from.z) * elapsed) / duration),
  );
}

function stormCenterAtTick(state: Pick<MutableSimulationState, 'stormZone'>, tick: number): Vec2Mm {
  const court = selectedCourt(state);
  if (!court || tick < M0_RULES.stormCenterMoveStartTick) {
    return vec2Mm(ORIGIN.x, ORIGIN.z);
  }
  const courtCenter = vec2Mm(court.center.x, court.center.z);
  const firstMoveEnd = Math.min(M0_RULES.stormCenterArrivalTick, 15 * 60 * TICKS_PER_SECOND);
  if (tick < firstMoveEnd) {
    return interpolatePoint(
      ORIGIN,
      vec2Mm(Math.trunc(courtCenter.x / 3), Math.trunc(courtCenter.z / 3)),
      tick - M0_RULES.stormCenterMoveStartTick,
      firstMoveEnd - M0_RULES.stormCenterMoveStartTick,
    );
  }
  return interpolatePoint(
    vec2Mm(Math.trunc(courtCenter.x / 3), Math.trunc(courtCenter.z / 3)),
    courtCenter,
    tick - firstMoveEnd,
    M0_RULES.stormCenterArrivalTick - firstMoveEnd,
  );
}

export function normalStormSafeCircleAtTick(
  state: Pick<MutableSimulationState, 'stormZone'>,
  tick: number,
): { readonly center: Vec2Mm; readonly radiusMm: number } {
  return {
    center: stormCenterAtTick(state, tick),
    radiusMm: normalStormSafeRadiusMm(tick),
  };
}

/**
 * Advances the single authoritative safe-circle state. The 150-second
 * shrink windows are the accepted R-NEW-01 audit decision; the generated map
 * remains geometry authority, while this function is runtime rule authority.
 */
export function advanceStormZone(state: MutableSimulationState, events: SimEvent[]): void {
  state.stormZone.radiusMm = normalStormSafeRadiusMm(state.tick);
  state.stormZone.center = stormCenterAtTick(state, state.tick);

  if (
    !state.stormZone.courtAnnounced &&
    state.stormZone.selectedCourtId !== null &&
    state.tick >= state.stormZone.courtAnnouncementTick
  ) {
    state.stormZone.courtAnnounced = true;
    const court = selectedCourt(state);
    if (court) {
      events.push({
        type: 'final-court-announced',
        tick: state.tick,
        courtId: court.id,
        center: vec2Mm(court.center.x, court.center.z),
      });
    }
  }
  if (!state.stormZone.apocalypseWarning && state.tick >= state.stormZone.warningTick) {
    state.stormZone.apocalypseWarning = true;
    events.push({
      type: 'apocalypse-warning',
      tick: state.tick,
      courtId: state.stormZone.selectedCourtId,
      center: vec2Mm(state.stormZone.center.x, state.stormZone.center.z),
    });
  }
  if (!state.stormZone.apocalypseStarted && state.tick >= M0_RULES.apocalypseStartTick) {
    state.stormZone.apocalypseStarted = true;
    events.push({
      type: 'apocalypse-started',
      tick: state.tick,
      courtId: state.stormZone.selectedCourtId,
      center: vec2Mm(state.stormZone.center.x, state.stormZone.center.z),
    });
  }
}

export function normalStormSafeRadiusMm(tick: number): number {
  if (tick >= 1_200 * TICKS_PER_SECOND) {
    return 0;
  }
  const stage =
    NORMAL_STORM_STAGES.find(
      (candidate) => tick >= candidate.startTick && tick < candidate.endTick,
    ) ?? NORMAL_STORM_STAGES[0];
  if (!stage || stage.startRadiusMm === stage.endRadiusMm) {
    return stage?.startRadiusMm ?? 0;
  }
  const elapsed = tick - stage.startTick;
  const duration = stage.endTick - stage.startTick;
  return (
    stage.startRadiusMm +
    Math.trunc(((stage.endRadiusMm - stage.startRadiusMm) * elapsed) / duration)
  );
}

export function isInNormalStormZone(
  state: Pick<MutableSimulationState, 'stormZone'>,
  position: Vec2Mm,
): boolean {
  const radiusMm = state.stormZone.radiusMm;
  if (radiusMm <= 0) {
    return true;
  }
  const dx = position.x - state.stormZone.center.x;
  const dz = position.z - state.stormZone.center.z;
  return dx * dx + dz * dz > radiusMm * radiusMm;
}

export function isInsideNormalStormSafeZone(
  state: Pick<MutableSimulationState, 'stormZone'>,
  position: Vec2Mm,
): boolean {
  return state.stormZone.radiusMm > 0 && !isInNormalStormZone(state, position);
}
