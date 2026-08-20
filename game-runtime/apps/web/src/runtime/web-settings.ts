export type WebGraphicsPreference = 'auto' | 'quality' | 'performance';
export type WebCameraViewMode = 'standard' | 'close' | 'tactical';

export interface WebGameSettings {
  readonly graphicsPreference: WebGraphicsPreference;
  readonly cameraView: WebCameraViewMode;
  readonly showPerformance: boolean;
  readonly masterVolume: number;
  readonly musicVolume: number;
  readonly sfxVolume: number;
  readonly uiVolume: number;
}

const STORAGE_KEY = 'jwgb:web-settings:v1';

export const DEFAULT_WEB_GAME_SETTINGS: WebGameSettings = {
  graphicsPreference: 'auto',
  cameraView: 'standard',
  showPerformance: false,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  uiVolume: 0.7,
};

function isGraphicsPreference(value: unknown): value is WebGraphicsPreference {
  return value === 'auto' || value === 'quality' || value === 'performance';
}

function isCameraViewMode(value: unknown): value is WebCameraViewMode {
  return value === 'standard' || value === 'close' || value === 'tactical';
}

function volumeOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function parseWebGameSettings(value: unknown): WebGameSettings {
  if (value === null || typeof value !== 'object') {
    return DEFAULT_WEB_GAME_SETTINGS;
  }
  const candidate = value as Partial<WebGameSettings>;
  return {
    graphicsPreference: isGraphicsPreference(candidate.graphicsPreference)
      ? candidate.graphicsPreference
      : DEFAULT_WEB_GAME_SETTINGS.graphicsPreference,
    cameraView: isCameraViewMode(candidate.cameraView)
      ? candidate.cameraView
      : DEFAULT_WEB_GAME_SETTINGS.cameraView,
    showPerformance:
      typeof candidate.showPerformance === 'boolean'
        ? candidate.showPerformance
        : DEFAULT_WEB_GAME_SETTINGS.showPerformance,
    masterVolume: volumeOrDefault(candidate.masterVolume, DEFAULT_WEB_GAME_SETTINGS.masterVolume),
    musicVolume: volumeOrDefault(candidate.musicVolume, DEFAULT_WEB_GAME_SETTINGS.musicVolume),
    sfxVolume: volumeOrDefault(candidate.sfxVolume, DEFAULT_WEB_GAME_SETTINGS.sfxVolume),
    uiVolume: volumeOrDefault(candidate.uiVolume, DEFAULT_WEB_GAME_SETTINGS.uiVolume),
  };
}

export function loadWebGameSettings(storage: Storage): WebGameSettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? parseWebGameSettings(JSON.parse(raw)) : DEFAULT_WEB_GAME_SETTINGS;
  } catch {
    return DEFAULT_WEB_GAME_SETTINGS;
  }
}

export function saveWebGameSettings(storage: Storage, settings: WebGameSettings): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(parseWebGameSettings(settings)));
  } catch {}
}
