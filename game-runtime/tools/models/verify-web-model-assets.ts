import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import {
  WEB_HERO_MODELS,
  WEB_MONSTER_MODELS,
  type WebModelDefinition,
} from '../../apps/web/src/render/models/web-model-catalog';

interface FileDigest {
  readonly bytes: number;
  readonly md5: string;
  readonly sha256: string;
}

interface RemoteAssetVerification {
  readonly id: string;
  readonly type: 'fbx' | 'glb' | 'texture';
  readonly localPath: string;
  readonly remoteUrl: string;
  readonly bytes: number;
  readonly status: number;
  readonly etag: string;
  readonly metadataSize: string;
  readonly matches: boolean;
}

interface SourceAssetVerification {
  readonly id: string;
  readonly type: 'fbx' | 'glb' | 'texture';
  readonly sourcePath: string;
  readonly projectPath: string;
  readonly bytes: number;
  readonly matches: boolean;
}

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const projectCharactersRoot = resolve(
  repositoryRoot,
  'unity',
  'Assets',
  'ProceduralHeroes',
  'Characters',
);
const heroSourceRoot = resolve(
  process.env.JWGB_HERO_MODEL_SOURCE ??
    'E:\\angsa\\angsa_data\\Games\\JourneyWestGreatBrawl\\Unity技术交付_38英雄_单体优化版\\Assets\\ProceduralHeroes\\Characters',
);
const monsterSourceRoot = resolve(
  process.env.JWGB_MONSTER_MODEL_SOURCE ??
    'E:\\angsa\\angsa_data\\Games\\JourneyWestGreatBrawl\\Unity技术交付_38野怪_单体优化版\\Assets\\ProceduralHeroes\\Characters',
);
const modelBaseUrl =
  process.env.JWGB_MODEL_BASE ??
  'https://vibe-files.aigcresearch.com/AIGame/JourneyWestGreatBrawl/models/v1/';
const reportPath = resolve(
  repositoryRoot,
  process.env.JWGB_MODEL_ASSET_REPORT ?? 'migration/reports/web/model-asset-verification.json',
);

function normalizedBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function remoteAssetUrl(...segments: readonly string[]): string {
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return new URL(encoded, normalizedBaseUrl(modelBaseUrl)).toString();
}

async function digestFile(path: string): Promise<FileDigest> {
  const fileStats = await stat(path);
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');
  await new Promise<void>((resolveStream, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      md5.update(chunk);
      sha256.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', resolveStream);
  });
  return {
    bytes: fileStats.size,
    md5: md5.digest('hex').toUpperCase(),
    sha256: sha256.digest('hex').toUpperCase(),
  };
}

