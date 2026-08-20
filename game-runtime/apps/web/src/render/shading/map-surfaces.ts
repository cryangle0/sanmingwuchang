/**
 * The painted surface set for 百眼迷城, in 暗黑西游·水墨写意 direction.
 *
 * Each generator paints an albedo canvas and a matching height canvas, then
 * hands both to finishSurface, which derives the normal and roughness maps.
 * Painting is deterministic: the same seed always produces the same stone.
 *
 * Sizes stay at 512 so the whole set costs roughly 6 MB of VRAM after mipmaps,
 * which the Snapdragon 680 floor tolerates.
 */

import { createSequence } from './noise';
import {
  context2d,
  createCanvas,
  finishSurface,
  type PaintedSurface,
  paintBlobs,
  paintSpecks,
} from './texture-lab';

const SIZE = 512;

export interface MapSurfaceSet {
  /** Playfield floor: damp ink-stained flagstone and packed earth. */
  readonly ground: PaintedSurface;
  /** 封界级 boundary cliffs: hard stratified rock. */
  readonly cliff: PaintedSurface;
  /** 可越障级 interior walls: dressed masonry. */
  readonly masonry: PaintedSurface;
  /** Road ribbons: worn flagstone with cart ruts. */
  readonly road: PaintedSurface;
  /** 万劫三庭 floors: carved ceremonial stone. */
  readonly court: PaintedSurface;
  /** Dark old-growth timber with long grain and worn highlights. */
  readonly timber: PaintedSurface;
  /** Layered charcoal roof tiles with moss-softened joints. */
  readonly roof: PaintedSurface;
  dispose(): void;
}

function fill(context: CanvasRenderingContext2D, colour: string): void {
  context.fillStyle = colour;
  context.fillRect(0, 0, SIZE, SIZE);
}

function grey(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return `rgb(${clamped},${clamped},${clamped})`;
}

