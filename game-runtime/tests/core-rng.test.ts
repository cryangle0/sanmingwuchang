import { SeededRng } from '@jwgb/core';

describe('SeededRng', () => {
  it('produces the same sequence for the same seed', () => {
    const left = new SeededRng(0x1234_5678);
    const right = new SeededRng(0x1234_5678);

    expect(Array.from({ length: 64 }, () => left.nextUint32())).toEqual(
      Array.from({ length: 64 }, () => right.nextUint32()),
    );
  });

  it('isolates named streams from parent consumption', () => {
    const firstRoot = new SeededRng(42);
    const firstSpawn = firstRoot.fork('spawn');
    firstRoot.nextUint32();
    firstRoot.nextUint32();

    const secondRoot = new SeededRng(42);
    const secondSpawn = secondRoot.fork('spawn');

    expect(Array.from({ length: 16 }, () => firstSpawn.nextUint32())).toEqual(
      Array.from({ length: 16 }, () => secondSpawn.nextUint32()),
    );
  });
});
