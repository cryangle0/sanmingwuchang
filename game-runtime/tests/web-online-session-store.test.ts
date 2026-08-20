import { playerId } from '@jwgb/core';
import {
  clearOnlineSession,
  loadOnlineSession,
  saveOnlineSession,
} from '../apps/web/src/runtime/online-session-store';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('online session storage', () => {
  it('keeps identity and recovery token scoped to the match endpoint', () => {
    const storage = new MemoryStorage();
    const serverUrl = 'ws://127.0.0.1:8787/match';
    const session = {
      playerId: playerId('browser-session-player'),
      recoveryToken: 'r'.repeat(43),
    };

    saveOnlineSession(storage, serverUrl, session);

    expect(loadOnlineSession(storage, serverUrl)).toEqual(session);
    expect(loadOnlineSession(storage, 'ws://127.0.0.1:9999/match')).toBeNull();
    clearOnlineSession(storage, serverUrl);
    expect(loadOnlineSession(storage, serverUrl)).toBeNull();
  });
});
