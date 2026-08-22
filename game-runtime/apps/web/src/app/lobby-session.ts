import type { PlayerId } from '@jwgb/core';
import type { GameFlowResult } from './game-flow';

/**
 * Lobby-side persistence: the small amount of player state the lobby can show
 * truthfully.
 *
 * The design prototype's lobby displays a cultivation realm, a level and a
 * player number, all of them literals typed into its HTML. None of those exist
 * on the server, so none of them are invented here. What this module exposes is
 * only what is actually known: the real player id the match service assigned,
 * whether a recoverable seat is still open, and the results of matches this
 * browser has finished. Anything the lobby cannot source is rendered as an
 * explicit "not connected yet" state rather than as a plausible number.
 */

/** Mirrors DEFAULT_RESUME_GRACE_PERIOD_MS on the authoritative room. */
export const SEAT_RECOVERY_WINDOW_MS = 120_000;

const PENDING_MATCH_KEY = 'jwgb-pending-match';
const MATCH_HISTORY_KEY = 'jwgb-match-history';
const MATCH_HISTORY_LIMIT = 50;

export interface PendingMatch {
  readonly matchId: string;
  readonly heroId: string | null;
  readonly startedAtMs: number;
}

export interface MatchRecord {
  readonly finishedAtMs: number;
  readonly outcome: GameFlowResult['outcome'];
  readonly placement: number | null;
  readonly heroId: string;
  readonly survivalSeconds: number;
  readonly kills: number | null;
}

export interface MatchHistorySummary {
  readonly matches: number;
  readonly victories: number;
  readonly bestPlacement: number | null;
  readonly totalSurvivalSeconds: number;
  readonly favouriteHeroId: string | null;
}

/**
 * A short, stable handle for the player.
 *
 * Derived from the id the server actually issued, so two browsers never show
 * the same tag and the same browser keeps its tag across reloads. It is a
 * display shortening of real data, not a stand-in for an account number the
 * game does not have.
 */
export function playerTag(id: PlayerId | string | null): string {
  if (!id) {
    return '未连接';
  }
  let hash = 0x811c9dc5;
  const text = String(id);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `#${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 4)}`;
}

export function readPendingMatch(storage: Storage, nowMs: number): PendingMatch | null {
  const pending = parse<PendingMatch>(storage, PENDING_MATCH_KEY);
  if (!pending || typeof pending.matchId !== 'string' || typeof pending.startedAtMs !== 'number') {
    return null;
  }
  // A seat only stays recoverable for the room's grace period. Past that the
  // card would invite the player to rejoin something that no longer exists.
  if (nowMs - pending.startedAtMs > SEAT_RECOVERY_WINDOW_MS) {
    storage.removeItem(PENDING_MATCH_KEY);
    return null;
  }
  return pending;
}

export function writePendingMatch(storage: Storage, pending: PendingMatch): void {
  write(storage, PENDING_MATCH_KEY, pending);
}

export function clearPendingMatch(storage: Storage): void {
  storage.removeItem(PENDING_MATCH_KEY);
}

export function readMatchHistory(storage: Storage): readonly MatchRecord[] {
  const records = parse<MatchRecord[]>(storage, MATCH_HISTORY_KEY);
  if (!Array.isArray(records)) {
    return [];
  }
  return records.filter(
    (record): record is MatchRecord =>
      !!record && typeof record.finishedAtMs === 'number' && typeof record.heroId === 'string',
  );
}

export function recordMatchResult(
  storage: Storage,
  result: GameFlowResult,
  finishedAtMs: number,
): readonly MatchRecord[] {
  const record: MatchRecord = {
    finishedAtMs,
    outcome: result.outcome,
    placement: result.placement,
    heroId: result.heroId,
    survivalSeconds: result.survivalSeconds,
    kills: result.kills,
  };
  const next = [record, ...readMatchHistory(storage)].slice(0, MATCH_HISTORY_LIMIT);
  write(storage, MATCH_HISTORY_KEY, next);
  return next;
}

export function summariseHistory(records: readonly MatchRecord[]): MatchHistorySummary {
  let victories = 0;
  let bestPlacement: number | null = null;
  let totalSurvivalSeconds = 0;
  const heroCounts = new Map<string, number>();
  for (const record of records) {
    if (record.outcome === 'victory') {
      victories += 1;
    }
    if (record.placement !== null && (bestPlacement === null || record.placement < bestPlacement)) {
      bestPlacement = record.placement;
    }
    totalSurvivalSeconds += record.survivalSeconds;
    heroCounts.set(record.heroId, (heroCounts.get(record.heroId) ?? 0) + 1);
  }
  let favouriteHeroId: string | null = null;
  let favouriteCount = 0;
  for (const [heroId, count] of heroCounts) {
    if (count > favouriteCount) {
      favouriteCount = count;
      favouriteHeroId = heroId;
    }
  }
  return {
    matches: records.length,
    victories,
    bestPlacement,
    totalSurvivalSeconds,
    favouriteHeroId,
  };
}

function parse<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Corrupt or unavailable storage must never keep the lobby off screen.
    return null;
  }
}

function write(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing and full quotas both land here; the lobby just loses
    // its local history, which is not worth failing a render over.
  }
}