async function fetchWithRetry(url: string, method: 'GET' | 'HEAD'): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        signal: AbortSignal.timeout(45_000),
      });
      if (response.ok || response.status < 500 || attempt === 5) {
        return response;
      }
      lastError = new Error(`${method} ${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, attempt * 500);
    });
  }
  throw lastError instanceof Error ? lastError : new Error(`${method} ${url} failed`);
}

async function pngFiles(directory: string): Promise<string[]> {
  const names = await readdir(directory);
  return names
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort((left, right) => left.localeCompare(right));
}

function sourceRoot(definition: WebModelDefinition): string {
  return definition.kind === 'hero' ? heroSourceRoot : monsterSourceRoot;
}

function remoteDirectory(definition: WebModelDefinition): readonly string[] {
  return [definition.kind === 'hero' ? 'heroes' : 'monsters', definition.id];
}

async function verifyDefinition(definition: WebModelDefinition): Promise<{
  readonly source: readonly SourceAssetVerification[];
  readonly remote: readonly RemoteAssetVerification[];
  readonly errors: readonly string[];
}> {
  const errors: string[] = [];
  const sourceRows: SourceAssetVerification[] = [];
  const remoteRows: RemoteAssetVerification[] = [];
  if (definition.assetBase === 'web') {
    const projectPath = resolve(repositoryRoot, 'apps', 'web', 'public', definition.assetPath);
    const digest = await digestFile(projectPath);
    const remoteUrl = new URL(
      definition.assetPath,
      normalizedBaseUrl(
        process.env.JWGB_CDN_BASE ??
          'https://vibe-files.aigcresearch.com/AIGame/JourneyWestGreatBrawl/current/',
      ),
    ).toString();
    sourceRows.push({
      id: definition.id,
      type: 'glb',
      sourcePath: relative(repositoryRoot, projectPath),
      projectPath: relative(repositoryRoot, projectPath),
      bytes: digest.bytes,
      matches: true,
    });
    const response = await fetchWithRetry(remoteUrl, 'HEAD');
    const remoteBytes = Number(response.headers.get('content-length') ?? 0);
    const matches = response.ok && remoteBytes === digest.bytes;
    remoteRows.push({
      id: definition.id,
      type: 'glb',
      localPath: relative(repositoryRoot, projectPath),
      remoteUrl,
      bytes: digest.bytes,
      status: response.status,
      etag: (response.headers.get('etag') ?? '').replaceAll('"', '').toUpperCase(),
      metadataSize: response.headers.get('x-oss-meta-jwgb-size') ?? '',
      matches,
    });
    if (!matches) {
      errors.push(`${definition.id}: deployed Web GLB differs from the project asset`);
    }
    return { source: sourceRows, remote: remoteRows, errors };
  }

  const sourceDirectory = join(sourceRoot(definition), definition.sourceName);
  const projectDirectory = join(projectCharactersRoot, definition.sourceName);
  const sourceFbx = join(sourceDirectory, `${definition.sourceName}.fbx`);
  const projectFbx = join(projectDirectory, `${definition.sourceName}.fbx`);
  const sourceFbxDigest = await digestFile(sourceFbx);
  const projectFbxDigest = await digestFile(projectFbx);
  const sourceFbxMatches =
    sourceFbxDigest.bytes === projectFbxDigest.bytes &&
    sourceFbxDigest.sha256 === projectFbxDigest.sha256;
  sourceRows.push({
    id: definition.id,
    type: 'fbx',
    sourcePath: relative(repositoryRoot, sourceFbx),
    projectPath: relative(repositoryRoot, projectFbx),
    bytes: projectFbxDigest.bytes,
    matches: sourceFbxMatches,
  });
  if (!sourceFbxMatches) {
    errors.push(`${definition.id}: project FBX differs from source`);
  }

  const sourceTextures = await pngFiles(join(sourceDirectory, 'Textures'));
  const projectTextures = await pngFiles(join(projectDirectory, 'Textures'));
  if (sourceTextures.join('\n') !== projectTextures.join('\n')) {
    errors.push(`${definition.id}: source and project texture names differ`);
  }
  for (const textureName of sourceTextures) {
    const sourceTexture = join(sourceDirectory, 'Textures', textureName);
    const projectTexture = join(projectDirectory, 'Textures', textureName);
    const sourceTextureDigest = await digestFile(sourceTexture);
    const projectTextureDigest = await digestFile(projectTexture);
    const textureMatches =
      sourceTextureDigest.bytes === projectTextureDigest.bytes &&
      sourceTextureDigest.sha256 === projectTextureDigest.sha256;
    sourceRows.push({
      id: definition.id,
      type: 'texture',
      sourcePath: relative(repositoryRoot, sourceTexture),
      projectPath: relative(repositoryRoot, projectTexture),
      bytes: projectTextureDigest.bytes,
      matches: textureMatches,
    });
    if (!textureMatches) {
      errors.push(`${definition.id}: ${textureName} differs from source`);
    }
  }

  const remoteItems = [
    {
      type: 'fbx' as const,
      path: projectFbx,
      digest: projectFbxDigest,
      url: remoteAssetUrl(...remoteDirectory(definition), 'model.fbx'),
    },
    ...(await Promise.all(
      projectTextures.map(async (textureName) => {
        const path = join(projectDirectory, 'Textures', textureName);
        return {
          type: 'texture' as const,
          path,
          digest: await digestFile(path),
          url: remoteAssetUrl(...remoteDirectory(definition), 'Textures', textureName),
        };
      }),
    )),
  ];
  for (const item of remoteItems) {
    const response = await fetchWithRetry(item.url, 'HEAD');
    const etag = (response.headers.get('etag') ?? '').replaceAll('"', '').toUpperCase();
    const metadataSize = response.headers.get('x-oss-meta-jwgb-size') ?? '';
    const remoteBytes = Number(response.headers.get('content-length') ?? 0);
    const matches =
      response.ok &&
      remoteBytes === item.digest.bytes &&
      metadataSize === String(item.digest.bytes) &&
      etag === item.digest.md5;
    remoteRows.push({
      id: definition.id,
      type: item.type,
      localPath: relative(repositoryRoot, item.path),
      remoteUrl: item.url,
      bytes: item.digest.bytes,
      status: response.status,
      etag,
      metadataSize,
      matches,
    });
    if (!matches) {
      errors.push(`${definition.id}: OSS object mismatch for ${basename(item.path)}`);
    }
  }

  return { source: sourceRows, remote: remoteRows, errors };
}

function comparableDefinition(definition: WebModelDefinition): WebModelDefinition {
  return {
    id: definition.id,
    sourceName: definition.sourceName,
    kind: definition.kind,
    height: definition.height,
    assetBase: definition.assetBase,
    format: definition.format,
    assetPath: definition.assetPath,
  };
}

async function main(): Promise<void> {
  const definitions = [...WEB_HERO_MODELS, ...WEB_MONSTER_MODELS];
  const sourceRows: SourceAssetVerification[] = [];
  const remoteRows: RemoteAssetVerification[] = [];
  const errors: string[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: 5 }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const definition = definitions[index];
      if (!definition) {
        return;
      }
      try {
        const verified = await verifyDefinition(definition);
        sourceRows.push(...verified.source);
        remoteRows.push(...verified.remote);
        errors.push(...verified.errors);
        console.log(`model assets ${index + 1}/${definitions.length}: ${definition.id}`);
      } catch (error) {
        errors.push(`${definition.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  await Promise.all(workers);

  const catalogResponse = await fetchWithRetry(remoteAssetUrl('catalog.json'), 'GET');
  const remoteCatalog = (await catalogResponse.json()) as {
    readonly schema?: string;
    readonly heroes?: readonly WebModelDefinition[];
    readonly monsters?: readonly WebModelDefinition[];
  };
  const expectedHeroes = WEB_HERO_MODELS.map(comparableDefinition);
  const expectedMonsters = WEB_MONSTER_MODELS.map(comparableDefinition);
  const catalogMatches =
    remoteCatalog.schema === 'jwgb.web-model-catalog.v1' &&
    JSON.stringify(remoteCatalog.heroes) === JSON.stringify(expectedHeroes) &&
    JSON.stringify(remoteCatalog.monsters) === JSON.stringify(expectedMonsters);
  if (!catalogMatches) {
    errors.push('remote web model catalog differs from the runtime catalog');
  }

  sourceRows.sort((left, right) => {
    return left.id.localeCompare(right.id) || left.projectPath.localeCompare(right.projectPath);
  });
  remoteRows.sort((left, right) => {
    return left.id.localeCompare(right.id) || left.localPath.localeCompare(right.localPath);
  });
  const report = {
    schema: 'jwgb.web-model-asset-verification.v1',
    generatedAt: new Date().toISOString(),
    projectCharactersRoot,
    heroSourceRoot,
    monsterSourceRoot,
    modelBaseUrl,
    summary: {
      heroCount: WEB_HERO_MODELS.length,
      monsterCount: WEB_MONSTER_MODELS.length,
      sourceAssetCount: sourceRows.length,
      sourceAssetsMatched: sourceRows.filter((row) => row.matches).length,
      remoteAssetCount: remoteRows.length,
      remoteAssetsMatched: remoteRows.filter((row) => row.matches).length,
      remoteCatalogMatched: catalogMatches,
      errorCount: errors.length,
    },
    sourceAssets: sourceRows,
    remoteAssets: remoteRows,
    errors,
    status: errors.length === 0 ? 'passed' : 'failed',
  };
  await mkdir(resolve(reportPath, '..'), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        status: report.status,
        reportPath,
        summary: report.summary,
      },
      null,
      2,
    ),
  );
  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

await main();
