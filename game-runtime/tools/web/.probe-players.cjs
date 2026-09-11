const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.JWGB_BROWSER_EXECUTABLE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:4181/?mode=local&active=MAP&hero=H009&spawn=-150,40', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__JWGB_DEBUG__?.getMapAssetDiagnostics?.()?.status === 'ready', undefined, { timeout: 180000 });
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const d = window.__JWGB_DEBUG__;
    const snap = d.getSnapshot();
    const camera = d.getCameraDiagnostics();
    const local = d.getLocalEntityId?.();
    return {
      local,
      cameraPos: camera.position,
      cameraTarget: camera.target,
      near: camera.near ?? null,
      far: camera.far ?? null,
      players: snap.players.map((p) => ({
        id: p.entityId ?? p.id,
        team: p.team,
        x: Math.round(p.position.x / 1000),
        z: Math.round(p.position.z / 1000),
        alive: p.alive,
      })),
      entityDiag: d.getRenderEntityDiagnostics(),
    };
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 2600));
  await browser.close();
})();
