import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(fullPath)
      : entry.name.endsWith('.ts')
        ? [fullPath]
        : [];
  });
}

describe('simulation architecture boundary', () => {
  it('does not import rendering, network, database, wall-clock, or ambient randomness', () => {
    const simSource = join(process.cwd(), 'packages', 'sim', 'src');
    const forbidden = [
      /from ['"]three/,
      /from ['"]ws['"]/,
      /from ['"]node:/,
      /\bMath\.random\b/,
      /\bDate\.now\b/,
      /\bperformance\.now\b/,
      /\bdocument\b/,
      /\bwindow\b/,
    ];

    for (const file of sourceFiles(simSource)) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(source, `${file} contains ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
