import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AUTHORITATIVE_MAP_STATIC_SOLIDS, HERO_IDS, RULESET_VERSION } from '@jwgb/content';
import { playerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@jwgb/protocol';
import { WebSocket } from 'ws';
import { createGameServer } from '../../apps/server/src/network/game-server';

const clientCodec = new JsonMessageCodec<ClientMessage>(['join', 'input']);
const serverCodec = new JsonMessageCodec<ServerMessage>([
  'joined',
  'snapshot',
  'events',
  'pong',
  'transaction-result',
  'error',
]);
const SAMPLE_DURATION_MS = 5_000;
const INPUT_INTERVAL_MS = 50;
const MINIMUM_TICK_RATE = 18;
const MAXIMUM_AVERAGE_SNAPSHOT_BYTES = 16_000;
const MAXIMUM_OUTBOUND_BYTES_PER_SECOND = 200_000;

class MessageQueue {
  readonly messages: ServerMessage[] = [];

  constructor(socket: WebSocket) {
    socket.on('message', (data) => {
      this.messages.push(serverCodec.decode(new Uint8Array(data as Buffer)));
    });
  }

  latestSnapshot(): Extract<ServerMessage, { type: 'snapshot' }> | null {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index];
      if (message?.type === 'snapshot') {
        return message;
      }
    }
    return null;
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolveSocket(socket));
    socket.once('error', reject);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error('timed out waiting for bandwidth verification state');
}

function activeRoom(server: ReturnType<typeof createGameServer>) {
  const room = server.getDiagnostics().rooms.find((candidate) => candidate.connectionCount > 0);
  if (!room) {
    throw new Error('missing active authoritative room diagnostics');
  }
  return room;
}

const server = createGameServer(0x78a1, {
  enableBots: true,
  lobbyFillWaitMs: 0,
  pve: { enabled: true, population: 'full' },
  staticSolids: AUTHORITATIVE_MAP_STATIC_SOLIDS,
  map: { enabled: true },
  pooledRooms: true,
  fullVisibility: false,
  perMessageDeflate: true,
});

