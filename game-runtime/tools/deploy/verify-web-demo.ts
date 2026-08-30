import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { RULESET_VERSION } from '../../packages/content/src';
import { playerId } from '../../packages/core/src';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '../../packages/protocol/src';

const clientCodec = new JsonMessageCodec<ClientMessage>([
  'matchmaking-enqueue',
  'matchmaking-select',
  'join',
  'snapshot-ack',
]);
const serverCodec = new JsonMessageCodec<ServerMessage>([
  'matchmaking-queued',
  'matchmaking-selection',
  'matchmaking-assigned',
  'matchmaking-cancelled',
  'joined',
  'snapshot',
  'events',
  'pong',
  'transaction-result',
  'error',
]);
const HTTP_ATTEMPTS = 4;
const HTTP_TIMEOUT_MS = 20_000;

interface HealthPayload {
  readonly ok?: boolean;
  readonly diagnostics?: {
    readonly mode?: string;
    readonly authoritativePlayerCount?: number;
    readonly maximumAuthoritativeMonsterCount?: number;
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requiredUrl(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

async function assertHttp(
  name: string,
  url: string,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= HTTP_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (response.ok) {
        console.log(`${name}: ${response.status}`);
        return response;
      }
      if (response.status < 500 || attempt === HTTP_ATTEMPTS) {
        throw new Error(`${name} returned HTTP ${response.status}: ${url}`);
      }
      lastError = new Error(`${name} returned HTTP ${response.status}: ${url}`);
    } catch (error) {
      lastError = error;
      if (attempt === HTTP_ATTEMPTS) {
        break;
      }
    }
    await delay(attempt * 1_000);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${name} failed after ${HTTP_ATTEMPTS} attempts: ${url}`);
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: ServerMessage) => boolean,
  timeoutMs: number,
): Promise<ServerMessage> {
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (data: Buffer): void => {
      const message = serverCodec.decode(new Uint8Array(data));
      if (predicate(message)) {
        cleanup();
        resolveMessage(message);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

async function verifySocket(url: string, healthUrl: string): Promise<Record<string, unknown>> {
  const matchmakingSocket = new WebSocket(url);
  await new Promise<void>((resolveOpen, reject) => {
    matchmakingSocket.once('open', () => resolveOpen());
    matchmakingSocket.once('error', reject);
  });
  const player = playerId(`verify-${randomUUID().slice(0, 12)}`);
  const queuedPromise = waitForMessage(
    matchmakingSocket,
    (message) => message.type === 'matchmaking-queued',
    10_000,
  );
  const selectionPromise = waitForMessage(
    matchmakingSocket,
    (message) => message.type === 'matchmaking-selection',
    20_000,
  );
  matchmakingSocket.send(
    clientCodec.encode({
      type: 'matchmaking-enqueue',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: player,
    }),
  );
  await queuedPromise;
  const selection = await selectionPromise;
  if (selection.type !== 'matchmaking-selection') {
    throw new Error('WebSocket did not complete matchmaking selection');
  }
  const selectedHero = selection.recommendedHeroId ?? selection.offers[0];
  if (!selectedHero) {
    throw new Error('matchmaking selection did not offer a hero');
  }
  const assignedPromise = waitForMessage(
    matchmakingSocket,
    (message) => message.type === 'matchmaking-assigned',
    20_000,
  );
  matchmakingSocket.send(
    clientCodec.encode({
      type: 'matchmaking-select',
      protocolVersion: PROTOCOL_VERSION,
      matchId: selection.matchId,
      heroId: selectedHero,
    }),
  );
  const assigned = await assignedPromise;
  if (assigned.type !== 'matchmaking-assigned') {
    throw new Error('WebSocket did not receive a match ticket');
  }
  matchmakingSocket.close();

  const socket = new WebSocket(url);
  await new Promise<void>((resolveOpen, reject) => {
    socket.once('open', () => resolveOpen());
    socket.once('error', reject);
  });
  const joinedPromise = waitForMessage(socket, (message) => message.type === 'joined', 10_000);
  const snapshotPromise = waitForMessage(
    socket,
    (message) => message.type === 'snapshot' && message.snapshot.players.length > 0,
    45_000,
  );
  socket.send(
    clientCodec.encode({
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: player,
      heroId: assigned.heroId,
      matchTicket: assigned.matchTicket,
    }),
  );
  const joined = await joinedPromise;
  const snapshot = await snapshotPromise;
  if (joined.type !== 'joined' || snapshot.type !== 'snapshot') {
    throw new Error('WebSocket did not complete join and snapshot');
  }
  socket.send(
    clientCodec.encode({
      type: 'snapshot-ack',
      protocolVersion: PROTOCOL_VERSION,
      snapshotTick: snapshot.snapshot.tick,
      stateHash: snapshot.snapshot.stateHash,
    }),
  );
  const healthResponse = await assertHttp('health', healthUrl);
  const health = (await healthResponse.json()) as HealthPayload;
  const healthDiagnostics = health.diagnostics;
  socket.close();
  const result = {
    joined: true,
    matchmaking: {
      matchId: assigned.matchId,
      heroId: assigned.heroId,
      roomId: assigned.roomId,
    },
    snapshotTick: snapshot.snapshot.tick,
    stateHash: snapshot.snapshot.stateHash,
    visiblePlayerCount: snapshot.snapshot.players.length,
    visibleMonsterCount: snapshot.snapshot.monsters.length,
    healthDiagnostics,
  };
  if (
    !result.stateHash ||
    result.visiblePlayerCount < 1 ||
    !health.ok ||
    !healthDiagnostics ||
    (healthDiagnostics.authoritativePlayerCount ?? 0) < 1 ||
    (healthDiagnostics.maximumAuthoritativeMonsterCount ?? 0) < 123
  ) {
    throw new Error(`invalid authoritative snapshot: ${JSON.stringify(result)}`);
  }
  console.log(`WSS join: ${JSON.stringify(result)}`);
  return result;
}

async function main(): Promise<void> {
  const webUrl = requiredUrl('JWGB_WEB_URL', 'https://fanavatar.org/');
  const wsUrl = requiredUrl(
    'JWGB_WS_URL',
    `${new URL(webUrl).origin.replace(/^http/, 'ws')}/match`,
  );
  const healthUrl = requiredUrl('JWGB_HEALTH_URL', new URL('/health', webUrl).toString());
  const cdnBase = requiredUrl(
    'JWGB_CDN_BASE',
    'https://vibe-files.aigcresearch.com/AIGame/JourneyWestGreatBrawl/current/',
  );
  const modelBase = requiredUrl(
    'JWGB_MODEL_BASE',
    'https://vibe-files.aigcresearch.com/AIGame/JourneyWestGreatBrawl/models/v1/',
  );

  const page = await assertHttp('web page', webUrl);
  const html = await page.text();
  const assetCandidates = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value, webUrl).toString())
    .filter((value) => value.endsWith('.js') || value.endsWith('.css'));
  for (const [index, assetUrl] of assetCandidates.entries()) {
    await assertHttp(`web asset ${index + 1}`, assetUrl, 'HEAD');
  }

  const animatedHeroes = [
    ['红孩儿（火娃模型）', 'H002'],
    ['蝎子精', 'H004'],
    ['九头虫', 'H006'],
    ['黄风怪', 'H007'],
    ['太上老君', 'H008'],
    ['孙悟空', 'H009'],
    ['二郎神', 'H010'],
    ['哪吒', 'H011'],
    ['六耳猕猴', 'H012'],
    ['白骨精', 'H014'],
    ['猪八戒', 'H015'],
    ['白龙马（小白龙模型）', 'H016'],
    ['牛魔王', 'H018'],
    ['独角兕大王', 'H019'],
    ['黄袍怪', 'H023'],
    ['托塔李天王', 'H031'],
    ['沙和尚', 'H033'],
    ['黑熊精', 'H034'],
    ['赛太岁', 'H038'],
  ] as const;
  for (const [name, id] of animatedHeroes) {
    await assertHttp(
      `animated ${name} GLB`,
      new URL(`models/characters/${id}/model.glb`, cdnBase).toString(),
      'HEAD',
    );
  }
  await assertHttp('legacy hero FBX', `${modelBase}heroes/H017/model.fbx`, 'HEAD');
  await assertHttp('monster model', `${modelBase}monsters/M027/model.fbx`, 'HEAD');
  const packagedMapAssets = [
    ['wuxia landmark', 'models/map-assets/wuxia-gate-court.glb'],
    ['lowpoly village', 'models/map-assets/lowpoly-asian-village.glb'],
    ['poly nature foliage', 'models/foliage/burdock-poly.glb'],
    ['C1524 rock', 'models/map-assets/desert-rock-01.glb'],
    ['free pagoda', 'models/map-assets/free-pagoda-niko313.glb'],
    ['free ruin pagoda', 'models/map-assets/free-pagoda-ruin.glb'],
    ['free stone cart', 'models/map-assets/free-stone-cart.glb'],
    ['free stone lion', 'models/map-assets/free-stone-lion.glb'],
    ['global scene manifest', 'models/global-scenes/manifest.json'],
    ['overgrown grove', 'models/global-scenes/overgrown-grove.glb'],
    ['overgrown card A', 'models/global-scenes/overgrown-card-a.glb'],
    ['overgrown card B', 'models/global-scenes/overgrown-card-b.glb'],
    ['forest road tree A', 'models/global-scenes/forest-road-tree-a.glb'],
    ['forest road tree B', 'models/global-scenes/forest-road-tree-b.glb'],
    ['forest road understory', 'models/global-scenes/forest-road-understory.glb'],
    ['forest mountains card A', 'models/global-scenes/forest-mountains-card-a.glb'],
    ['forest mountains card B', 'models/global-scenes/forest-mountains-card-b.glb'],
    ['forest mountains card C', 'models/global-scenes/forest-mountains-card-c.glb'],
    ['forest mountains ridge A', 'models/global-scenes/forest-mountains-ridge-a.glb'],
    ['forest mountains ridge B', 'models/global-scenes/forest-mountains-ridge-b.glb'],
  ] as const;
  for (const [name, path] of packagedMapAssets) {
    await assertHttp(name, new URL(path, cdnBase).toString(), 'HEAD');
  }
  await assertHttp(
    'same-origin hero portrait',
    `${new URL('/jwgb-assets/assets/heroes/H009.webp', webUrl).toString()}`,
    'HEAD',
  );
  const socketResult = await verifySocket(wsUrl, healthUrl);

  const report = {
    schema: 'jwgb.web-production-verification.v1',
    verifiedAt: new Date().toISOString(),
    webUrl,
    wsUrl,
    healthUrl,
    cdnBase,
    modelBase,
    assetCount: assetCandidates.length,
    packagedMapAssetCount: packagedMapAssets.length,
    socket: socketResult,
  };
  const reportPath = resolve(
    process.env.JWGB_WEB_REPORT?.trim() || 'migration/reports/web/production-verification.json',
  );
  await mkdir(resolve(reportPath, '..'), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`verification report: ${reportPath}`);
}

await main();
