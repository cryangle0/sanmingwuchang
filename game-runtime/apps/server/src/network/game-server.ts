import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { RULESET_VERSION } from '@jwgb/content';
import { type HeroId, heroId, type PlayerId, playerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
  validateClientMessage,
} from '@jwgb/protocol';
import type { MapSimulationOptions, PveSimulationOptions, StaticSolidRect } from '@jwgb/sim';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import {
  MatchmakingCoordinator,
  type MatchmakingDiagnostics,
  type MatchmakingRoomTarget,
} from '../matchmaking/matchmaking-coordinator';
import { AuthoritativeRoom, type RoomLifecycleDiagnostics } from '../room/authoritative-room';

interface RoutingMessage {
  readonly type: string;
  readonly playerId: string | null;
  readonly heroId: string | null;
  readonly matchTicket: string | null;
}

export interface GameServerDiagnostics {
  readonly mode: 'shared' | 'isolated' | 'pooled';
  readonly activeRoomCount: number;
  readonly acceptingRoomCount: number;
  readonly connectedClientCount: number;
  readonly authoritativePlayerCount: number;
  readonly authoritativeMonsterCount: number;
  readonly maximumAuthoritativeMonsterCount: number;
  readonly matchmaking: MatchmakingDiagnostics;
  readonly rooms: readonly RoomLifecycleDiagnostics[];
}

export interface GameServer {
  readonly httpServer: Server;
  readonly webSocketServer: WebSocketServer;
  readonly room: AuthoritativeRoom;
  listen(port: number, host?: string): Promise<number>;
  getDiagnostics(): GameServerDiagnostics;
  close(): Promise<void>;
}

export interface GameServerOptions {
  readonly startRoomTimer?: boolean;
  readonly resumeGracePeriodMs?: number;
  readonly botTakeoverDelayMs?: number;
  readonly afkTakeoverMs?: number;
  readonly lobbyFillWaitMs?: number;
  readonly enableBots?: boolean;
  readonly pve?: PveSimulationOptions;
  readonly staticSolids?: readonly StaticSolidRect[];
  readonly map?: MapSimulationOptions;
  readonly isolatedRooms?: boolean;
  readonly pooledRooms?: boolean;
  readonly roomRecycleIntervalMs?: number;
  readonly fullVisibility?: boolean;
  readonly perMessageDeflate?: boolean;
  readonly matchmakingSelectionDelayMs?: number;
  readonly matchmakingSelectionDurationMs?: number;
  readonly matchmakingTicketTtlMs?: number;
  readonly requireMatchTicketForJoin?: boolean;
}

