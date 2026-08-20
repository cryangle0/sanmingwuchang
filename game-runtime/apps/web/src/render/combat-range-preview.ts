import type { ActiveAbilityDefinition } from '@jwgb/content';

export type CombatRangePreviewMode = 'none' | 'attack' | 'active' | 'both';

export type ActivePresentationRangeSource = 'range' | 'distance' | 'radius';

export interface ActivePresentationRange {
  readonly rangeMm: number;
  readonly source: ActivePresentationRangeSource;
}

function positiveFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function activePresentationRange(
  active: ActiveAbilityDefinition,
): ActivePresentationRange | null {
  const range = 'rangeMm' in active ? positiveFinite(active.rangeMm) : null;
  if (range !== null) {
    return { rangeMm: range, source: 'range' };
  }
  const distance = 'distanceMm' in active ? positiveFinite(active.distanceMm) : null;
  if (distance !== null) {
    return { rangeMm: distance, source: 'distance' };
  }
  const radius = 'radiusMm' in active ? positiveFinite(active.radiusMm) : null;
  return radius !== null ? { rangeMm: radius, source: 'radius' } : null;
}
