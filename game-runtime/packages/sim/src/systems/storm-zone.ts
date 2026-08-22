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

const STORM_DIRECTIONS = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'] as const;

export function stormPhaseName(tick: number): string {
  const seconds = Math.floor(tick / TICKS_PER_SECOND);
  if (seconds < 300) return '全图发育';
  if (seconds < 720) return '天劫收缩';
  if (seconds < 1_080) return '决赛庭';
  if (seconds < 1_200) return '终局聚合';
  return '灭世雷暴';
}

export function nextStormEvent(tick: number): { readonly label: string; readonly seconds: number } {
  if (tick >= 1_200 * TICKS_PER_SECOND) {
    return { label: '雷暴持续增强', seconds: 0 };
  }
  const stage =
    NORMAL_STORM_STAGES.find(
      (candidate) => tick >= candidate.startTick && tick < candidate.endTick,
    ) ?? NORMAL_STORM_STAGES[0];
  if (!stage) {
    return { label: '灭世雷暴', seconds: 0 };
  }
  const seconds = Math.max(0, Math.ceil((stage.endTick - tick) / TICKS_PER_SECOND));
  if (stage.startRadiusMm !== stage.endRadiusMm) {
    return { label: `缩圈中 ${seconds}秒`, seconds };
  }
  return { label: `${seconds}秒后缩圈`, seconds };
}

export function stormDirectionLabel(from: Vec2Mm, toward: Vec2Mm): string {
  const dx = toward.x - from.x;
  const dz = toward.z - from.z;
  if (dx === 0 && dz === 0) {
    return '圈心';
  }
  const angle = Math.atan2(dz, dx);
  const index = ((Math.round(angle / (Math.PI / 4)) + 8) % 8) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  return STORM_DIRECTIONS[index];
}

export interface StormPlayerStatus {
  readonly phaseName: string;
  readonly nextEventLabel: string;
  readonly apocalypse: boolean;
  readonly outside: boolean;
  readonly toSafeMeters: number;
  readonly directionLabel: string;
  readonly nextStrikeSeconds: number;
  readonly damagePercent: number;
  readonly hitChancePercent: number;
}

export function describeStormForPlayer(
  storm: Pick<StormZoneState, 'center' | 'radiusMm' | 'apocalypseStarted'>,
  tick: number,
  position: Vec2Mm,
): StormPlayerStatus {
  const apocalypse = storm.apocalypseStarted || tick >= 1_200 * TICKS_PER_SECOND;
  const distanceMm = Math.hypot(position.x - storm.center.x, position.z - storm.center.z);
  const outside = apocalypse || storm.radiusMm <= 0 || distanceMm > storm.radiusMm;
  const cycleTicks = apocalypse ? TICKS_PER_SECOND : 3 * TICKS_PER_SECOND;
  const elapsedInCycle = tick % cycleTicks;
  const nextStrikeTicks = elapsedInCycle === 0 ? cycleTicks : cycleTicks - elapsedInCycle;
  const elapsedSeconds = Math.floor(tick / TICKS_PER_SECOND);
  return {
    phaseName: stormPhaseName(tick),
    nextEventLabel: nextStormEvent(tick).label,
    apocalypse,
    outside,
    toSafeMeters: apocalypse || storm.radiusMm <= 0 ? 0 : Math.max(0, distanceMm - storm.radiusMm) / 1_000,
    directionLabel: stormDirectionLabel(position, storm.center),
    nextStrikeSeconds: Math.max(1, Math.ceil(nextStrikeTicks / TICKS_PER_SECOND)),
    damagePercent: apocalypse ? 2 + Math.floor((elapsedSeconds - 1_200) / 5) : 20,
    hitChancePercent: apocalypse ? 100 : 50,
  };
}
