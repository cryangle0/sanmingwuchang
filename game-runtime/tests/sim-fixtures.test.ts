import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSimFixtures } from '../tools/migration/sim-fixtures';

describe('simulation golden fixtures', () => {
  it('matches the checked-in fixture artifact', () => {
    const fixturePath = resolve(process.cwd(), 'migration/fixtures/sim-v1.json');
    const checkedIn = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

    expect(checkedIn).toEqual(buildSimFixtures());
  }, 120_000);
});
