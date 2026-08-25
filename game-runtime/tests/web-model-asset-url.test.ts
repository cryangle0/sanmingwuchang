import { describe, expect, it, vi } from 'vitest';
import { characterModelAssetUrl } from '../apps/web/src/render/models/character-model-library';
import { heroModelDefinition } from '../apps/web/src/render/models/web-model-catalog';

describe('web character model asset URLs', () => {
  it('keeps legacy FBX assets on the configured model CDN', () => {
    const definition = heroModelDefinition('H017');
    expect(definition).not.toBeNull();
    if (!definition) {
      return;
    }

    expect(characterModelAssetUrl(definition, 'https://models.example.test/v1/')).toBe(
      'https://models.example.test/v1/heroes/H017/model.fbx',
    );
  });

  it('resolves animated heroes from the versioned Web asset base', () => {
    vi.stubEnv('VITE_ASSET_VERSION', '20260811120000');
    for (const id of [
      'H004',
      'H008',
      'H009',
      'H010',
      'H011',
      'H012',
      'H014',
      'H018',
      'H019',
      'H023',
      'H031',
      'H033',
      'H034',
      'H038',
    ]) {
      const definition = heroModelDefinition(id);
      expect(definition).not.toBeNull();
      if (!definition) {
        continue;
      }
      expect(characterModelAssetUrl(definition, 'https://models.example.test/v1/')).toContain(
        `/models/characters/${id}/model.glb`,
      );
    }
    vi.unstubAllEnvs();
  });
});
