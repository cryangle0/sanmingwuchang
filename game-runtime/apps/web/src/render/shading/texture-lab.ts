/**
 * Canvas-based procedural texture primitives.
 *
 * The map ships no image assets: every surface is painted at boot from the
 * deterministic noise in ./noise, then converted to a tangent-space normal
 * map. That keeps the download tiny, keeps the look consistent, and lets the
 * 水墨 palette be retuned by editing numbers instead of re-exporting art.
 *
 * All generators paint with wrapped coordinates so the results tile seamlessly
 * across the 840m playfield.
 */

import * as THREE from 'three';
import { createSequence } from './noise';

export interface PaintedSurface {
  /** Base colour map, sRGB. */
  readonly albedo: THREE.CanvasTexture;
  /** Tangent-space normal map derived from the painted height field. */
  readonly normal: THREE.CanvasTexture;
  /** Linear roughness map; brighter is rougher. */
  readonly roughness: THREE.CanvasTexture;
  dispose(): void;
}

export function createCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('texture-lab: 2D canvas context unavailable');
  }
  return context;
}

/**
 * Draws once per wrap offset so any shape crossing an edge reappears on the
 * opposite side. Without this every blob would cut a visible seam.
 */
export function drawWrapped(
  _context: CanvasRenderingContext2D,
  size: number,
  draw: (offsetX: number, offsetY: number) => void,
): void {
  for (const offsetX of [-size, 0, size]) {
    for (const offsetY of [-size, 0, size]) {
      draw(offsetX, offsetY);
    }
  }
}

/** Fills the canvas with soft wrapped blobs; the workhorse for mottled stone. */
export function paintBlobs(
  context: CanvasRenderingContext2D,
  size: number,
  options: {
    readonly seed: number;
    readonly count: number;
    readonly minRadius: number;
    readonly maxRadius: number;
    readonly colour: (sample: number) => string;
    readonly alpha?: number;
  },
): void {
  const next = createSequence(options.seed);
  const alpha = options.alpha ?? 1;
  for (let index = 0; index < options.count; index += 1) {
    const x = next() * size;
    const y = next() * size;
    const radius = options.minRadius + next() * (options.maxRadius - options.minRadius);
    const fill = options.colour(next());
    drawWrapped(context, size, (offsetX, offsetY) => {
      const gradient = context.createRadialGradient(
        x + offsetX,
        y + offsetY,
        0,
        x + offsetX,
        y + offsetY,
        radius,
      );
      gradient.addColorStop(0, fill);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.globalAlpha = alpha;
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x + offsetX, y + offsetY, radius, 0, Math.PI * 2);
      context.fill();
    });
  }
  context.globalAlpha = 1;
}

/** Scatters hard specks; used for grit, sand and ink spatter. */
export function paintSpecks(
  context: CanvasRenderingContext2D,
  size: number,
  options: {
    readonly seed: number;
    readonly count: number;
    readonly maxRadius: number;
    readonly colour: (sample: number) => string;
  },
): void {
  const next = createSequence(options.seed);
  for (let index = 0; index < options.count; index += 1) {
    const x = next() * size;
    const y = next() * size;
    const radius = 0.4 + next() * options.maxRadius;
    context.fillStyle = options.colour(next());
    drawWrapped(context, size, (offsetX, offsetY) => {
      context.beginPath();
      context.arc(x + offsetX, y + offsetY, radius, 0, Math.PI * 2);
      context.fill();
    });
  }
}

/**
 * Converts a greyscale height canvas into a tangent-space normal map by
 * central differences, sampling with wrap so the normals tile as cleanly as
 * the albedo does.
 */
export function heightToNormal(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const size = height.width;
  const source = context2d(height).getImageData(0, 0, size, size).data;
  const target = createCanvas(size);
  const targetContext = context2d(target);
  const image = targetContext.createImageData(size, size);

  const sampleAt = (x: number, y: number): number => {
    const wrappedX = (x + size) % size;
    const wrappedY = (y + size) % size;
    return (source[(wrappedY * size + wrappedX) * 4] ?? 0) / 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (sampleAt(x + 1, y) - sampleAt(x - 1, y)) * strength;
      const dy = (sampleAt(x, y + 1) - sampleAt(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const offset = (y * size + x) * 4;
      image.data[offset] = ((-dx / length) * 0.5 + 0.5) * 255;
      image.data[offset + 1] = ((-dy / length) * 0.5 + 0.5) * 255;
      image.data[offset + 2] = (1 / length) * 0.5 * 255 + 127.5;
      image.data[offset + 3] = 255;
    }
  }
  targetContext.putImageData(image, 0, 0);
  return target;
}

/** Derives a roughness canvas from a height canvas: high ground reads polished. */
export function heightToRoughness(
  height: HTMLCanvasElement,
  base: number,
  variation: number,
): HTMLCanvasElement {
  const size = height.width;
  const source = context2d(height).getImageData(0, 0, size, size).data;
  const target = createCanvas(size);
  const targetContext = context2d(target);
  const image = targetContext.createImageData(size, size);
  for (let index = 0; index < size * size; index += 1) {
    const sample = (source[index * 4] ?? 0) / 255;
    const value = Math.max(0, Math.min(1, base + (sample - 0.5) * variation));
    const offset = index * 4;
    image.data[offset] = value * 255;
    image.data[offset + 1] = value * 255;
    image.data[offset + 2] = value * 255;
    image.data[offset + 3] = 255;
  }
  targetContext.putImageData(image, 0, 0);
  return target;
}

function toTexture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Packs an albedo canvas plus its height canvas into a ready PBR surface.
 * The height canvas is consumed here and not retained.
 */
export function finishSurface(
  albedo: HTMLCanvasElement,
  height: HTMLCanvasElement,
  options: {
    readonly normalStrength: number;
    readonly roughness: number;
    readonly roughnessVariation: number;
  },
): PaintedSurface {
  const albedoTexture = toTexture(albedo, THREE.SRGBColorSpace);
  const normalTexture = toTexture(
    heightToNormal(height, options.normalStrength),
    THREE.NoColorSpace,
  );
  const roughnessTexture = toTexture(
    heightToRoughness(height, options.roughness, options.roughnessVariation),
    THREE.NoColorSpace,
  );
  return {
    albedo: albedoTexture,
    normal: normalTexture,
    roughness: roughnessTexture,
    dispose(): void {
      albedoTexture.dispose();
      normalTexture.dispose();
      roughnessTexture.dispose();
    },
  };
}
