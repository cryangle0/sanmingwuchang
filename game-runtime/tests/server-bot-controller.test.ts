import { EQUIPMENT_IDS, HERO_IDS, RULESET_VERSION } from '@jwgb/content';
import { type EntityId, entityId, playerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@jwgb/protocol';
import { GameSimulation } from '@jwgb/sim';
import { WebSocket } from 'ws';
import { createGameServer } from '../apps/server/src/network/game-server';
import { createBotIntent } from '../apps/server/src/room/bot-controller';

const clientCodec = new JsonMessageCodec<ClientMessage>([
  'join',
  'resume',
  'snapshot-ack',
  'input',
  'ping',
]);
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
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for WebSocket message');
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function send(socket: WebSocket, message: ClientMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(clientCodec.encode(message), (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for room state');
}

function joinMessage(id: string): Extract<ClientMessage, { type: 'join' }> {
  return {
    type: 'join',
    protocolVersion: PROTOCOL_VERSION,
    rulesetVersion: RULESET_VERSION,
    playerId: playerId(id),
    heroId: HERO_IDS.sunWukong,
  };
}

function emptySnapshot(observerEntityId: EntityId) {
  const simulation = new GameSimulation({ rootSeed: 0xb070 });
  const addedEntityId = simulation.addPlayer({
    playerId: playerId('bot'),
    heroId: HERO_IDS.sunWukong,
    position: { x: 90_000, z: 0 },
  });
  if (addedEntityId !== observerEntityId) {
    throw new Error(`expected observer entity ${observerEntityId}, received ${addedEntityId}`);
  }
  return simulation.getObserverSnapshot(observerEntityId);
}

describe('server bot control', () => {
  it('does not select a target that is absent from the observer snapshot', () => {
    const snapshot = emptySnapshot(entityId(1));
    const intent = createBotIntent(snapshot, entityId(1), 1);
    expect(intent.targetEntityId).toBeNull();
    expect(intent.attack).toBe(false);
  });

  it('does not engage core bosses or collect high-value ground loot', () => {
    const snapshot = emptySnapshot(entityId(1));
    const pveSimulation = new GameSimulation({
      rootSeed: 0xb071,
      pve: { enabled: true, population: 'demo' },
    });
    const monsterTemplate = pveSimulation.getSnapshot().monsters[0];
    if (!monsterTemplate) {
      throw new Error('expected a PVE monster template');
    }
    const restrictedSnapshot = {
      ...snapshot,
      monsters: [
        {
          ...monsterTemplate,
          entityId: entityId(100),
          kind: 'core-boss' as const,
          position: { x: 89_000, z: 0 },
        },
        {
          ...monsterTemplate,
          entityId: entityId(101),
          kind: 'dragon-king' as const,
          position: { x: 91_000, z: 0 },
        },
      ],
      lootDrops: [
        {
          entityId: entityId(102),
          position: { x: 90_000, z: 0 },
          gold: 0,
          experience: 0,
          gems: 0,
          equipmentId: EQUIPMENT_IDS.nineTurnPill,
          bookPassiveId: null,
          createdAtTick: 0,
          expiresAtTick: 2_400,
          kind: 'equipment' as const,
        },
      ],
    };

    const intent = createBotIntent(restrictedSnapshot, entityId(1), 1);
    expect(intent).toMatchObject({
      targetEntityId: null,
      attack: false,
      interact: false,
      castActive: false,
    });
  });

  it('fills the lobby with D2 bots and starts the same simulation', async () => {
    const server = createGameServer(0xb07, {
      startRoomTimer: false,
      enableBots: true,
      lobbyFillWaitMs: 20,
    });
    const port = await server.listen(0);
    const socket = await connect(`ws://127.0.0.1:${port}/match`);
    const queue = new MessageQueue(socket);
    await send(socket, joinMessage('lobby-human'));
    const joined = await queue.waitFor((message) => message.type === 'joined');
    if (joined.type !== 'joined') {
      throw new Error('expected lobby join');
    }

    await waitForCondition(() => server.room.getSnapshot().players.length === 30);
    const botViews = Array.from({ length: 29 }, (_, index) =>
      server.room.getPlayerSession(playerId(`__jwgb_bot_${index + 1}`)),
    );
    expect(botViews.every((view) => view?.controller === 'bot')).toBe(true);
    expect(botViews.every((view) => view?.botDifficulty === 'D2')).toBe(true);

    server.room.step();
    expect(server.room.getSnapshot().match.status).toBe('running');
    expect(server.room.getSnapshot().players).toHaveLength(30);

    socket.close();
    await server.close();
  });

  it('takes over after the delay, keeps the entity, and returns only after ACK plus a tick', async () => {
    const server = createGameServer(0xb08, {
      startRoomTimer: false,
      enableBots: false,
      botTakeoverDelayMs: 20,
      resumeGracePeriodMs: 300,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const socket = await connect(`ws://127.0.0.1:${port}/match`);
    const queue = new MessageQueue(socket);
    const humanId = playerId('takeover-human');
    await send(socket, joinMessage('takeover-human'));
    const joined = await queue.waitFor((message) => message.type === 'joined');
    if (joined.type !== 'joined') {
      throw new Error('expected takeover join');
    }
    const entityId = joined.entityId;

    socket.close();
    await waitForCondition(
      () =>
        server.room.getPlayerSession(humanId)?.state === 'disconnected' ||
        server.room.getPlayerSession(humanId)?.state === 'bot-takeover',
    );
    await waitForCondition(() => server.room.getPlayerSession(humanId)?.state === 'bot-takeover');
    const takeoverSequence = server.room.getPlayerSession(humanId)?.acknowledgedInputSequence ?? 0;
    server.room.step();
    expect(server.room.getPlayerSession(humanId)).toMatchObject({
      entityId,
      controller: 'bot',
    });
    expect(server.room.getPlayerSession(humanId)?.acknowledgedInputSequence).toBeGreaterThan(
      takeoverSequence,
    );

    const resumedSocket = await connect(url);
    const resumedQueue = new MessageQueue(resumedSocket);
    await send(resumedSocket, {
      type: 'resume',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: humanId,
      recoveryToken: joined.recoveryToken,
    });
    const resumed = await resumedQueue.waitFor((message) => message.type === 'joined');
    const resumedSnapshot = await resumedQueue.waitFor((message) => message.type === 'snapshot');
    if (resumed.type !== 'joined' || resumedSnapshot.type !== 'snapshot') {
      throw new Error('expected resumed snapshot');
    }
    await send(resumedSocket, {
      type: 'snapshot-ack',
      protocolVersion: PROTOCOL_VERSION,
      snapshotTick: resumedSnapshot.snapshot.tick,
      stateHash: `${resumedSnapshot.snapshot.stateHash}-wrong`,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    server.room.step();
    expect(server.room.getPlayerSession(humanId)).toMatchObject({
      state: 'bot-takeover',
      controller: 'bot',
      awaitingSnapshotAck: true,
    });

    await send(resumedSocket, {
      type: 'snapshot-ack',
      protocolVersion: PROTOCOL_VERSION,
      snapshotTick: resumedSnapshot.snapshot.tick,
      stateHash: resumedSnapshot.snapshot.stateHash,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(server.room.getPlayerSession(humanId)?.controller).toBe('bot');
    server.room.step();
    expect(server.room.getPlayerSession(humanId)).toMatchObject({
      state: 'connected',
      controller: 'player',
      awaitingSnapshotAck: false,
    });

    resumedSocket.close();
    await server.close();
  });

  it('expires the recovery credential while continuing to drive the original entity', async () => {
    const server = createGameServer(0xb0a, {
      startRoomTimer: false,
      enableBots: false,
      botTakeoverDelayMs: 10,
      resumeGracePeriodMs: 50,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const socket = await connect(url);
    const queue = new MessageQueue(socket);
    const humanId = playerId('expired-human');
    await send(socket, joinMessage('expired-human'));
    const joined = await queue.waitFor((message) => message.type === 'joined');
    if (joined.type !== 'joined') {
      throw new Error('expected expiry test join');
    }

    socket.close();
    await waitForCondition(() => server.room.getPlayerSession(humanId)?.state === 'expired');
    const expiredSequence = server.room.getPlayerSession(humanId)?.acknowledgedInputSequence ?? 0;
    server.room.step();
    expect(server.room.getPlayerSession(humanId)).toMatchObject({
      entityId: joined.entityId,
      state: 'expired',
      controller: 'bot',
      acknowledgedInputSequence: expiredSequence + 1,
    });
    expect(
      server.room.getSnapshot().players.some((player) => player.entityId === joined.entityId),
    ).toBe(true);

    const rejectedSocket = await connect(url);
    const rejectedQueue = new MessageQueue(rejectedSocket);
    await send(rejectedSocket, {
      type: 'resume',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: humanId,
      recoveryToken: joined.recoveryToken,
    });
    const rejection = await rejectedQueue.waitFor((message) => message.type === 'error');
    expect(rejection).toMatchObject({
      type: 'error',
      code: 'RESUME_REJECTED',
    });

    rejectedSocket.close();
    await server.close();
  });

  it('enters AFK hosting and accepts a later valid input as the next-tick handoff', async () => {
    const server = createGameServer(0xb09, {
      startRoomTimer: false,
      afkTakeoverMs: 20,
    });
    const port = await server.listen(0);
    const socket = await connect(`ws://127.0.0.1:${port}/match`);
    const queue = new MessageQueue(socket);
    const humanId = playerId('afk-human');
    await send(socket, joinMessage('afk-human'));
    await queue.waitFor((message) => message.type === 'joined');
    await waitForCondition(() => server.room.getPlayerSession(humanId)?.controller === 'bot');
    expect(server.room.getPlayerSession(humanId)?.state).toBe('bot-takeover');

    await send(socket, {
      type: 'input',
      protocolVersion: PROTOCOL_VERSION,
      sequence: 1,
      moveX: 1_000,
      moveZ: 0,
      aimX: 0,
      aimZ: 1_000,
      attack: false,
      targetEntityId: null,
      castActive: false,
      interact: false,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(server.room.getPlayerSession(humanId)?.controller).toBe('bot');
    server.room.step();
    expect(server.room.getPlayerSession(humanId)).toMatchObject({
      state: 'connected',
      controller: 'player',
      acknowledgedInputSequence: 1,
    });

    socket.close();
    await server.close();
  });
});
