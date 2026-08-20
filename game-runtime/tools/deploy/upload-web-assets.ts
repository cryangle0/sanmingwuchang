import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import OSS from 'ali-oss';
import {
  WEB_HERO_MODELS,
  WEB_MONSTER_MODELS,
  type WebModelDefinition,
} from '../../apps/web/src/render/models/web-model-catalog';

interface UploadItem {
  readonly key: string;
  readonly source: string | Buffer;
  readonly size: number;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly immutable: boolean;
}

interface UploadSummary {
  uploaded: number;
  skipped: number;
  bytesUploaded: number;
}

const root = resolve(import.meta.dirname, '..', '..');

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function objectKey(...segments: readonly string[]): string {
  return segments.map(trimSlashes).filter(Boolean).join('/');
}

function contentType(path: string): string {
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
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return files.flat();
}

async function webUploadItems(
  distDirectory: string,
  prefix: string,
): Promise<readonly UploadItem[]> {
  const files = await filesBelow(distDirectory);
  return Promise.all(
    files.map(async (path) => {
      const normalized = relative(distDirectory, path).split(sep).join('/');
      const fileStats = await stat(path);
      const isHtml = extname(path).toLowerCase() === '.html';
      const isHashedAsset =
        normalized.startsWith('assets/') && /-[A-Za-z0-9_-]{8,}\./.test(normalized);
      const isRuntimeAudio = normalized.startsWith('audio/runtime/');
      const isRuntimeAudioManifest = normalized === 'audio/runtime/audio-manifest.json';
      return {
        key: objectKey(prefix, normalized),
        source: path,
        size: fileStats.size,
        contentType: contentType(path),
        cacheControl: isHtml
          ? 'no-cache, max-age=0, must-revalidate'
          : isRuntimeAudioManifest
            ? 'no-cache, max-age=0, must-revalidate'
            : isRuntimeAudio
              ? 'public, max-age=31536000, immutable'
              : isHashedAsset
                ? 'public, max-age=31536000, immutable'
                : 'public, max-age=3600',
        immutable: false,
      };
    }),
  );
}

async function modelUploadItems(
  prefix: string,
  definitions: readonly WebModelDefinition[],
): Promise<readonly UploadItem[]> {
  const items: UploadItem[] = [];
  for (const definition of definitions) {
    if (definition.assetBase !== 'model-cdn' || definition.format !== 'fbx') {
      continue;
    }
    const sourceDirectory = resolve(
      root,
      'unity',
      'Assets',
      'ProceduralHeroes',
      'Characters',
      definition.sourceName,
    );
    const destinationDirectory = objectKey(
      prefix,
      definition.kind === 'hero' ? 'heroes' : 'monsters',
      definition.id,
    );
    const modelPath = join(sourceDirectory, `${definition.sourceName}.fbx`);
    const modelStats = await stat(modelPath);
    items.push({
      key: objectKey(destinationDirectory, 'model.fbx'),
      source: modelPath,
      size: modelStats.size,
      contentType: contentType(modelPath),
      cacheControl: 'public, max-age=31536000, immutable',
      immutable: true,
    });
    const textureDirectory = join(sourceDirectory, 'Textures');
    for (const texturePath of (await filesBelow(textureDirectory)).filter(
      (path) => extname(path).toLowerCase() === '.png',
    )) {
      const textureStats = await stat(texturePath);
      const textureName = relative(textureDirectory, texturePath).split(sep).join('/');
      items.push({
        key: objectKey(destinationDirectory, 'Textures', textureName),
        source: texturePath,
        size: textureStats.size,
        contentType: contentType(texturePath),
        cacheControl: 'public, max-age=31536000, immutable',
        immutable: true,
      });
    }
  }
  return items;
}

async function isCurrent(client: OSS, item: UploadItem): Promise<boolean> {
  if (!item.immutable) {
    return false;
  }
  try {
    const head = await client.head(item.key);
    return head.meta?.['jwgb-size'] === String(item.size);
  } catch {
    return false;
  }
}

async function uploadOne(client: OSS, item: UploadItem): Promise<'uploaded' | 'skipped'> {
  if (await isCurrent(client, item)) {
    return 'skipped';
  }
  await client.put(item.key, item.source, {
    mime: item.contentType,
    headers: {
      'Cache-Control': item.cacheControl,
      'x-oss-object-acl': 'public-read',
    },
    meta: {
      'jwgb-size': String(item.size),
    },
    timeout: 10 * 60 * 1_000,
  });
  return 'uploaded';
}

