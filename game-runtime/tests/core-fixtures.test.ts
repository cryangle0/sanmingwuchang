import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCoreFixtures } from '../tools/migration/core-fixtures';

describe('core golden fixtures', () => {
  it('matches the checked-in fixture artifact', () => {
    const fixturePath = resolve(process.cwd(), 'migration/fixtures/core-v1.json');
    const checkedIn = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

    expect(checkedIn).toEqual(buildCoreFixtures());
  });
});
