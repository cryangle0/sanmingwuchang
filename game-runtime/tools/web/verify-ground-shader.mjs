// Shader acceptance for the ground material.
// A material whose GLSL fails to compile takes the whole terrain with it, and
// three reports that only on the console, so this loads the map and fails on
// any WebGL program error.
// Usage: node tools/web/verify-ground-shader.mjs [url]
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5182/?mode=local&active=MAP';
const executablePath = join(
  process.env.LOCALAPPDATA,
  'ms-playwright',
  'chromium-1217',
  'chrome-win64',
  'chrome.exe',
);

const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error' || /shader|program|glsl/i.test(text)) {
    problems.push(`[${message.type()}] ${text.slice(0, 400)}`);
  }
});
page.on('pageerror', (error) => problems.push(`[pageerror] ${String(error).slice(0, 400)}`));

await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
await page.waitForTimeout(25_000);

const shot = 'artifacts/ground-shader-check.png';
await page.screenshot({ path: shot });
await browser.close();

const shaderProblems = problems.filter((line) => /shader|program|glsl/i.test(line));
console.log(`console errors: ${problems.length}, shader-related: ${shaderProblems.length}`);
for (const line of problems.slice(0, 12)) {
  console.log('  ' + line);
}
console.log(`screenshot: ${shot}`);
process.exit(shaderProblems.length > 0 ? 1 : 0);
