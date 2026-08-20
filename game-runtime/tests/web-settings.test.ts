import {
  DEFAULT_WEB_GAME_SETTINGS,
  loadWebGameSettings,
  parseWebGameSettings,
  saveWebGameSettings,
} from '../apps/web/src/runtime/web-settings';

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

describe('Web game settings', () => {
  it('uses safe defaults for malformed or unsupported values', () => {
    expect(parseWebGameSettings(null)).toEqual(DEFAULT_WEB_GAME_SETTINGS);
    expect(
      parseWebGameSettings({
        graphicsPreference: 'ultra',
        cameraView: 'free',
        showPerformance: 'yes',
      }),
    ).toEqual(DEFAULT_WEB_GAME_SETTINGS);
  });

  it('round-trips persisted settings', () => {
    const storage = new MemoryStorage();
    const settings = {
      graphicsPreference: 'performance' as const,
      cameraView: 'tactical' as const,
      showPerformance: true,
      masterVolume: 0.9,
      musicVolume: 0.35,
      sfxVolume: 0.75,
      uiVolume: 0.55,
    };

    saveWebGameSettings(storage, settings);

    expect(loadWebGameSettings(storage)).toEqual(settings);
  });
});
