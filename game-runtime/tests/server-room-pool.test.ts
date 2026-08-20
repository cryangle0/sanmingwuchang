import { heroId, playerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@jwgb/protocol';
import { WebSocket } from 'ws';
import { createGameServer } from '../apps/server/src/network/game-server';
import { RULESET_VERSION } from '../packages/content/src';

const clientCodec = new JsonMessageCodec<ClientMessage>(['join', 'resume']);
const serverCodec = new JsonMessageCodec<ServerMessage>([
  'joined',
  'snapshot',
  'events',
  'pong',
  'transaction-result',
  'error',
]);

class MessageQueue {
  private readonly messages: ServerMessage[] = [];

  constructor(socket: WebSocket) {
    socket.on('message', (data) => {
      this.messages.push(serverCodec.decode(new Uint8Array(data as Buffer)));
    });
  }

  async waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 2_000,
  ): Promise<ServerMessage> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) {
        const [message] = this.messages.splice(index, 1);
        if (message) {
          return message;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('timed out waiting for pooled-room message');
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function send(socket: WebSocket, message: ClientMessage): void {
  socket.send(clientCodec.encode(message));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for pooled-room state');
}

describe('pooled authoritative rooms', () => {
  it('shares an accepting room and routes resume back to the original session', async () => {
    const server = createGameServer(0x7001, {
      pooledRooms: true,
      startRoomTimer: false,
      resumeGracePeriodMs: 500,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const firstPlayerId = playerId('pooled-first');
    const secondPlayerId = playerId('pooled-second');
    const first = await connect(url);
    const second = await connect(url);
    const firstQueue = new MessageQueue(first);
    const secondQueue = new MessageQueue(second);

    send(first, {
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: firstPlayerId,
      heroId: heroId('H009'),
    });
    send(second, {
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: secondPlayerId,
      heroId: heroId('H018'),
    });
    const firstJoined = await firstQueue.waitFor((message) => message.type === 'joined');
    const secondJoined = await secondQueue.waitFor((message) => message.type === 'joined');
    if (firstJoined.type !== 'joined' || secondJoined.type !== 'joined') {
      throw new Error('expected both pooled clients to join');
    }

    expect(server.getDiagnostics()).toMatchObject({
      mode: 'pooled',
      activeRoomCount: 1,
      connectedClientCount: 2,
      authoritativePlayerCount: 2,
      maximumAuthoritativeMonsterCount: 0,
      rooms: [{ maximumAuthoritativeMonsterCount: 0 }],
    });

    first.close();
    await waitFor(() => server.getDiagnostics().connectedClientCount === 1);
    const resumedSocket = await connect(url);
    const resumedQueue = new MessageQueue(resumedSocket);
    send(resumedSocket, {
      type: 'resume',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: firstPlayerId,
      recoveryToken: firstJoined.recoveryToken,
    });
    const resumed = await resumedQueue.waitFor((message) => message.type === 'joined');
    expect(resumed).toMatchObject({
      type: 'joined',
      entityId: firstJoined.entityId,
      resumed: true,
    });
    expect(server.getDiagnostics()).toMatchObject({
      activeRoomCount: 1,
      connectedClientCount: 2,
      authoritativePlayerCount: 2,
    });

    resumedSocket.close();
    second.close();
    await server.close();
  });

  it('opens a new room after lobby lock and recycles rooms after recovery expiry', async () => {
    const server = createGameServer(0x7002, {
      pooledRooms: true,
      enableBots: true,
      lobbyFillWaitMs: 10,
      resumeGracePeriodMs: 25,
      roomRecycleIntervalMs: 5,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const first = await connect(url);
    const firstQueue = new MessageQueue(first);
    send(first, {
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: playerId('pool-lock-first'),
      heroId: heroId('H009'),
    });
    await firstQueue.waitFor((message) => message.type === 'joined');
    await waitFor(() => server.getDiagnostics().acceptingRoomCount === 0);

    const second = await connect(url);
    const secondQueue = new MessageQueue(second);
    send(second, {
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: playerId('pool-lock-second'),
      heroId: heroId('H018'),
    });
    await secondQueue.waitFor((message) => message.type === 'joined');
    await waitFor(() => server.getDiagnostics().activeRoomCount === 2);

    first.close();
    second.close();
    await waitFor(
      () =>
        server.getDiagnostics().activeRoomCount === 0 && server.getDiagnostics().rooms.length === 0,
    );
    await server.close();
  });
});
