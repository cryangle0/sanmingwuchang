import { AUTHORITATIVE_HEROES, RULESET_VERSION } from '@jwgb/content';
import { heroId, playerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
  validateServerMessage,
} from '@jwgb/protocol';
import { WebSocket } from 'ws';
import { createGameServer } from '../apps/server/src/network/game-server';

const clientCodec = new JsonMessageCodec<ClientMessage>([
  'matchmaking-enqueue',
  'matchmaking-cancel',
  'matchmaking-reroll',
  'matchmaking-select',
  'join',
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

class MessageQueue {
  private readonly messages: ServerMessage[] = [];

  constructor(socket: WebSocket) {
    socket.on('message', (data) => {
      const message = serverCodec.decode(new Uint8Array(data as Buffer));
      validateServerMessage(message);
      this.messages.push(message);
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
    throw new Error('timed out waiting for matchmaking message');
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
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for matchmaking state');
}

describe('authoritative matchmaking', () => {
  it('enqueues, selects, issues a ticket, and joins the reserved room once', async () => {
    const server = createGameServer(0x51_00_01, {
      startRoomTimer: false,
      requireMatchTicketForJoin: true,
      matchmakingSelectionDelayMs: 5,
      matchmakingSelectionDurationMs: 250,
      matchmakingTicketTtlMs: 1_000,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const player = playerId('matchmaking-e2e-player');
    const queueSocket = await connect(url);
    const queue = new MessageQueue(queueSocket);

    send(queueSocket, {
      type: 'matchmaking-enqueue',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: player,
    });
    await queue.waitFor((message) => message.type === 'matchmaking-queued');
    const selection = await queue.waitFor((message) => message.type === 'matchmaking-selection');
    if (selection.type !== 'matchmaking-selection') {
      throw new Error('expected a selection message');
    }
    expect(selection.offers).toHaveLength(3);
    expect(
      selection.offers.every((candidate) =>
        AUTHORITATIVE_HEROES.some((hero) => hero.id === candidate),
      ),
    ).toBe(true);

    const selectedHero = selection.offers[1] ?? selection.offers[0];
    if (!selectedHero) {
      throw new Error('selection did not contain a hero');
    }
    send(queueSocket, {
      type: 'matchmaking-select',
      protocolVersion: PROTOCOL_VERSION,
      matchId: selection.matchId,
      heroId: heroId(selectedHero),
    });
    const assigned = await queue.waitFor((message) => message.type === 'matchmaking-assigned');
    if (assigned.type !== 'matchmaking-assigned') {
      throw new Error('expected a matchmaking ticket');
    }
    expect(server.getDiagnostics().matchmaking.activeTicketCount).toBe(1);
    expect(server.getDiagnostics().rooms[0]?.reservedJoinCount).toBe(1);

    const battleSocket = await connect(url);
    const battle = new MessageQueue(battleSocket);
    send(battleSocket, {
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: player,
      heroId: assigned.heroId,
      matchTicket: assigned.matchTicket,
    });
    const joined = await battle.waitFor((message) => message.type === 'joined');
    expect(joined.type).toBe('joined');
    await waitFor(() => server.getDiagnostics().matchmaking.activeTicketCount === 0);
    expect(server.getDiagnostics().rooms[0]?.reservedJoinCount).toBe(0);
    expect(server.room.getSnapshot().players).toHaveLength(1);

    queueSocket.close();
    battleSocket.close();
    await server.close();
  });

  it('cancels an active hero selection without reserving a room seat', async () => {
    const server = createGameServer(0x51_00_11, {
      startRoomTimer: false,
      matchmakingSelectionDelayMs: 5,
      matchmakingSelectionDurationMs: 250,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const queueSocket = await connect(url);
    const queue = new MessageQueue(queueSocket);
    send(queueSocket, {
      type: 'matchmaking-enqueue',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: playerId('matchmaking-selection-cancel-player'),
    });
    await queue.waitFor((message) => message.type === 'matchmaking-selection');
    send(queueSocket, {
      type: 'matchmaking-cancel',
      protocolVersion: PROTOCOL_VERSION,
    });
    const cancelled = await queue.waitFor((message) => message.type === 'matchmaking-cancelled');
    expect(cancelled).toMatchObject({
      type: 'matchmaking-cancelled',
      reason: 'client',
    });
    await waitFor(() => server.getDiagnostics().matchmaking.selectingCount === 0);
    expect(server.getDiagnostics().matchmaking.activeTicketCount).toBe(0);
    expect(server.getDiagnostics().rooms[0]?.reservedJoinCount).toBe(0);

    queueSocket.close();
    await server.close();
  });

  it('releases a reserved seat when the assigned ticket is cancelled or expires', async () => {
    const server = createGameServer(0x51_00_02, {
      startRoomTimer: false,
      matchmakingSelectionDelayMs: 5,
      matchmakingSelectionDurationMs: 250,
      matchmakingTicketTtlMs: 35,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const queueSocket = await connect(url);
    const queue = new MessageQueue(queueSocket);
    send(queueSocket, {
      type: 'matchmaking-enqueue',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: playerId('matchmaking-cancel-player'),
    });
    const selection = await queue.waitFor((message) => message.type === 'matchmaking-selection');
    if (selection.type !== 'matchmaking-selection') {
      throw new Error('expected a selection message');
    }
    send(queueSocket, {
      type: 'matchmaking-select',
      protocolVersion: PROTOCOL_VERSION,
      matchId: selection.matchId,
      heroId: selection.offers[0] ?? heroId('H009'),
    });
    await queue.waitFor((message) => message.type === 'matchmaking-assigned');
    expect(server.getDiagnostics().rooms[0]?.reservedJoinCount).toBe(1);
    await queue.waitFor((message) => message.type === 'matchmaking-cancelled');
    await waitFor(() => server.getDiagnostics().rooms[0]?.reservedJoinCount === 0);
    expect(server.getDiagnostics().matchmaking.activeTicketCount).toBe(0);

    queueSocket.close();
    await server.close();
  });

  it('rejects a consumed ticket on a second join attempt', async () => {
    const server = createGameServer(0x51_00_03, {
      startRoomTimer: false,
      matchmakingSelectionDelayMs: 5,
      matchmakingSelectionDurationMs: 250,
      matchmakingTicketTtlMs: 1_000,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const player = playerId('matchmaking-single-use-player');
    const queueSocket = await connect(url);
    const queue = new MessageQueue(queueSocket);
    send(queueSocket, {
      type: 'matchmaking-enqueue',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: player,
    });
    const selection = await queue.waitFor((message) => message.type === 'matchmaking-selection');
    if (selection.type !== 'matchmaking-selection') {
      throw new Error('expected a selection message');
    }
    const hero = selection.offers[0] ?? heroId('H009');
    send(queueSocket, {
      type: 'matchmaking-select',
      protocolVersion: PROTOCOL_VERSION,
      matchId: selection.matchId,
      heroId: hero,
    });
    const assigned = await queue.waitFor((message) => message.type === 'matchmaking-assigned');
    if (assigned.type !== 'matchmaking-assigned') {
      throw new Error('expected an assigned ticket');
    }

    const firstSocket = await connect(url);
    const firstQueue = new MessageQueue(firstSocket);
    send(firstSocket, {
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: player,
      heroId: assigned.heroId,
      matchTicket: assigned.matchTicket,
    });
    await firstQueue.waitFor((message) => message.type === 'joined');

    const secondSocket = await connect(url);
    const secondQueue = new MessageQueue(secondSocket);
    send(secondSocket, {
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: playerId('matchmaking-single-use-second'),
      heroId: assigned.heroId,
      matchTicket: assigned.matchTicket,
    });
    const rejected = await secondQueue.waitFor((message) => message.type === 'error');
    expect(rejected).toMatchObject({
      type: 'error',
      code: 'MATCH_TICKET_REJECTED',
    });

    queueSocket.close();
    firstSocket.close();
    secondSocket.close();
    await server.close();
  });
});
