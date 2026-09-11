import * as THREE from 'three';

/**
 * Floating combat text: damage, critical hits, heals and shield absorbs,
 * drawn as DOM over the canvas and projected from world anchors each frame.
 *
 * Numbers are the fastest way a player learns what their build is doing, and
 * the runtime had none: a hit was a small glow and a health bar moving. A DOM
 * layer costs nothing in the WebGL frame, keeps the "no Three.js Sprite" gate
 * intact, and gives crisp text with a stroke at any pixel ratio. Entries are
 * pooled and capped so a 30-player brawl cannot flood the page with spans.
 */

export type CombatTextKind = 'damage' | 'critical' | 'heal' | 'shield' | 'local-damage';

export interface CombatTextEntry {
  readonly kind: CombatTextKind;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface ActiveText {
  readonly entry: CombatTextEntry;
  readonly element: HTMLSpanElement;
  readonly bornAt: number;
  readonly duration: number;
  readonly driftX: number;
  readonly rise: number;
}

const MAX_ACTIVE = 48;
const DURATION_SECONDS: Readonly<Record<CombatTextKind, number>> = {
  damage: 0.85,
  critical: 1.1,
  heal: 0.95,
  shield: 0.85,
  'local-damage': 1.0,
};

export class CombatTextLayer {
  private readonly host: HTMLDivElement;
  private readonly pool: HTMLSpanElement[] = [];
  private readonly active: ActiveText[] = [];
  private readonly projected = new THREE.Vector3();
  private sequence = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.host = document.createElement('div');
    this.host.className = 'combat-text-layer';
    this.host.setAttribute('aria-hidden', 'true');
    canvas.insertAdjacentElement('afterend', this.host);
  }

  push(entry: CombatTextEntry, nowSeconds: number): void {
    while (this.active.length >= MAX_ACTIVE) {
      const oldest = this.active.shift();
      if (oldest) {
        this.recycle(oldest.element);
      }
    }
    const element = this.pool.pop() ?? document.createElement('span');
    element.className = `combat-text is-${entry.kind}`;
    element.textContent = entry.text;
    element.style.opacity = '0';
    this.host.append(element);
    this.sequence += 1;
    // Alternate the drift so stacked hits on one target fan out instead of
    // landing on top of each other.
    const side = this.sequence % 2 === 0 ? 1 : -1;
    this.active.push({
      entry,
      element,
      bornAt: nowSeconds,
      duration: DURATION_SECONDS[entry.kind],
      driftX: side * (18 + (this.sequence % 3) * 9),
      rise: entry.kind === 'critical' ? 96 : 72,
    });
  }

  update(camera: THREE.Camera, nowSeconds: number): void {
    if (this.active.length === 0) {
      return;
    }
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const text = this.active[index] as ActiveText;
      const t = (nowSeconds - text.bornAt) / text.duration;
      if (t >= 1) {
        this.active.splice(index, 1);
        this.recycle(text.element);
        continue;
      }
      this.projected.set(text.entry.x, text.entry.y, text.entry.z).project(camera);
      if (
        this.projected.z > 1 ||
        Math.abs(this.projected.x) > 1.2 ||
        Math.abs(this.projected.y) > 1.2
      ) {
        text.element.style.opacity = '0';
        continue;
      }
      // Pop in, hang, then float away and fade.
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.6 : 1.2 - Math.min(0.2, (t - 0.12) * 0.6);
      const rise = (1 - (1 - t) ** 2) * text.rise;
      const drift = t * text.driftX;
      const fade = t < 0.62 ? 1 : 1 - (t - 0.62) / 0.38;
      const px = ((this.projected.x + 1) / 2) * width + drift;
      const py = ((1 - this.projected.y) / 2) * height - rise;
      text.element.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      text.element.style.opacity = fade.toFixed(3);
    }
  }

  clear(): void {
    for (const text of this.active) {
      this.recycle(text.element);
    }
    this.active.length = 0;
  }

  dispose(): void {
    this.clear();
    this.pool.length = 0;
    this.host.remove();
  }

  private recycle(element: HTMLSpanElement): void {
    element.remove();
    element.style.opacity = '0';
    if (this.pool.length < MAX_ACTIVE) {
      this.pool.push(element);
    }
  }
}

/** Compact number formatting for the text: 1234 -> 1234, 12345 -> 1.2万. */
export function formatCombatNumber(value: number): string {
  const rounded = Math.round(Math.abs(value));
  if (rounded >= 10_000) {
    return `${(rounded / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
  }
  return String(rounded);
}