function rawDataToUint8Array(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function readRoutingMessage(data: RawData): RoutingMessage {
  try {
    const text = new TextDecoder().decode(rawDataToUint8Array(data));
    const parsed = JSON.parse(text) as {
      readonly type?: unknown;
      readonly playerId?: unknown;
      readonly heroId?: unknown;
      readonly matchTicket?: unknown;
    };
    return {
      type: typeof parsed.type === 'string' ? parsed.type : '',
      playerId: typeof parsed.playerId === 'string' ? parsed.playerId : null,
      heroId: typeof parsed.heroId === 'string' ? parsed.heroId : null,
      matchTicket: typeof parsed.matchTicket === 'string' ? parsed.matchTicket : null,
    };
  } catch {
    return { type: '', playerId: null, heroId: null, matchTicket: null };
  }
}

function roomMode(options: GameServerOptions): 'shared' | 'isolated' | 'pooled' {
  if (options.pooledRooms) {
    return 'pooled';
  }
  if (options.isolatedRooms) {
    return 'isolated';
  }
  return 'shared';
}

const routingClientCodec = new JsonMessageCodec<ClientMessage>([
  'matchmaking-enqueue',
  'matchmaking-cancel',
  'matchmaking-reroll',
  'matchmaking-select',
  'join',
  'resume',
]);
const routingServerCodec = new JsonMessageCodec<ServerMessage>(['error']);

export function createGameServer(
  rootSeed = randomBytes(4).readUInt32LE(0),
  options: GameServerOptions = {},
): GameServer {
  const mode = roomMode(options);
  const roomOptions = {
    ...(options.resumeGracePeriodMs === undefined
      ? {}
      : { resumeGracePeriodMs: options.resumeGracePeriodMs }),
    ...(options.botTakeoverDelayMs === undefined
      ? {}
      : { botTakeoverDelayMs: options.botTakeoverDelayMs }),
    ...(options.afkTakeoverMs === undefined ? {} : { afkTakeoverMs: options.afkTakeoverMs }),
    ...(options.lobbyFillWaitMs === undefined ? {} : { lobbyFillWaitMs: options.lobbyFillWaitMs }),
    ...(options.enableBots === undefined ? {} : { enableBots: options.enableBots }),
    ...(options.pve ? { pve: options.pve } : {}),
    ...(options.staticSolids ? { staticSolids: options.staticSolids } : {}),
    ...(options.map ? { map: options.map } : {}),
    ...(options.fullVisibility === undefined ? {} : { fullVisibility: options.fullVisibility }),
  };
  let roomSequence = 0;
  const createRoom = (seed: number): AuthoritativeRoom => new AuthoritativeRoom(seed, roomOptions);
  const room = createRoom(rootSeed);
  const dynamicRooms = new Set<AuthoritativeRoom>();
  const roomIds = new Map<AuthoritativeRoom, string>([[room, 'shared-room']]);
  const roomRecycleIntervalMs = options.roomRecycleIntervalMs ?? 1_000;

  const createDynamicRoom = (): AuthoritativeRoom => {
    roomSequence += 1;
    const dynamicRoom = createRoom((rootSeed + Math.imul(roomSequence, 0x9e37_79b1)) >>> 0);
    dynamicRooms.add(dynamicRoom);
    roomIds.set(dynamicRoom, `room-${roomSequence}`);
    if (options.startRoomTimer !== false) {
      dynamicRoom.start();
    }
    return dynamicRoom;
  };

  const findMatchmakingRoom = (
    requestedPlayerId: PlayerId,
    _requestedHeroId: HeroId,
  ): MatchmakingRoomTarget | null => {
    const candidates =
      mode === 'shared'
        ? [room]
        : [...dynamicRooms].filter((candidate) => candidate.canReserveJoin());
    if (mode !== 'shared' && candidates.length === 0) {
      candidates.push(createDynamicRoom());
    }
    const target = candidates.find(
      (candidate) =>
        candidate.canReserveJoin() && !candidate.hasActivePlayerSession(requestedPlayerId),
    );
    if (!target) {
      return null;
    }
    const roomId = roomIds.get(target);
    return roomId ? { roomId, room: target } : null;
  };

  const matchmaking = new MatchmakingCoordinator({
    findRoom: findMatchmakingRoom,
    ...(options.matchmakingSelectionDelayMs === undefined
      ? {}
      : { selectionDelayMs: options.matchmakingSelectionDelayMs }),
    ...(options.matchmakingSelectionDurationMs === undefined
      ? {}
      : { selectionDurationMs: options.matchmakingSelectionDurationMs }),
    ...(options.matchmakingTicketTtlMs === undefined
      ? {}
      : { ticketTtlMs: options.matchmakingTicketTtlMs }),
  });
  const requireMatchTicketForJoin = options.requireMatchTicketForJoin ?? false;

  const findRoomForRoutingMessage = (message: RoutingMessage): AuthoritativeRoom => {
    if (message.playerId !== null) {
      try {
        const requestedPlayerId = playerId(message.playerId);
        const existing = [...dynamicRooms].find((candidate) =>
          candidate.hasPlayerSession(requestedPlayerId),
        );
        if (existing) {
          return existing;
        }
      } catch {
        // Let the authoritative room return the canonical malformed-ID error.
      }
    }
    if (mode === 'pooled' && message.type === 'join') {
      const accepting = [...dynamicRooms].find((candidate) => candidate.canAcceptJoin());
      if (accepting) {
        return accepting;
      }
    }
    return createDynamicRoom();
  };

  const recycleRooms = (): void => {
    if (mode === 'shared') {
      return;
    }
    for (const candidate of dynamicRooms) {
      if (!candidate.canRecycle()) {
        continue;
      }
      candidate.dispose();
      dynamicRooms.delete(candidate);
    }
  };
  const recycleTimer = setInterval(recycleRooms, roomRecycleIntervalMs);
  recycleTimer.unref?.();

  const getDiagnostics = (): GameServerDiagnostics => {
    const diagnosticsRooms =
      mode === 'shared'
        ? [room.getLifecycleDiagnostics()]
        : [...dynamicRooms].map((candidate) => candidate.getLifecycleDiagnostics());
    const activeRooms = diagnosticsRooms.filter(
      (candidate) =>
        candidate.connectionCount > 0 ||
        candidate.playerSessionCount > 0 ||
        candidate.reservedJoinCount > 0,
    );
    const rooms = activeRooms.length > 0 ? activeRooms : diagnosticsRooms;
    return {
      mode,
      activeRoomCount: activeRooms.length,
      acceptingRoomCount: activeRooms.filter((candidate) => candidate.acceptingJoins).length,
      connectedClientCount: rooms.reduce(
        (total, candidate) => total + candidate.connectionCount,
        0,
      ),
      authoritativePlayerCount: rooms.reduce(
        (total, candidate) => total + candidate.authoritativePlayerCount,
        0,
      ),
      authoritativeMonsterCount: rooms.reduce(
        (total, candidate) => total + candidate.authoritativeMonsterCount,
        0,
      ),
      maximumAuthoritativeMonsterCount: rooms.reduce(
        (maximum, candidate) => Math.max(maximum, candidate.maximumAuthoritativeMonsterCount),
        0,
      ),
      matchmaking: matchmaking.getDiagnostics(),
      rooms,
    };
  };

  const httpServer = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          ok: true,
          service: 'jwgb-match-m1',
          diagnostics: getDiagnostics(),
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const webSocketServer = new WebSocketServer({
    server: httpServer,
    path: '/match',
    perMessageDeflate: options.perMessageDeflate
      ? {
          threshold: 1_024,
          zlibDeflateOptions: { level: 3 },
          zlibInflateOptions: { chunkSize: 1_024 },
        }
      : false,
  });

  webSocketServer.on('connection', (socket: WebSocket) => {
    if (mode === 'shared') {
      socket.once('message', (data) => routeFirstMessage(socket, data));
      return;
    }
    socket.once('message', (data) => routeFirstMessage(socket, data));
  });

  return {
    httpServer,
    webSocketServer,
    room,
    listen(port: number, host = '127.0.0.1'): Promise<number> {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          const address = httpServer.address();
          if (!address || typeof address === 'string') {
            reject(new Error('server did not expose a TCP address'));
            return;
          }
          if (options.startRoomTimer !== false && mode === 'shared') {
            room.start();
          }
          resolve(address.port);
        });
      });
    },
    getDiagnostics,
    close(): Promise<void> {
      clearInterval(recycleTimer);
      matchmaking.dispose();
      room.dispose();
      for (const dynamicRoom of dynamicRooms) {
        dynamicRoom.dispose();
      }
      dynamicRooms.clear();
      for (const client of webSocketServer.clients) {
        client.close();
      }
      return new Promise((resolve, reject) => {
        webSocketServer.close(() => {
          httpServer.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      });
    },
  };

  function routeFirstMessage(socket: WebSocket, data: RawData): void {
    const routing = readRoutingMessage(data);
    if (routing.type.startsWith('matchmaking-')) {
      matchmaking.attach(socket, data);
      return;
    }
    if (routing.type === 'join' && routing.matchTicket !== null) {
      routeTicketJoin(socket, data);
      return;
    }
    if (requireMatchTicketForJoin && routing.type === 'join') {
      sendRoutingError(socket, 'MATCH_TICKET_REQUIRED', 'complete matchmaking before joining');
      socket.close(4005, 'match ticket required');
      return;
    }
    const targetRoom =
      mode === 'shared'
        ? room
        : mode === 'isolated'
          ? createDynamicRoom()
          : findRoomForRoutingMessage(routing);
    targetRoom.attach(socket, data);
    if (mode === 'isolated') {
      socket.once('close', () => {
        targetRoom.dispose();
        dynamicRooms.delete(targetRoom);
        roomIds.delete(targetRoom);
      });
    }
  }

  function routeTicketJoin(socket: WebSocket, data: RawData): void {
    try {
      const message = routingClientCodec.decode(rawDataToUint8Array(data));
      validateClientMessage(message);
      if (message.type !== 'join' || message.matchTicket === undefined) {
        throw new Error('match ticket join required');
      }
      if (message.rulesetVersion !== RULESET_VERSION) {
        sendRoutingError(socket, 'RULESET_MISMATCH', `server ruleset is ${RULESET_VERSION}`);
        socket.close(4004, 'ruleset mismatch');
        return;
      }
      const requestedPlayerId = playerId(message.playerId);
      const requestedHeroId = heroId(message.heroId);
      const assignment = matchmaking.consumeTicket(
        message.matchTicket,
        requestedPlayerId,
        requestedHeroId,
      );
      if (!assignment) {
        sendRoutingError(socket, 'MATCH_TICKET_REJECTED', 'the match ticket is invalid or expired');
        socket.close(4003, 'match ticket rejected');
        return;
      }
      assignment.room.attach(socket, data, assignment.reservation);
      if (!assignment.room.hasPlayerSession(requestedPlayerId)) {
        assignment.room.releaseJoinReservation(assignment.reservation.reservationId);
      }
    } catch (error) {
      sendRoutingError(
        socket,
        'BAD_MESSAGE',
        error instanceof Error ? error.message : 'bad join message',
      );
      socket.close(4000, 'bad join message');
    }
  }

  function sendRoutingError(socket: WebSocket, code: string, message: string): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }
    socket.send(
      routingServerCodec.encode({
        type: 'error',
        protocolVersion: PROTOCOL_VERSION,
        code,
        message,
      }),
    );
  }
}
