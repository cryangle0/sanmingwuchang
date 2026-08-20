import {
  activeIconUrl,
  equipmentIconUrl,
  flowAssetUrl,
  heroCardUrl,
  heroPortraitUrl,
  modelAssetBaseUrl,
  passiveIconUrl,
  resolveAssetDirectoryUrl,
  resolveAssetUrl,
} from '../apps/web/src/runtime/asset-url';
import { resolveOnlineServerUrl } from '../apps/web/src/runtime/online-server-url';
import { resolveWebRuntimeMode } from '../apps/web/src/runtime/web-runtime-mode';

describe('web runtime URLs', () => {
  it('defaults to online mode and only uses local mode when explicitly requested', () => {
    expect(resolveWebRuntimeMode(null)).toBe('online');
    expect(resolveWebRuntimeMode('online')).toBe('online');
    expect(resolveWebRuntimeMode('unsupported')).toBe('online');
    expect(resolveWebRuntimeMode('local')).toBe('local');
  });

  it('uses the same-origin secure WebSocket endpoint on HTTPS', () => {
    expect(
      resolveOnlineServerUrl(
        {
          protocol: 'https:',
          hostname: 'fanavatar.org',
          host: 'fanavatar.org',
        },
        null,
      ),
    ).toBe('wss://fanavatar.org/match');
  });

  it('keeps the local Node development port on HTTP localhost', () => {
    expect(
      resolveOnlineServerUrl(
        {
          protocol: 'http:',
          hostname: 'localhost',
          host: 'localhost:5173',
        },
        null,
      ),
    ).toBe('ws://localhost:8787/match');
  });

  it('prefers and validates an explicit server URL', () => {
    expect(
      resolveOnlineServerUrl(
        {
          protocol: 'https:',
          hostname: 'fanavatar.org',
          host: 'fanavatar.org',
        },
        'wss://match.example.test/custom',
      ),
    ).toBe('wss://match.example.test/custom');
    expect(() =>
      resolveOnlineServerUrl(
        {
          protocol: 'https:',
          hostname: 'fanavatar.org',
          host: 'fanavatar.org',
        },
        'https://example.test/match',
      ),
    ).toThrow('online server must use ws or wss');
  });

  it('resolves relative and absolute asset bases', () => {
    expect(resolveAssetUrl('assets/heroes/H009.webp', '/demo/')).toBe(
      '/demo/assets/heroes/H009.webp',
    );
    expect(
      resolveAssetUrl('models/heroes/H009/model.fbx', 'https://cdn.example.test/game/current/'),
    ).toBe('https://cdn.example.test/game/current/models/heroes/H009/model.fbx');
  });

  it('serves all authoritative hero portraits and falls back for unknown IDs', () => {
    expect(heroPortraitUrl('H001')).toBe('/assets/heroes/H001.webp');
    expect(heroPortraitUrl('H038')).toBe('/assets/heroes/H038.webp');
    expect(heroPortraitUrl('H999')).toBe('/assets/heroes/H009.webp');
  });

  it('resolves flow, card and build icon assets', () => {
    expect(heroCardUrl('H018')).toBe('/assets/hero-cards/H018.webp');
    expect(flowAssetUrl('lobby-environment')).toBe('/assets/flow/lobby-environment.webp');
    expect(activeIconUrl('H009')).toBe('/assets/icons/active/H009.webp');
    expect(passiveIconUrl('B1')).toBe('/assets/icons/passive/B01.webp');
    expect(equipmentIconUrl('G10')).toBe('/assets/icons/equipment/G10.webp');
  });

  it('supports the same-origin production portrait proxy', () => {
    expect(resolveAssetUrl('assets/heroes/H009.webp', '/jwgb-assets/')).toBe(
      '/jwgb-assets/assets/heroes/H009.webp',
    );
  });

  it('keeps the local model base as a directory without an asset-version query', () => {
    expect(modelAssetBaseUrl()).toBe('/models/');
  });

  it('keeps loader directories version-free so filenames can be appended safely', () => {
    expect(resolveAssetDirectoryUrl('basis/', 'https://cdn.example.test/game/current/')).toBe(
      'https://cdn.example.test/game/current/basis/',
    );
    expect(resolveAssetDirectoryUrl('basis/', '/demo/')).toBe('/demo/basis/');
  });
});
