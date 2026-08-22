import { MAP_BOUNDARY, terrainHeightMeters } from '../../../packages/content/src/index';
import { GROUND_FOOTING_BIAS_METERS, groundSurfaceMeters } from '../../../apps/web/src/render/map/ground';

let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
for (const p of MAP_BOUNDARY) {
  minX = Math.min(minX, p.x / 1000); maxX = Math.max(maxX, p.x / 1000);
  minZ = Math.min(minZ, p.z / 1000); maxZ = Math.max(maxZ, p.z / 1000);
}
let state = 12345 >>> 0;
const rnd = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
let worstDeficit = 0, worstAt = '';
const margins: number[] = [];
for (let i = 0; i < 200000; i += 1) {
  const x = minX + rnd() * (maxX - minX);
  const z = minZ + rnd() * (maxZ - minZ);
  const margin = groundSurfaceMeters(x, z) - terrainHeightMeters(x, z);
  margins.push(margin);
  const deficit = GROUND_FOOTING_BIAS_METERS - margin;
  if (deficit > worstDeficit) { worstDeficit = deficit; worstAt = `${x.toFixed(1)},${z.toFixed(1)}`; }
}
margins.sort((a, b) => a - b);
const pct = (f: number) => margins[Math.round(f * (margins.length - 1))]!.toFixed(4);
console.log('current bias        :', GROUND_FOOTING_BIAS_METERS);
console.log('margin min / p01 / p50:', pct(0), '/', pct(0.01), '/', pct(0.5));
console.log('sink below mesh count :', margins.filter((m) => m < 0).length, '/', margins.length);
console.log('worst interpolation deficit:', worstDeficit.toFixed(4), 'm at', worstAt);
console.log('bias needed to keep margin >= 0.05 everywhere:', (GROUND_FOOTING_BIAS_METERS + worstDeficit).toFixed(3));
