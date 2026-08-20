import { assertSafeInteger, invariant } from './assert';

const NON_ZERO_FALLBACK_SEED = 0x6d2b_79f5;

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb_352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846c_a68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

export function hashString32(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

export class SeededRng {
  readonly initialSeed: number;
  private state: number;

  constructor(seed: number) {
    assertSafeInteger(seed, 'seed');
    this.initialSeed = seed >>> 0 || NON_ZERO_FALLBACK_SEED;
    this.state = this.initialSeed;
  }

  nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  nextInt(maximumExclusive: number): number {
    assertSafeInteger(maximumExclusive, 'maximumExclusive');
    invariant(maximumExclusive > 0 && maximumExclusive <= 0x1_0000_0000, 'invalid range');

    const limit = Math.floor(0x1_0000_0000 / maximumExclusive) * maximumExclusive;
    let value = this.nextUint32();
    while (value >= limit) {
      value = this.nextUint32();
    }
    return value % maximumExclusive;
  }

  nextBoolean(numerator = 1, denominator = 2): boolean {
    assertSafeInteger(numerator, 'numerator');
    assertSafeInteger(denominator, 'denominator');
    invariant(denominator > 0, 'denominator must be positive');
    invariant(numerator >= 0 && numerator <= denominator, 'invalid probability');
    return this.nextInt(denominator) < numerator;
  }

  fork(streamName: string): SeededRng {
    const streamSeed = mix32(this.initialSeed ^ hashString32(streamName));
    return new SeededRng(streamSeed);
  }

  snapshot(): number {
    return this.state;
  }
}
