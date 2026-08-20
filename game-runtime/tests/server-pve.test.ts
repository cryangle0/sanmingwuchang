import { AUTHORITATIVE_MAP_STATIC_SOLIDS, HERO_IDS, RULESET_VERSION } from '@jwgb/content';
import { playerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
  validateServerMessage,
} from '@jwgb/protocol';
import { type RawData, WebSocket } from 'ws';
import { createGameServer } from '../apps/server/src/network/game-server';

const clientCodec = new JsonMessageCodec<ClientMessage>([
  'join',
  'resume',
  'snapshot-ack',
  'input',
  'ping',
  'shop-purchase',
  'shop-sale',
  'spend-gem',
  'skill-book-replace',
]);
const serverCodec = new JsonMessageCodec<ServerMessage>([
  'joined',
  'snapshot',
  'events',
  'pong',
  'transaction-result',
  'error',
]);

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForMessage(socket: WebSocket, predicate: (message: ServerMessage) => boolean) {
  return new Promise<ServerMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('timed out waiting for server PVE message'));
    }, 2_000);
    const onMessage = (data: RawData): void => {
      try {
        const message = serverCodec.decode(new Uint8Array(data as Buffer));
        validateServerMessage(message);
        if (!predicate(message)) {
          return;
        }
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolve(message);
      } catch (error) {
        clearTimeout(timeout);
        socket.off('message', onMessage);
        reject(error);
      }
    };
    socket.on('message', onMessage);
  });
}

describe('production PVE room wiring', () => {
  it('keeps the full PVE population authoritative while filtering observer snapshots', async () => {
    const server = createGameServer(0x20260725, {
      startRoomTimer: false,
      pve: { enabled: true, population: 'full' },
      staticSolids: AUTHORITATIVE_MAP_STATIC_SOLIDS,
    });

    const authoritativeMonsterIds = new Set(
      server.room.getSnapshot().monsters.map((monster) => monster.entityId),
    );
    expect(authoritativeMonsterIds.size).toBe(123);
    const port = await server.listen(0);
    const first = await connect(`ws://127.0.0.1:${port}/match`);
    const second = await connect(`ws://127.0.0.1:${port}/match`);
    const firstSnapshotPromise = waitForMessage(first, (message) => message.type === 'snapshot');
    first.send(
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('pve-network-first'),
        heroId: HERO_IDS.sunWukong,
      }),
    );
    second.send(
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('pve-network-second'),
        heroId: HERO_IDS.ironFanPrincess,
      }),
    );
    const firstSnapshot = await firstSnapshotPromise;
    if (firstSnapshot.type !== 'snapshot') {
      throw new Error('expected PVE snapshot');
    }
    expect(firstSnapshot.snapshot.monsters.length).toBeGreaterThan(0);
    expect(firstSnapshot.snapshot.monsters.length).toBeLessThan(authoritativeMonsterIds.size);
    expect(
      firstSnapshot.snapshot.monsters.every((monster) =>
        authoritativeMonsterIds.has(monster.entityId),
      ),
    ).toBe(true);
    expect(firstSnapshot.snapshot.staticSolids).toHaveLength(
      AUTHORITATIVE_MAP_STATIC_SOLIDS.length,
    );
    first.close();
    second.close();
    await server.close();
  });
});
