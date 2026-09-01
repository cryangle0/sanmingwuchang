import { terrainHeightMeters, terrainHeightMm } from '@jwgb/content';
import { describe, expect, it } from 'vitest';
import { buildGroundGeometry } from '../apps/web/src/render/map/ground';
import { regionBlendAt, regionById } from '../apps/web/src/render/map/map-regions';
import {
  climateOf,
  climateSplatAt,
  precipForRegion,
} from '../apps/web/src/render/map/region-climate';
import { remotePrecipPlan } from '../apps/web/src/render/map/weather-field';

describe('district climate', () => {
  it('puts rain on every district of the autumn storm', () => {
    expect(precipForRegion('mihun')).toBe('rain');
    expect(precipForRegion('zhusi')).toBe('rain');
    expect(precipForRegion('longji')).toBe('rain');
    expect(precipForRegion('jinshui')).toBe('rain');
    expect(precipForRegion('duanjin')).toBe('rain');
    expect(precipForRegion('baizu')).toBe('rain');
    expect(precipForRegion('santing')).toBe('rain');
  });

  it('keeps precipitation local because the whole map is raining', () => {
    const zhusi = regionById('zhusi').anchor;
    const plan = remotePrecipPlan(zhusi.x, zhusi.z, 48, 48, (x, z) => {
      const dx = x - zhusi.x;
      const dz = z - zhusi.z;
      return dx * dx + dz * dz < 40 * 40 ? 'zhusi' : 'santing';
    });
    expect(plan).toEqual({ mode: 'rain', local: true });
  });

  it('still rains from a former clear vantage', () => {
    const plan = remotePrecipPlan(0, 0, 48, 48, (x) => (x > 20 ? 'longji' : 'santing'));
    expect(plan.mode).toBe('rain');
    expect(plan.local).toBe(true);
  });

  it('bakes wet marsh and ashy market into the ground splat', () => {
    const splatAt = (x: number, z: number) => climateSplatAt(x, z, terrainHeightMeters(x, z));
    const marsh = splatAt(-20, -265);
    const market = splatAt(300, -145);
    const grove = splatAt(-282, -180);
    expect(marsh.wet).toBeGreaterThan(0.55);
    expect(market.soil).toBeGreaterThan(grove.soil);
    expect(grove.wet).toBeGreaterThan(0.4);

    let peakFrost = 0;
    for (let x = 200; x <= 400; x += 8) {
      for (let z = 60; z <= 300; z += 8) {
        if (regionBlendAt(x, z).primary.id !== 'longji') {
          continue;
        }
        peakFrost = Math.max(peakFrost, splatAt(x, z).frost);
      }
    }
    expect(peakFrost).toBe(0);
  });

  it('does not change authoritative terrain height', () => {
    expect(climateOf('mihun').weather).toBe('rain');
    expect(terrainHeightMm(0, 0)).toBe(terrainHeightMm(0, 0));
  });

  it('stores climate weights on the ground mesh', () => {
    const geometry = buildGroundGeometry();
    const climate = geometry.getAttribute('climate');
    expect(climate?.itemSize).toBe(3);
    expect(climate?.count).toBeGreaterThan(100);
    geometry.dispose();
  });
});
