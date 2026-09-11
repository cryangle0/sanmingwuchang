#!/usr/bin/env node
/**
 * Standalone uploader for the built Web dist.
 *
 * Mirrors the `dist` half of tools/deploy/upload-web-assets.ts (same keys,
 * content types and cache rules) without importing the TypeScript workspace, so
 * it can run anywhere `ali-oss` is installed — including on the game server as
 * a relay when the deploying machine cannot reach Aliyun OSS directly.
 *
 * Usage: OSS_* env vars set, then `node oss-upload-dist.mjs <distDir> <releaseId>`.
 */
import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OSS = require('ali-oss');

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const trimSlashes = (value) => value.replace(/^\/+|\/+$/g, '');
const objectKey = (...segments) => segments.map(trimSlashes).filter(Boolean).join('/');

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.webp':
      return 'image/webp';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    case '.svg':
      return 'image/svg+xml';
    case '.fbx':
      return 'application/octet-stream';
    case '.glb':
      return 'model/gltf-binary';
    case '.wasm':
      return 'application/wasm';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return files.flat();
}

async function uploadItems(distDirectory, prefix) {
  const files = await filesBelow(distDirectory);
  return Promise.all(
    files.map(async (path) => {
      const normalized = relative(distDirectory, path).split(sep).join('/');
      const size = (await stat(path)).size;
      const isHtml = extname(path).toLowerCase() === '.html';
      const isHashedAsset =
        normalized.startsWith('assets/') && /-[A-Za-z0-9_-]{8,}\./.test(normalized);
      const isRuntimeAudio = normalized.startsWith('audio/runtime/');
      const isRuntimeAudioManifest = normalized === 'audio/runtime/audio-manifest.json';
      return {
        key: objectKey(prefix, normalized),
        source: path,
        size,
        contentType: contentType(path),
        cacheControl:
          isHtml || isRuntimeAudioManifest
            ? 'no-cache, max-age=0, must-revalidate'
            : isRuntimeAudio || isHashedAsset
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600',
      };
    }),
  );
}

async function uploadAll(client, items, concurrency) {
  let nextIndex = 0;
  let completed = 0;
  let bytes = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const item = items[nextIndex++];
      if (!item) {
        return;
      }
      await client.put(item.key, item.source, {
        mime: item.contentType,
        headers: { 'Cache-Control': item.cacheControl, 'x-oss-object-acl': 'public-read' },
        meta: { 'jwgb-size': String(item.size) },
        timeout: 10 * 60 * 1000,
      });
      bytes += item.size;
      completed += 1;
      if (completed % 25 === 0 || completed === items.length) {
        console.log(`OSS upload progress ${completed}/${items.length}`);
      }
    }
  });
  await Promise.all(workers);
  return { uploaded: completed, bytes };
}

async function main() {
  const [distArgument, releaseArgument] = process.argv.slice(2);
  if (!distArgument) {
    throw new Error('usage: oss-upload-dist.mjs <distDir> [releaseId]');
  }
  const distDirectory = resolve(distArgument);
  const releaseId =
    releaseArgument?.trim() ||
    process.env.JWGB_RELEASE_ID?.trim() ||
    new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14);
  const client = new OSS({
    accessKeyId: requiredEnvironment('OSS_ACCESS_KEY_ID'),
    accessKeySecret: requiredEnvironment('OSS_ACCESS_KEY_SECRET'),
    endpoint: requiredEnvironment('OSS_ENDPOINT'),
    bucket: requiredEnvironment('OSS_BUCKET_NAME'),
    secure: true,
    timeout: 10 * 60 * 1000,
    retryMax: 4,
  });
  const projectPrefix = objectKey(requiredEnvironment('OSS_BASE_PATH'), 'JourneyWestGreatBrawl');
  const releasePrefix = objectKey(projectPrefix, 'releases', releaseId);
  const currentPrefix = objectKey(projectPrefix, 'current');
  // Release first, then current: if the run dies midway the live prefix is
  // still the previous complete build.
  const release = await uploadAll(client, await uploadItems(distDirectory, releasePrefix), 6);
  console.log(`OSS release uploaded=${release.uploaded} bytes=${release.bytes}`);
  const current = await uploadAll(client, await uploadItems(distDirectory, currentPrefix), 6);
  console.log(`OSS current uploaded=${current.uploaded} bytes=${current.bytes}`);
  console.log(`Release ID ${releaseId}`);
  console.log(`Current prefix ${currentPrefix}`);
}

await main();
