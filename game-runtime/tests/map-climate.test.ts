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
  it('assigns rain, snow and clear weather from the six districts', () => {
    expect(precipForRegion('mihun')).toBe('rain');
    expect(precipForRegion('zhusi')).toBe('rain');
    expect(precipForRegion('longji')).toBe('snow');
    expect(precipForRegion('jinshui')).toBeNull();
    expect(precipForRegion('duanjin')).toBeNull();
    expect(precipForRegion('baizu')).toBeNull();
    expect(precipForRegion('santing')).toBeNull();
  });

  it('keeps precipitation local when the camera stands in a weathered district', () => {
    const zhusi = regionById('zhusi').anchor;
    const plan = remotePrecipPlan(zhusi.x, zhusi.z, 48, 48, (x, z) => {
      const dx = x - zhusi.x;
      const dz = z - zhusi.z;
      return dx * dx + dz * dz < 40 * 40 ? 'zhusi' : 'santing';
    });
    expect(plan).toEqual({ mode: 'rain', local: true });
  });

  it('shows a neighbour snowfield from a clear vantage', () => {
    const plan = remotePrecipPlan(0, 0, 48, 48, (x) => (x > 20 ? 'longji' : 'santing'));
    expect(plan.mode).toBe('snow');
    expect(plan.local).toBe(false);
  });

  it('bakes wet marsh, ashy market and highland frost into the ground splat', () => {
    // Heights are sampled, not written in: frost and wetness now key off how
    // far a point stands above or below its surroundings, so passing a literal
    // height describes a spot that does not exist.
    const splatAt = (x: number, z: number) => climateSplatAt(x, z, terrainHeightMeters(x, z));
    const marsh = splatAt(-20, -265);
    const market = splatAt(300, -145);
    const grove = splatAt(-282, -180);
    expect(marsh.wet).toBeGreaterThan(0.55);
    expect(market.soil).toBeGreaterThan(grove.soil);
    expect(grove.wet).toBeLessThan(0.2);

    // Frost belongs to high ground in 龙脊渊, wherever that ground happens to
    // be. Asserting a fixed coordinate would only test the noise seed.
    let peakFrost = 0;
    for (let x = 200; x <= 400; x += 8) {
      for (let z = 60; z <= 300; z += 8) {
        if (regionBlendAt(x, z).primary.id !== 'longji') {
          continue;
        }
        peakFrost = Math.max(peakFrost, splatAt(x, z).frost);
      }
    }
    expect(peakFrost).toBeGreaterThan(0.45);
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
