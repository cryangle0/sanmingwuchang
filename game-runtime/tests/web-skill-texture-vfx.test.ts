import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface SkillTextureManifestEntry {
  readonly atlasPath: string;
  readonly columns: number;
  readonly rows: number;
  readonly frames: number;
  readonly fps: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly overlaySlot: number;
}

interface SkillTextureManifest {
  readonly schema: string;
  readonly staticOverlay: {
    readonly path: string;
    readonly columns: number;
    readonly rows: number;
    readonly slots: number;
  };
  readonly effects: Readonly<Record<string, SkillTextureManifestEntry>>;
}

const publicRoot = resolve(process.cwd(), 'apps', 'web', 'public');
const manifestPath = resolve(publicRoot, 'vfx', 'skills', 'manifest.json');

function readManifest(): SkillTextureManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as SkillTextureManifest;
}

describe('skill texture vfx package', () => {
  it('packages one valid atlas for every hero, monster and boss skill', () => {
    const manifest = readManifest();
    const keys = Object.keys(manifest.effects);
    const heroKeys = keys.filter((key) => /^H\d{3}$/.test(key));
    const monsterKeys = keys.filter((key) => key.startsWith('M-'));
    const bossKeys = keys.filter((key) => key.startsWith('BOSS-'));

    expect(manifest.schema).toBe('jwgb.skill-vfx-atlas.v1');
    expect(heroKeys).toHaveLength(38);
    expect(monsterKeys).toHaveLength(8);
    expect(bossKeys).toHaveLength(8);
    expect(keys).toHaveLength(54);

    for (const [key, entry] of Object.entries(manifest.effects)) {
      expect(entry.frames, key).toBeGreaterThanOrEqual(4);
      expect(entry.frames, key).toBeLessThanOrEqual(8);
      expect(entry.columns, key).toBe(4);
      expect(entry.rows, key).toBe(2);
      expect(entry.fps, key).toBeGreaterThan(0);
      expect(entry.overlaySlot, key).toBeGreaterThanOrEqual(0);
      expect(entry.overlaySlot, key).toBeLessThan(manifest.staticOverlay.slots);
      const atlasPath = resolve(publicRoot, entry.atlasPath);
      expect(existsSync(atlasPath), key).toBe(true);
      expect(statSync(atlasPath).size, key).toBeGreaterThan(1_000);
    }

    const overlayPath = resolve(publicRoot, manifest.staticOverlay.path);
    expect(existsSync(overlayPath)).toBe(true);
    expect(statSync(overlayPath).size).toBeGreaterThan(1_000);
  });
});
