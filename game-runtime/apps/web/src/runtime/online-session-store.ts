import { type PlayerId, playerId } from '@jwgb/core';

export interface StoredOnlineSession {
  readonly playerId: PlayerId;
  readonly recoveryToken: string | null;
}

function storageKey(serverUrl: string): string {
  return `jwgb:online-session:${serverUrl}`;
}

function isRecoveryToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export function loadOnlineSession(storage: Storage, serverUrl: string): StoredOnlineSession | null {
  try {
    const raw = storage.getItem(storageKey(serverUrl));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || !('playerId' in parsed)) {
      return null;
    }
    const storedPlayerId = playerId(String(parsed.playerId));
    const recoveryToken =
      'recoveryToken' in parsed && isRecoveryToken(parsed.recoveryToken)
        ? parsed.recoveryToken
        : null;
    return {
      playerId: storedPlayerId,
      recoveryToken,
    };
  } catch {
    return null;
  }
}

export function saveOnlineSession(
  storage: Storage,
  serverUrl: string,
  session: StoredOnlineSession,
): void {
  try {
    storage.setItem(storageKey(serverUrl), JSON.stringify(session));
  } catch {}
}

export function clearOnlineSession(storage: Storage, serverUrl: string): void {
  try {
    storage.removeItem(storageKey(serverUrl));
  } catch {}
}
