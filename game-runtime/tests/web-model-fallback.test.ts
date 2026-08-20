import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CharacterModelLibrary } from '../apps/web/src/render/models/character-model-library';
import { heroModelDefinition } from '../apps/web/src/render/models/web-model-catalog';

describe('web model loading fallback', () => {
  it('keeps loading identities non-renderable until the real model is ready', () => {
    const definition = heroModelDefinition('H018');
    expect(definition).not.toBeNull();
    if (!definition) {
      return;
    }

    const library = new CharacterModelLibrary('/models/');
    const placeholder = new THREE.Group();
    const instance = library.createInstance(definition, placeholder);

    expect(instance.isFallback).toBe(true);
    expect(instance.fallbackRenderableMeshCount).toBe(0);
    expect(library.diagnostics().renderableFallbackInstances).toBe(0);

    instance.dispose();
    library.dispose();
  });
});
