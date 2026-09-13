import { chromium } from 'playwright-core';
const heroes = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'], executablePath: process.env.JWGB_BROWSER_EXECUTABLE });
const out = [];
for (const hero of heroes) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem('jwgb:web-settings:v1', JSON.stringify({ graphicsPreference: 'quality', cameraView: 'standard', showPerformance: false, masterVolume: 0, musicVolume: 0, sfxVolume: 0, uiVolume: 0 })); } catch {} });
  await page.goto(`http://127.0.0.1:4181/?mode=local&active=MAP&hero=${hero}&spawn=274,-105`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__JWGB_DEBUG__?.getSnapshot?.()?.players?.length > 0, undefined, { timeout: 120000 });
  await page.waitForTimeout(4000);
  let got = null;
  for (let i = 0; i < 20 && !got; i++) {
    await page.mouse.click(720, 470, { button: 'left' }).catch(() => {});
    await page.mouse.click(720, 470, { button: 'right' }).catch(() => {});
    await page.waitForTimeout(150);
    const d = await page.evaluate(() => window.__JWGB_DEBUG__.getCombatEffectDiagnostics());
    if (d.heroSkillCastsSpawned > 0 || d.activeCastEffectsSpawned > 0) { await page.waitForTimeout(260); await page.screenshot({ path: `artifacts/quality/skill-${hero}.png` }); got = true; }
  }
  out.push([hero, got]); await page.close();
}
console.log(JSON.stringify(out));
await browser.close();