let socket: WebSocket | null = null;
try {
  const port = await server.listen(0);
  socket = await connect(`ws://127.0.0.1:${port}/match`);
  const queue = new MessageQueue(socket);
  const verificationPlayerId = playerId(`bandwidth-${randomUUID().slice(0, 12)}`);
  socket.send(
    clientCodec.encode({
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: verificationPlayerId,
      heroId: HERO_IDS.sunWukong,
    }),
  );

  await waitFor(() => queue.messages.some((message) => message.type === 'joined'));
  await waitFor(() => queue.latestSnapshot()?.snapshot.match.status === 'running');

  const joined = queue.messages.find((message) => message.type === 'joined');
  const initialSnapshot = queue.latestSnapshot();
  if (joined?.type !== 'joined' || !initialSnapshot) {
    throw new Error('missing joined message or running snapshot');
  }
  const initialPlayer = initialSnapshot.snapshot.players.find(
    (player) => player.entityId === joined.entityId,
  );
  if (!initialPlayer) {
    throw new Error('running snapshot omitted the local player');
  }

  const initialRoom = activeRoom(server);
  let sequence = initialSnapshot.acknowledgedInputSequence;
  const directions = [
    { x: 1_000, z: 0 },
    { x: 0, z: -1_000 },
    { x: -1_000, z: 0 },
    { x: 0, z: 1_000 },
  ] as const;
  const sampleStartedAt = performance.now();
  const inputTimer = setInterval(() => {
    const elapsed = performance.now() - sampleStartedAt;
    const direction = directions[Math.floor(elapsed / 1_000) % directions.length] ?? directions[0];
    sequence += 1;
    socket?.send(
      clientCodec.encode({
        type: 'input',
        protocolVersion: PROTOCOL_VERSION,
        sequence,
        moveX: direction.x,
        moveZ: direction.z,
        aimX: direction.x,
        aimZ: direction.z,
        attack: false,
        targetEntityId: null,
        secondaryTargetEntityId: null,
        castActive: false,
        alternateActive: false,
        interact: false,
      }),
    );
  }, INPUT_INTERVAL_MS);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, SAMPLE_DURATION_MS));
  clearInterval(inputTimer);
  const finalRoom = activeRoom(server);
  const sampleEndedAt = performance.now();
  if (finalRoom.createdAtMs !== initialRoom.createdAtMs) {
    throw new Error('active authoritative room changed during bandwidth verification');
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));

  const sampleElapsedSeconds = (sampleEndedAt - sampleStartedAt) / 1_000;
  const finalSnapshot = queue.latestSnapshot();
  if (!finalSnapshot) {
    throw new Error('missing final authoritative snapshot');
  }
  const finalPlayer = finalSnapshot.snapshot.players.find(
    (player) => player.entityId === joined.entityId,
  );
  if (!finalPlayer) {
    throw new Error('final snapshot omitted the local player');
  }
  const finalDiagnostics = server.getDiagnostics();
  const initialNetwork = initialRoom.network;
  const finalNetwork = finalRoom.network;
  const snapshotDelta = finalNetwork.snapshotsSent - initialNetwork.snapshotsSent;
  const snapshotBytesDelta = finalNetwork.snapshotBytesSent - initialNetwork.snapshotBytesSent;
  const bytesDelta = finalNetwork.bytesSent - initialNetwork.bytesSent;
  const tickDelta = finalRoom.tick - initialRoom.tick;
  const movementDistanceMm = Math.hypot(
    finalPlayer.position.x - initialPlayer.position.x,
    finalPlayer.position.z - initialPlayer.position.z,
  );
  const averageSnapshotBytes =
    snapshotDelta > 0 ? snapshotBytesDelta / snapshotDelta : Number.POSITIVE_INFINITY;
  const outboundBytesPerSecond = bytesDelta / sampleElapsedSeconds;
  const tickRate = tickDelta / sampleElapsedSeconds;

  const result = {
    schema: 'jwgb.web-bandwidth-verification.v1',
    verifiedAt: new Date().toISOString(),
    sampleElapsedSeconds,
    authoritative: {
      roomMode: finalDiagnostics.mode,
      activeRoomCount: finalDiagnostics.activeRoomCount,
      playerCount: finalDiagnostics.authoritativePlayerCount,
      maximumMonsterCount: finalDiagnostics.maximumAuthoritativeMonsterCount,
      initialTick: initialRoom.tick,
      finalTick: finalRoom.tick,
      tickRate,
    },
    clientView: {
      visiblePlayerCount: finalSnapshot.snapshot.players.length,
      visibleMonsterCount: finalSnapshot.snapshot.monsters.length,
      initialTick: initialSnapshot.snapshot.tick,
      finalTick: finalSnapshot.snapshot.tick,
      initialAcknowledgedInputSequence: initialSnapshot.acknowledgedInputSequence,
      finalAcknowledgedInputSequence: finalSnapshot.acknowledgedInputSequence,
      movementDistanceMm,
    },
    network: {
      messagesSent: finalNetwork.messagesSent - initialNetwork.messagesSent,
      bytesSent: bytesDelta,
      snapshotsSent: snapshotDelta,
      snapshotBytesSent: snapshotBytesDelta,
      averageSnapshotBytes,
      maximumSnapshotBytes: finalNetwork.maximumSnapshotBytes,
      outboundBytesPerSecond,
    },
    thresholds: {
      minimumTickRate: MINIMUM_TICK_RATE,
      maximumAverageSnapshotBytes: MAXIMUM_AVERAGE_SNAPSHOT_BYTES,
      maximumOutboundBytesPerSecond: MAXIMUM_OUTBOUND_BYTES_PER_SECOND,
    },
  };

  const reportPath = resolve(
    process.env.JWGB_WEB_BANDWIDTH_REPORT?.trim() ||
      'migration/reports/web/local-bandwidth/verification.json',
  );
  await mkdir(resolve(reportPath, '..'), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  const failed =
    result.authoritative.roomMode !== 'pooled' ||
    result.authoritative.playerCount !== 30 ||
    result.authoritative.maximumMonsterCount !== 123 ||
    result.authoritative.tickRate < MINIMUM_TICK_RATE ||
    result.clientView.finalAcknowledgedInputSequence <=
      result.clientView.initialAcknowledgedInputSequence ||
    result.clientView.movementDistanceMm <= 0 ||
    result.network.averageSnapshotBytes > MAXIMUM_AVERAGE_SNAPSHOT_BYTES ||
    result.network.outboundBytesPerSecond > MAXIMUM_OUTBOUND_BYTES_PER_SECOND;
  if (failed) {
    console.error(JSON.stringify(result, null, 2));
    throw new Error('web bandwidth verification failed');
  }

  console.log(
    `web bandwidth verification passed: ${result.authoritative.tickRate.toFixed(1)} tick/s, ` +
      `${result.clientView.movementDistanceMm.toFixed(0)} mm moved, ` +
      `${result.network.averageSnapshotBytes.toFixed(0)} bytes/snapshot, ` +
      `${result.network.outboundBytesPerSecond.toFixed(0)} bytes/s`,
  );
} finally {
  socket?.close();
  await server.close();
}
