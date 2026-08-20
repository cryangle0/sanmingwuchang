import * as THREE from 'three';

/**
 * Seeded mottled ground texture so the huge boundary polygon does not read
 * as one flat color. Deterministic: same seed, same pixels.
 */
export function createGroundTexture(seed: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('ground texture 2d context unavailable');
  }

  let state = seed >>> 0 || 1;
  const nextRandom = (): number => {
    // xorshift32; render-only determinism, never used by the sim.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };

  context.fillStyle = '#42503f';
  context.fillRect(0, 0, size, size);

  const blotchColors = ['#3c4a3a', '#475442', '#39463c', '#4c5844'];
  for (let index = 0; index < 240; index += 1) {
    const color = blotchColors[Math.floor(nextRandom() * blotchColors.length)] ?? '#42503f';
    context.fillStyle = color;
    context.globalAlpha = 0.25 + nextRandom() * 0.3;
    const radius = 8 + nextRandom() * 42;
    context.beginPath();
    context.arc(nextRandom() * size, nextRandom() * size, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.globalAlpha = 0.5;
  for (let index = 0; index < 900; index += 1) {
    context.fillStyle = nextRandom() > 0.5 ? '#35412f' : '#51604b';
    const speck = 1 + nextRandom() * 2.4;
    context.fillRect(nextRandom() * size, nextRandom() * size, speck, speck);
  }
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
