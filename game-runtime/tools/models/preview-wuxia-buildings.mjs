/**
 * Renders a contact sheet of the procedural 百眼迷城 buildings so the family can
 * be reviewed without launching the game. Serves `apps/web/public` over a
 * throwaway localhost port, loads each GLB with the same meshopt decoder the
 * runtime uses, and writes `artifacts/buildings/preview.png`.
 *
 * Usage:
 *   node tools/models/preview-wuxia-buildings.mjs
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { build as buildBundle } from 'esbuild';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PUBLIC_DIR = resolve(ROOT, 'apps', 'web', 'public');
const ASSET_DIR = join(PUBLIC_DIR, 'models', 'map-assets');
const OUTPUT = resolve(
  ROOT,
  'artifacts',
  'buildings',
  process.env.JWGB_PREVIEW_OUTPUT ?? 'preview.png',
);
const COLUMNS = Number(process.env.JWGB_PREVIEW_COLUMNS ?? 5);
const CELL = Number(process.env.JWGB_PREVIEW_CELL ?? 46);
const WIDTH = 2000;
const HEIGHT = 1250;

const ENTRY = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

function label(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(8,16,20,0.85)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f0d68f';
  context.font = 'bold 52px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(9, 1.7, 1);
  return sprite;
}

window.renderPreview = async (ids) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(${WIDTH}, ${HEIGHT});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141d24);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a3326, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0cf, 2.4);
  sun.position.set(28, 46, 20);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fc6ff, 0.7);
  fill.position.set(-30, 24, -26);
  scene.add(fill);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const rows = Math.ceil(ids.length / ${COLUMNS});
  const heights = [];
  for (let index = 0; index < ids.length; index += 1) {
    const gltf = await loader.loadAsync('/models/map-assets/' + ids[index] + '.glb');
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = ${Number(process.env.JWGB_PREVIEW_FIT ?? 24)} / Math.max(size.y, 0.5);
    root.scale.setScalar(scale);
    const column = index % ${COLUMNS};
    const row = Math.floor(index / ${COLUMNS});
    const x = (column - (${COLUMNS} - 1) / 2) * ${CELL};
    const z = (row - (rows - 1) / 2) * ${CELL};
    root.position.set(x, 0, z);
    scene.add(root);
    heights.push(Number(size.y.toFixed(2)));
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(${CELL} * 0.82, 0.3, ${CELL} * 0.82),
      new THREE.MeshStandardMaterial({ color: 0x33413a, roughness: 0.95 }),
    );
    pad.position.set(x, -0.15, z);
    scene.add(pad);
    const tag = label(ids[index]);
    tag.position.set(x, ${Number(process.env.JWGB_PREVIEW_FIT ?? 24)} + 3.5, z);
    scene.add(tag);
  }

  // Auto-frame the whole grid so no building is clipped regardless of count.
  const grid = new THREE.Box3();
  for (const child of scene.children) {
    if (child.isSprite) continue;
    grid.expandByObject(child);
  }
  const centre = grid.getCenter(new THREE.Vector3());
  const sphere = grid.getBoundingSphere(new THREE.Sphere());
  const fov = 32;
  const camera = new THREE.PerspectiveCamera(fov, ${WIDTH} / ${HEIGHT}, 0.5, 900);
  const distance = (sphere.radius * 1.12) / Math.sin((fov * Math.PI) / 360);
  const direction = new THREE.Vector3(0, 0.62, 1).normalize();
  camera.position.copy(centre).addScaledVector(direction, distance);
  camera.lookAt(centre.x, centre.y * 0.55, centre.z);
  renderer.render(scene, camera);
  return heights;
};
window.__ready = true;
`;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function serve() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const filePath = join(PUBLIC_DIR, decodeURIComponent(url.pathname));
    writeFileSync('/tmp/last-request.txt', filePath);
    try {
      const body = readFileSync(filePath);
      response.writeHead(200, {
        'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

async function main() {
  const requested = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const ids =
    requested.length > 0
      ? requested
      : readFileSync(join(ASSET_DIR, 'manifest.json'), 'utf8')
          .match(/"id": "(tang-[a-z-]+)"/g)
          .map((match) => match.replace(/.*"id": "|"/g, ''));
  const server = await serve();
  const { port } = server.address();
  // The temporary entry must live inside the workspace so esbuild can resolve
  // `three` from the project's node_modules.
  const scratch = resolve(ROOT, 'artifacts', 'buildings');
  mkdirSync(scratch, { recursive: true });
  const bundlePath = join(scratch, `preview-${process.pid}.js`);
  const entryPath = join(scratch, `preview-${process.pid}.entry.js`);
  writeFileSync(entryPath, ENTRY);
  await buildBundle({
    entryPoints: [entryPath],
    bundle: true,
    format: 'iife',
    outfile: bundlePath,
    logLevel: 'warning',
  });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
    ...(process.env.JWGB_BROWSER_EXECUTABLE
      ? { executablePath: process.env.JWGB_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    page.on('pageerror', (error) => console.warn(`preview page error: ${String(error)}`));
    // Navigate to a real same-origin URL so relative asset paths resolve, then
    // clear the document so the screenshot only contains the render canvas.
    await page.goto(`http://127.0.0.1:${port}/models/map-assets/manifest.json`);
    await page.evaluate(() => {
      document.body.textContent = '';
      document.body.style.margin = '0';
      document.body.style.background = '#141d24';
    });
    await page.addScriptTag({ content: readFileSync(bundlePath, 'utf8') });
    await page.waitForFunction(() => window.__ready === true);
    const heights = await page.evaluate((list) => window.renderPreview(list), ids);
    mkdirSync(resolve(ROOT, 'artifacts', 'buildings'), { recursive: true });
    await page.screenshot({ path: OUTPUT });
    console.log(`rendered ${ids.length} buildings -> ${OUTPUT}`);
    console.log(ids.map((id, index) => `${id}=${heights[index]}m`).join('  '));
  } finally {
    await browser.close();
    server.close();
    rmSync(bundlePath, { force: true });
    rmSync(entryPath, { force: true });
  }
}

await main();