async function uploadItems(
  client: OSS,
  items: readonly UploadItem[],
  concurrency: number,
): Promise<UploadSummary> {
  const summary: UploadSummary = { uploaded: 0, skipped: 0, bytesUploaded: 0 };
  let nextIndex = 0;
  let completed = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (!item) {
        return;
      }
      const result = await uploadOne(client, item);
      if (result === 'uploaded') {
        summary.uploaded += 1;
        summary.bytesUploaded += item.size;
      } else {
        summary.skipped += 1;
      }
      completed += 1;
      if (completed % 10 === 0 || completed === items.length) {
        console.log(`OSS upload progress ${completed}/${items.length}`);
      }
    }
  });
  await Promise.all(workers);
  return summary;
}

async function ensureCors(client: OSS, bucket: string): Promise<void> {
  let existingRules: readonly {
    readonly allowedOrigin: string | readonly string[];
    readonly allowedMethod: string | readonly string[];
    readonly allowedHeader?: string | readonly string[];
    readonly exposeHeader?: string | readonly string[];
    readonly maxAgeSeconds?: string;
  }[] = [];
  try {
    existingRules = (await client.getBucketCORS(bucket)).rules;
  } catch (error) {
    const status = (error as { readonly status?: number }).status;
    if (status === 401 || status === 403) {
      console.warn('OSS CORS read skipped: credentials cannot inspect bucket configuration');
      return;
    }
    throw error;
  }

  const hasPublicRead = existingRules.some((rule) => {
    const origins = Array.isArray(rule.allowedOrigin) ? rule.allowedOrigin : [rule.allowedOrigin];
    const methods = Array.isArray(rule.allowedMethod) ? rule.allowedMethod : [rule.allowedMethod];
    return origins.includes('*') && methods.includes('GET') && methods.includes('HEAD');
  });
  if (hasPublicRead) {
    return;
  }
  try {
    await client.putBucketCORS(bucket, [
      ...existingRules,
      {
        allowedOrigin: '*',
        allowedMethod: ['GET', 'HEAD'],
        allowedHeader: '*',
        exposeHeader: ['ETag', 'Content-Length'],
        maxAgeSeconds: '86400',
      },
    ]);
  } catch (error) {
    const status = (error as { readonly status?: number }).status;
    if (status === 401 || status === 403) {
      console.warn('OSS CORS update skipped: credentials cannot modify bucket configuration');
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const accessKeyId = requiredEnvironment('OSS_ACCESS_KEY_ID');
  const accessKeySecret = requiredEnvironment('OSS_ACCESS_KEY_SECRET');
  const endpoint = requiredEnvironment('OSS_ENDPOINT');
  const bucket = requiredEnvironment('OSS_BUCKET_NAME');
  const basePath = requiredEnvironment('OSS_BASE_PATH');
  const releaseId =
    process.env.JWGB_RELEASE_ID?.trim() ??
    new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14);
  const distDirectory = resolve(
    process.env.JWGB_WEB_DIST?.trim() || join(root, 'apps', 'web', 'dist'),
  );
  const projectPrefix = objectKey(basePath, 'JourneyWestGreatBrawl');
  const currentPrefix = objectKey(projectPrefix, 'current');
  const releasePrefix = objectKey(projectPrefix, 'releases', releaseId);
  const modelPrefix = objectKey(projectPrefix, 'models', 'v1');
  const client = new OSS({
    accessKeyId,
    accessKeySecret,
    endpoint,
    bucket,
    secure: true,
    timeout: 10 * 60 * 1_000,
    retryMax: 4,
  });

  await ensureCors(client, bucket);

  const skipModels = process.argv.includes('--skip-models');
  if (!skipModels) {
    const models = await modelUploadItems(modelPrefix, [...WEB_HERO_MODELS, ...WEB_MONSTER_MODELS]);
    const catalog = Buffer.from(
      JSON.stringify(
        {
          schema: 'jwgb.web-model-catalog.v1',
          generatedAt: new Date().toISOString(),
          heroes: WEB_HERO_MODELS,
          monsters: WEB_MONSTER_MODELS,
        },
        null,
        2,
      ),
      'utf8',
    );
    const modelSummary = await uploadItems(
      client,
      [
        ...models,
        {
          key: objectKey(modelPrefix, 'catalog.json'),
          source: catalog,
          size: catalog.byteLength,
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'no-cache, max-age=0, must-revalidate',
          immutable: false,
        },
      ],
      4,
    );
    console.log(
      `OSS models uploaded=${modelSummary.uploaded} skipped=${modelSummary.skipped} bytes=${modelSummary.bytesUploaded}`,
    );
  }

  const releaseItems = await webUploadItems(distDirectory, releasePrefix);
  const currentItems = await webUploadItems(distDirectory, currentPrefix);
  const webSummary = await uploadItems(client, [...releaseItems, ...currentItems], 6);
  console.log(
    `OSS web uploaded=${webSummary.uploaded} skipped=${webSummary.skipped} bytes=${webSummary.bytesUploaded}`,
  );
  console.log(`Release ID ${releaseId}`);
  console.log(`Current prefix ${currentPrefix}`);
}

await main();