/** Ink wash: broad translucent strokes that read as damp stone at distance. */
function paintInkWash(context: CanvasRenderingContext2D, seed: number, alpha: number): void {
  const next = createSequence(seed);
  context.globalAlpha = alpha;
  for (let stroke = 0; stroke < 26; stroke += 1) {
    const x = next() * SIZE;
    const y = next() * SIZE;
    const width = SIZE * (0.18 + next() * 0.4);
    const height = SIZE * (0.03 + next() * 0.09);
    const angle = next() * Math.PI;
    const tone = 58 + next() * 52;
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    const gradient = context.createLinearGradient(-width / 2, 0, width / 2, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.5, `rgba(${tone},${tone + 4},${tone + 10},1)`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(-width / 2, -height / 2, width, height);
    context.restore();
  }
  context.globalAlpha = 1;
}

/** Draws a wrapped stone course grid with jittered joints. */
function paintCourses(
  context: CanvasRenderingContext2D,
  seed: number,
  options: {
    readonly rows: number;
    readonly joint: string;
    readonly jointWidth: number;
    readonly stone?: (sample: number) => string;
  },
): void {
  const next = createSequence(seed);
  const rowHeight = SIZE / options.rows;
  for (let row = 0; row < options.rows; row += 1) {
    const y = row * rowHeight;
    const offset = next() * rowHeight;
    let x = -offset;
    while (x < SIZE) {
      const width = rowHeight * (1.1 + next() * 1.9);
      if (options.stone) {
        context.fillStyle = options.stone(next());
        context.fillRect(
          x + options.jointWidth,
          y + options.jointWidth,
          width - options.jointWidth * 2,
          rowHeight - options.jointWidth * 2,
        );
      }
      context.strokeStyle = options.joint;
      context.lineWidth = options.jointWidth;
      context.strokeRect(x, y, width, rowHeight);
      x += width;
    }
  }
}

function buildGround(seed: number): PaintedSurface {
  const albedo = createCanvas(SIZE);
  const albedoContext = context2d(albedo);
  // Keep the texture comparatively light and neutral. District identity comes
  // from the vertex palette, while this layer supplies turf, dry soil and worn
  // paths without multiplying the whole field into one grey-green value.
  fill(albedoContext, '#a3a18a');
  paintInkWash(albedoContext, seed + 12, 0.045);
  paintSpecks(albedoContext, SIZE, {
    seed: seed + 13,
    count: 680,
    maxRadius: 1.05,
    colour: (sample) => `rgba(${66 + sample * 66},${70 + sample * 62},${48 + sample * 48},0.24)`,
  });

  const height = createCanvas(SIZE);
  const heightContext = context2d(height);
  fill(heightContext, grey(128));
  paintSpecks(heightContext, SIZE, {
    seed: seed + 13,
    count: 680,
    maxRadius: 1.05,
    colour: (sample) => grey(88 + sample * 110),
  });
  return finishSurface(albedo, height, {
    normalStrength: 1.5,
    roughness: 0.94,
    roughnessVariation: 0.16,
  });
}

function buildCliff(seed: number): PaintedSurface {
  const albedo = createCanvas(SIZE);
  const albedoContext = context2d(albedo);
  fill(albedoContext, '#605c54');
  // Horizontal strata make the terraced boundary cliffs read as bedrock.
  const next = createSequence(seed);
  for (let band = 0; band < 30; band += 1) {
    const y = (band / 30) * SIZE + next() * 5;
    const thickness = 3 + next() * 12;
    const tone = 64 + next() * 52;
    albedoContext.fillStyle = `rgba(${tone},${tone - 2},${tone - 6},0.65)`;
    albedoContext.fillRect(0, y, SIZE, thickness);
  }
  paintInkWash(albedoContext, seed + 21, 0.3);
  paintSpecks(albedoContext, SIZE, {
    seed: seed + 22,
    count: 900,
    maxRadius: 2.2,
    colour: (sample) => `rgba(${30 + sample * 40},${29 + sample * 38},${28 + sample * 34},0.6)`,
  });

  const height = createCanvas(SIZE);
  const heightContext = context2d(height);
  fill(heightContext, grey(120));
  const heightNext = createSequence(seed);
  for (let band = 0; band < 30; band += 1) {
    const y = (band / 30) * SIZE + heightNext() * 5;
    const thickness = 3 + heightNext() * 12;
    heightContext.fillStyle = grey(70 + heightNext() * 150);
    heightContext.fillRect(0, y, SIZE, thickness);
  }
  paintSpecks(heightContext, SIZE, {
    seed: seed + 22,
    count: 900,
    maxRadius: 2.2,
    colour: (sample) => grey(40 + sample * 180),
  });
  return finishSurface(albedo, height, {
    normalStrength: 6.5,
    roughness: 0.9,
    roughnessVariation: 0.2,
  });
}

function buildMasonry(seed: number): PaintedSurface {
  const albedo = createCanvas(SIZE);
  const albedoContext = context2d(albedo);
  fill(albedoContext, '#6f6656');
  paintCourses(albedoContext, seed + 31, {
    rows: 9,
    joint: 'rgba(38,34,28,0.85)',
    jointWidth: 3,
    stone: (sample) => `rgb(${100 + sample * 38},${92 + sample * 34},${76 + sample * 30})`,
  });
  paintInkWash(albedoContext, seed + 32, 0.18);
  paintSpecks(albedoContext, SIZE, {
    seed: seed + 33,
    count: 700,
    maxRadius: 1.6,
    colour: (sample) => `rgba(${64 + sample * 40},${58 + sample * 36},${48 + sample * 30},0.5)`,
  });

  const height = createCanvas(SIZE);
  const heightContext = context2d(height);
  fill(heightContext, grey(180));
  paintCourses(heightContext, seed + 31, {
    rows: 9,
    joint: 'rgba(24,24,24,1)',
    jointWidth: 3,
    stone: (sample) => grey(150 + sample * 90),
  });
  return finishSurface(albedo, height, {
    normalStrength: 5.4,
    roughness: 0.86,
    roughnessVariation: 0.18,
  });
}

function buildRoad(seed: number): PaintedSurface {
  const albedo = createCanvas(SIZE);
  const albedoContext = context2d(albedo);
  fill(albedoContext, '#77715f');
  const roadNext = createSequence(seed + 41);
  for (let band = 0; band < 42; band += 1) {
    const y = roadNext() * SIZE;
    const thickness = 0.8 + roadNext() * 4.2;
    const tone = 78 + roadNext() * 46;
    const alpha = 0.06 + roadNext() * 0.11;
    albedoContext.fillStyle = `rgba(${tone + 8},${tone + 4},${tone - 6},${alpha})`;
    albedoContext.fillRect(0, y, SIZE, thickness);
  }
  paintBlobs(albedoContext, SIZE, {
    seed: seed + 43,
    count: 52,
    minRadius: 3,
    maxRadius: 13,
    colour: (sample) => `rgba(${78 + sample * 42},${72 + sample * 38},${59 + sample * 30},0.12)`,
  });
  // Road UV +X follows the authored edge, so these ruts follow travel rather
  // than rotating arbitrarily with world-space planar UVs.
  const rutGradient = albedoContext.createLinearGradient(0, 0, 0, SIZE);
  rutGradient.addColorStop(0, 'rgba(40,36,30,0)');
  rutGradient.addColorStop(0.25, 'rgba(43,39,32,0.18)');
  rutGradient.addColorStop(0.34, 'rgba(43,39,32,0.07)');
  rutGradient.addColorStop(0.5, 'rgba(40,36,30,0)');
  rutGradient.addColorStop(0.66, 'rgba(43,39,32,0.07)');
  rutGradient.addColorStop(0.75, 'rgba(43,39,32,0.18)');
  rutGradient.addColorStop(1, 'rgba(40,36,30,0)');
  albedoContext.fillStyle = rutGradient;
  albedoContext.fillRect(0, 0, SIZE, SIZE);
  paintSpecks(albedoContext, SIZE, {
    seed: seed + 42,
    count: 1_450,
    maxRadius: 1.05,
    colour: (sample) => `rgba(${60 + sample * 72},${57 + sample * 66},${48 + sample * 54},0.34)`,
  });

  const height = createCanvas(SIZE);
  const heightContext = context2d(height);
  fill(heightContext, grey(142));
  const heightNext = createSequence(seed + 41);
  for (let band = 0; band < 42; band += 1) {
    const y = heightNext() * SIZE;
    const thickness = 0.8 + heightNext() * 4.2;
    const tone = 104 + heightNext() * 70;
    heightNext();
    heightContext.fillStyle = grey(tone);
    heightContext.fillRect(0, y, SIZE, thickness);
  }
  paintBlobs(heightContext, SIZE, {
    seed: seed + 43,
    count: 52,
    minRadius: 3,
    maxRadius: 13,
    colour: (sample) => grey(112 + sample * 72),
    alpha: 0.25,
  });
  paintSpecks(heightContext, SIZE, {
    seed: seed + 42,
    count: 1_450,
    maxRadius: 1.05,
    colour: (sample) => grey(82 + sample * 130),
  });
  return finishSurface(albedo, height, {
    normalStrength: 2.8,
    roughness: 0.96,
    roughnessVariation: 0.1,
  });
}

function buildCourt(seed: number): PaintedSurface {
  const albedo = createCanvas(SIZE);
  const albedoContext = context2d(albedo);
  fill(albedoContext, '#7a705a');
  paintCourses(albedoContext, seed + 51, {
    rows: 10,
    joint: 'rgba(52,44,30,0.5)',
    jointWidth: 2,
    stone: (sample) => `rgb(${128 + sample * 26},${116 + sample * 22},${92 + sample * 18})`,
  });
  paintInkWash(albedoContext, seed + 52, 0.1);

  const height = createCanvas(SIZE);
  const heightContext = context2d(height);
  fill(heightContext, grey(176));
  paintCourses(heightContext, seed + 51, {
    rows: 10,
    joint: 'rgba(60,60,60,1)',
    jointWidth: 2,
    stone: (sample) => grey(158 + sample * 74),
  });
  return finishSurface(albedo, height, {
    normalStrength: 3.4,
    roughness: 0.72,
    roughnessVariation: 0.22,
  });
}

function buildTimber(seed: number): PaintedSurface {
  const albedo = createCanvas(SIZE);
  const albedoContext = context2d(albedo);
  fill(albedoContext, '#6b4b34');
  const next = createSequence(seed + 61);
  for (let line = 0; line < 90; line += 1) {
    const x = next() * SIZE;
    const width = 1 + next() * 5;
    const tone = 38 + next() * 56;
    albedoContext.fillStyle = `rgba(${tone + 24},${tone + 8},${tone},${0.14 + next() * 0.24})`;
    albedoContext.fillRect(x, 0, width, SIZE);
  }
  for (let knot = 0; knot < 32; knot += 1) {
    const x = next() * SIZE;
    const y = next() * SIZE;
    const radius = 4 + next() * 14;
    albedoContext.strokeStyle = 'rgba(35,20,12,0.38)';
    albedoContext.lineWidth = 1.5 + next() * 2;
    albedoContext.beginPath();
    albedoContext.ellipse(x, y, radius, radius * 0.45, 0, 0, Math.PI * 2);
    albedoContext.stroke();
  }
  paintSpecks(albedoContext, SIZE, {
    seed: seed + 62,
    count: 800,
    maxRadius: 1.2,
    colour: (sample) => `rgba(${50 + sample * 75},${34 + sample * 52},${24 + sample * 40},0.3)`,
  });

  const height = createCanvas(SIZE);
  const heightContext = context2d(height);
  fill(heightContext, grey(132));
  const heightNext = createSequence(seed + 61);
  for (let line = 0; line < 90; line += 1) {
    const x = heightNext() * SIZE;
    const width = 1 + heightNext() * 5;
    heightContext.fillStyle = grey(84 + heightNext() * 104);
    heightContext.fillRect(x, 0, width, SIZE);
  }
  return finishSurface(albedo, height, {
    normalStrength: 3.1,
    roughness: 0.88,
    roughnessVariation: 0.16,
  });
}

function buildRoof(seed: number): PaintedSurface {
  const albedo = createCanvas(SIZE);
  const albedoContext = context2d(albedo);
  fill(albedoContext, '#526468');
  const rows = 12;
  const rowHeight = SIZE / rows;
  const next = createSequence(seed + 71);
  for (let row = 0; row < rows; row += 1) {
    const y = row * rowHeight;
    const offset = row % 2 === 0 ? 0 : rowHeight / 2;
    for (let x = -rowHeight; x < SIZE + rowHeight; x += rowHeight) {
      const shade = 72 + next() * 32;
      albedoContext.fillStyle = `rgb(${shade - 10},${shade},${shade + 6})`;
      albedoContext.beginPath();
      albedoContext.moveTo(x + offset, y);
      albedoContext.lineTo(x + offset, y + rowHeight * 0.74);
      albedoContext.quadraticCurveTo(
        x + offset + rowHeight / 2,
        y + rowHeight * 1.04,
        x + offset + rowHeight,
        y + rowHeight * 0.74,
      );
      albedoContext.lineTo(x + offset + rowHeight, y);
      albedoContext.closePath();
      albedoContext.fill();
      albedoContext.strokeStyle = 'rgba(155,174,168,0.3)';
      albedoContext.lineWidth = 1.2;
      albedoContext.stroke();
    }
    const shadow = albedoContext.createLinearGradient(0, y, 0, y + rowHeight * 0.3);
    shadow.addColorStop(0, 'rgba(16,25,27,0.38)');
    shadow.addColorStop(1, 'rgba(8,13,15,0)');
    albedoContext.fillStyle = shadow;
    albedoContext.fillRect(0, y, SIZE, rowHeight * 0.3);
  }
  paintSpecks(albedoContext, SIZE, {
    seed: seed + 72,
    count: 650,
    maxRadius: 1.3,
    colour: (sample) => (sample > 0.7 ? 'rgba(132,151,124,0.2)' : 'rgba(20,31,34,0.2)'),
  });

  const height = createCanvas(SIZE);
  const heightContext = context2d(height);
  fill(heightContext, grey(110));
  for (let row = 0; row < rows; row += 1) {
    const y = row * rowHeight;
    const gradient = heightContext.createLinearGradient(0, y, 0, y + rowHeight);
    gradient.addColorStop(0, grey(64));
    gradient.addColorStop(0.22, grey(186));
    gradient.addColorStop(0.78, grey(146));
    gradient.addColorStop(1, grey(74));
    heightContext.fillStyle = gradient;
    heightContext.fillRect(0, y, SIZE, rowHeight);
  }
  return finishSurface(albedo, height, {
    normalStrength: 4.2,
    roughness: 0.7,
    roughnessVariation: 0.2,
  });
}

/** Paints the whole set once. Seed comes from the compiled map geometry hash. */
export function createMapSurfaces(seed: number): MapSurfaceSet {
  const ground = buildGround(seed);
  const cliff = buildCliff(seed);
  const masonry = buildMasonry(seed);
  const road = buildRoad(seed);
  const court = buildCourt(seed);
  const timber = buildTimber(seed);
  const roof = buildRoof(seed);
  return {
    ground,
    cliff,
    masonry,
    road,
    court,
    timber,
    roof,
    dispose(): void {
      ground.dispose();
      cliff.dispose();
      masonry.dispose();
      road.dispose();
      court.dispose();
      timber.dispose();
      roof.dispose();
    },
  };
}
