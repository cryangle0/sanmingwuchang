import { randomBytes } from 'node:crypto';
import { AUTHORITATIVE_HEROES, RULESET_VERSION } from '@jwgb/content';
import { type HeroId, heroId, type PlayerId, playerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
  validateClientMessage,
} from '@jwgb/protocol';
import type { RawData, WebSocket } from 'ws';
import type { AuthoritativeRoom, RoomJoinReservation } from '../room/authoritative-room';

const MATCHMAKING_CLIENT_TYPES = [
  'matchmaking-enqueue',
  'matchmaking-cancel',
  'matchmaking-reroll',
  'matchmaking-select',
] as const;
const MATCHMAKING_SERVER_TYPES = [
  'matchmaking-queued',
  'matchmaking-selection',
  'matchmaking-assigned',
  'matchmaking-cancelled',
  'error',
] as const;
const clientCodec = new JsonMessageCodec<ClientMessage>(MATCHMAKING_CLIENT_TYPES);
const serverCodec = new JsonMessageCodec<ServerMessage>(MATCHMAKING_SERVER_TYPES);

export const DEFAULT_MATCHMAKING_SELECTION_DELAY_MS = 1_400;
export const DEFAULT_MATCHMAKING_SELECTION_DURATION_MS = 15_000;
export const DEFAULT_MATCHMAKING_TICKET_TTL_MS = 30_000;
export const DEFAULT_MATCHMAKING_INITIAL_GOLD = 500;
export const DEFAULT_MATCHMAKING_REROLL_COST = 250;

export interface MatchmakingRoomTarget {
  readonly roomId: string;
  readonly room: AuthoritativeRoom;
}

export interface MatchmakingCoordinatorOptions {
  readonly findRoom: (playerId: PlayerId, heroId: HeroId) => MatchmakingRoomTarget | null;
  readonly selectionDelayMs?: number;
  readonly selectionDurationMs?: number;
  readonly ticketTtlMs?: number;
  readonly initialMatchGold?: number;
  readonly rerollCost?: number;
}

export interface MatchmakingTicketAssignment {
  readonly matchId: string;
  readonly ticket: string;
  readonly playerId: PlayerId;
  readonly heroId: HeroId;
  readonly roomId: string;
  readonly room: AuthoritativeRoom;
  readonly reservation: RoomJoinReservation;
  readonly expiresAtMs: number;
}

export interface MatchmakingDiagnostics {
  readonly queuedCount: number;
  readonly selectingCount: number;
  readonly assignedCount: number;
  readonly activeTicketCount: number;
}

type MatchmakingState = 'queued' | 'selecting' | 'assigned' | 'consumed' | 'cancelled';

interface MatchEntry {
  readonly socket: WebSocket;
  readonly queueId: string;
  readonly playerId: PlayerId;
  readonly queuedAtMs: number;
  state: MatchmakingState;
  matchId: string | null;
  offers: readonly HeroId[];
  recommendedHeroId: HeroId | null;
  selectedHeroId: HeroId | null;
  matchGold: number;
  rerollCount: number;
  selectionDeadlineMs: number | null;
  selectionTimer: ReturnType<typeof setTimeout> | null;
  ticket: string | null;
}

interface StoredTicket extends MatchmakingTicketAssignment {
  readonly expiresTimer: ReturnType<typeof setTimeout>;
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

function credential(): string {
  return randomBytes(24).toString('base64url');
}

function hashOfferKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function offerScore(hero: HeroId, seed: string): number {
  let value = hashOfferKey(`${seed}:${hero}`) ^ hashOfferKey(hero);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function heroOffers(seed: string, count = 3): readonly HeroId[] {
  return AUTHORITATIVE_HEROES.map((record) => heroId(record.id))
    .sort((left, right) => {
      const difference = offerScore(left, seed) - offerScore(right, seed);
      return difference || left.localeCompare(right);
    })
    .slice(0, count);
}

function recommendedHero(offers: readonly HeroId[]): HeroId | null {
  return (
    [...offers].sort((left, right) => {
      const difference = hashOfferKey(`recommend:${right}`) - hashOfferKey(`recommend:${left}`);
      return difference || left.localeCompare(right);
    })[0] ?? null
  );
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === socket.OPEN;
}

export class MatchmakingCoordinator {
  private readonly entriesBySocket = new Map<WebSocket, MatchEntry>();
  private readonly entriesByPlayer = new Map<PlayerId, MatchEntry>();
  private readonly tickets = new Map<string, StoredTicket>();
  private readonly selectionDelayMs: number;
  private readonly selectionDurationMs: number;
  private readonly ticketTtlMs: number;
  private readonly initialMatchGold: number;
  private readonly rerollCost: number;
  private disposed = false;

  constructor(private readonly options: MatchmakingCoordinatorOptions) {
    this.selectionDelayMs = options.selectionDelayMs ?? DEFAULT_MATCHMAKING_SELECTION_DELAY_MS;
    this.selectionDurationMs =
      options.selectionDurationMs ?? DEFAULT_MATCHMAKING_SELECTION_DURATION_MS;
    this.ticketTtlMs = options.ticketTtlMs ?? DEFAULT_MATCHMAKING_TICKET_TTL_MS;
    this.initialMatchGold = options.initialMatchGold ?? DEFAULT_MATCHMAKING_INITIAL_GOLD;
    this.rerollCost = options.rerollCost ?? DEFAULT_MATCHMAKING_REROLL_COST;
  }

  attach(socket: WebSocket, initialMessage?: RawData): void {
    if (this.disposed) {
      socket.close(1012, 'matchmaking is shutting down');
      return;
    }
    const handleMessage = (data: RawData): void => {
      this.handleMessage(socket, data);
    };
    socket.on('message', handleMessage);
    socket.once('close', () => this.handleClose(socket));
    if (initialMessage !== undefined) {
      this.handleMessage(socket, initialMessage);
    }
  }

  getDiagnostics(): MatchmakingDiagnostics {
    let queuedCount = 0;
    let selectingCount = 0;
    let assignedCount = 0;
    for (const entry of this.entriesByPlayer.values()) {
      if (entry.state === 'queued') {
        queuedCount += 1;
      } else if (entry.state === 'selecting') {
        selectingCount += 1;
      } else if (entry.state === 'assigned') {
        assignedCount += 1;
      }
    }
    return {
      queuedCount,
      selectingCount,
      assignedCount,
      activeTicketCount: this.tickets.size,
    };
  }

  consumeTicket(
    ticket: string,
    requestedPlayerId: PlayerId,
    requestedHeroId: HeroId,
  ): MatchmakingTicketAssignment | null {
    const stored = this.tickets.get(ticket);
    if (!stored || stored.expiresAtMs <= Date.now()) {
      if (stored) {
        this.releaseTicket(ticket, 'expired');
      }
      return null;
    }
    if (stored.playerId !== requestedPlayerId || stored.heroId !== requestedHeroId) {
      return null;
    }
    clearTimeout(stored.expiresTimer);
    this.tickets.delete(ticket);
    const entry = this.entriesByPlayer.get(stored.playerId);
    if (entry) {
      entry.state = 'consumed';
      this.entriesByPlayer.delete(stored.playerId);
      this.entriesBySocket.delete(entry.socket);
    }
    return stored;
  }

  cancelTicket(ticket: string): boolean {
    return this.releaseTicket(ticket, 'client');
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const entry of this.entriesByPlayer.values()) {
      this.clearSelectionTimer(entry);
      entry.state = 'cancelled';
    }
    for (const [ticket] of this.tickets) {
      this.releaseTicket(ticket, 'server');
    }
    this.entriesByPlayer.clear();
    this.entriesBySocket.clear();
  }

  private handleMessage(socket: WebSocket, data: RawData): void {
    try {
      const message = clientCodec.decode(rawDataToUint8Array(data));
      validateClientMessage(message);
      switch (message.type) {
        case 'matchmaking-enqueue':
          this.handleEnqueue(socket, message);
          break;
        case 'matchmaking-cancel':
          this.handleCancel(socket);
          break;
        case 'matchmaking-reroll':
          this.handleReroll(socket, message);
          break;
        case 'matchmaking-select':
          this.handleSelect(socket, message);
          break;
      }
    } catch (error) {
      this.sendError(
        socket,
        'BAD_MATCHMAKING_MESSAGE',
        error instanceof Error ? error.message : 'bad matchmaking message',
      );
    }
  }

  private handleEnqueue(
    socket: WebSocket,
    message: Extract<ClientMessage, { readonly type: 'matchmaking-enqueue' }>,
  ): void {
    if (this.entriesBySocket.has(socket)) {
      this.sendError(socket, 'MATCHMAKING_ALREADY_QUEUED', 'socket is already in matchmaking');
      return;
    }
    if (message.rulesetVersion !== RULESET_VERSION) {
      this.sendError(socket, 'RULESET_MISMATCH', `server ruleset is ${RULESET_VERSION}`);
      return;
    }
    if (message.playerId.startsWith('__jwgb_bot_')) {
      this.sendError(socket, 'INVALID_PLAYER_ID', 'reserved player id');
      return;
    }
    const requestedPlayerId = playerId(message.playerId);
    if (this.entriesByPlayer.has(requestedPlayerId)) {
      this.sendError(socket, 'MATCHMAKING_ALREADY_QUEUED', 'player is already matchmaking');
      return;
    }
    const entry: MatchEntry = {
      socket,
      queueId: credential(),
      playerId: requestedPlayerId,
      queuedAtMs: Date.now(),
      state: 'queued',
      matchId: null,
      offers: [],
      recommendedHeroId: null,
      selectedHeroId: null,
      matchGold: this.initialMatchGold,
      rerollCount: 0,
      selectionDeadlineMs: null,
      selectionTimer: null,
      ticket: null,
    };
    this.entriesBySocket.set(socket, entry);
    this.entriesByPlayer.set(requestedPlayerId, entry);
    this.broadcastQueuePositions();
    entry.selectionTimer = setTimeout(() => {
      entry.selectionTimer = null;
      this.beginSelection(entry);
    }, this.selectionDelayMs);
    entry.selectionTimer.unref?.();
  }

  private handleCancel(socket: WebSocket): void {
    const entry = this.entriesBySocket.get(socket);
    if (!entry) {
      this.sendError(socket, 'MATCHMAKING_NOT_FOUND', 'no active matchmaking request');
      return;
    }
    if (entry.state === 'assigned' && entry.ticket !== null) {
      this.releaseTicket(entry.ticket, 'client');
      return;
    }
    this.cancelEntry(entry, true);
  }

  private handleReroll(
    socket: WebSocket,
    message: Extract<ClientMessage, { readonly type: 'matchmaking-reroll' }>,
  ): void {
    const entry = this.entriesBySocket.get(socket);
    if (entry?.state !== 'selecting' || entry.matchId !== message.matchId) {
      this.sendError(socket, 'MATCHMAKING_NOT_FOUND', 'selection is no longer active');
      return;
    }
    if (entry.matchGold < this.rerollCost) {
      this.sendError(socket, 'MATCHMAKING_INSUFFICIENT_GOLD', 'not enough match gold');
      return;
    }
    entry.matchGold -= this.rerollCost;
    entry.rerollCount += 1;
    entry.selectedHeroId = null;
    entry.offers = heroOffers(`${entry.matchId}:reroll:${entry.rerollCount}`);
    entry.recommendedHeroId = recommendedHero(entry.offers);
    entry.selectionDeadlineMs = Date.now() + this.selectionDurationMs;
    this.sendSelection(entry);
    this.clearSelectionTimer(entry);
    entry.selectionTimer = setTimeout(() => {
      entry.selectionTimer = null;
      this.assign(entry, entry.selectedHeroId ?? entry.recommendedHeroId ?? entry.offers[0]);
    }, this.selectionDurationMs);
    entry.selectionTimer.unref?.();
  }

  private handleSelect(
    socket: WebSocket,
    message: Extract<ClientMessage, { readonly type: 'matchmaking-select' }>,
  ): void {
    const entry = this.entriesBySocket.get(socket);
    if (entry?.state !== 'selecting' || entry.matchId !== message.matchId) {
      this.sendError(socket, 'MATCHMAKING_NOT_FOUND', 'selection is no longer active');
      return;
    }
    if (!entry.offers.includes(message.heroId)) {
      this.sendError(
        socket,
        'MATCHMAKING_HERO_NOT_OFFERED',
        'hero is not in the current offer set',
      );
      return;
    }
    entry.selectedHeroId = message.heroId;
    this.assign(entry, message.heroId);
  }

  private beginSelection(entry: MatchEntry): void {
    if (this.disposed || entry.state !== 'queued') {
      return;
    }
    entry.state = 'selecting';
    entry.matchId = credential();
    entry.offers = heroOffers(entry.matchId);
    entry.recommendedHeroId = recommendedHero(entry.offers);
    entry.selectedHeroId = null;
    entry.selectionDeadlineMs = Date.now() + this.selectionDurationMs;
    this.sendSelection(entry);
    entry.selectionTimer = setTimeout(() => {
      entry.selectionTimer = null;
      this.assign(entry, entry.selectedHeroId ?? entry.recommendedHeroId ?? entry.offers[0]);
    }, this.selectionDurationMs);
    entry.selectionTimer.unref?.();
  }

  private assign(entry: MatchEntry, selectedHeroId: HeroId | undefined): void {
    if (
      this.disposed ||
      entry.state !== 'selecting' ||
      entry.matchId === null ||
      selectedHeroId === undefined
    ) {
      return;
    }
    const target = this.options.findRoom(entry.playerId, selectedHeroId);
    const reservationId = target?.room.reserveJoin(entry.playerId, selectedHeroId) ?? null;
    if (!target || reservationId === null) {
      this.cancelEntry(entry, true);
      return;
    }
    this.clearSelectionTimer(entry);
    const ticket = credential();
    const expiresAtMs = Date.now() + this.ticketTtlMs;
    const reservation: RoomJoinReservation = {
      reservationId,
      playerId: entry.playerId,
      heroId: selectedHeroId,
    };
    const expiresTimer = setTimeout(() => {
      this.releaseTicket(ticket, 'expired');
    }, this.ticketTtlMs);
    expiresTimer.unref?.();
    const stored: StoredTicket = {
      matchId: entry.matchId,
      ticket,
      playerId: entry.playerId,
      heroId: selectedHeroId,
      roomId: target.roomId,
      room: target.room,
      reservation,
      expiresAtMs,
      expiresTimer,
    };
    this.tickets.set(ticket, stored);
    entry.state = 'assigned';
    entry.ticket = ticket;
    entry.selectedHeroId = selectedHeroId;
    this.send(entry.socket, {
      type: 'matchmaking-assigned',
      protocolVersion: PROTOCOL_VERSION,
      matchId: entry.matchId,
      heroId: selectedHeroId,
      matchTicket: ticket,
      ticketExpiresAtMs: expiresAtMs,
      roomId: target.roomId,
    });
  }

  private releaseTicket(
    ticket: string,
    reason: Extract<ServerMessage, { readonly type: 'matchmaking-cancelled' }>['reason'],
  ): boolean {
    const stored = this.tickets.get(ticket);
    if (!stored) {
      return false;
    }
    clearTimeout(stored.expiresTimer);
    this.tickets.delete(ticket);
    stored.room.releaseJoinReservation(stored.reservation.reservationId);
    const entry = this.entriesByPlayer.get(stored.playerId);
    if (entry) {
      entry.state = 'cancelled';
      entry.ticket = null;
      this.entriesByPlayer.delete(stored.playerId);
      this.entriesBySocket.delete(entry.socket);
      if (isOpen(entry.socket)) {
        this.send(entry.socket, {
          type: 'matchmaking-cancelled',
          protocolVersion: PROTOCOL_VERSION,
          reason,
        });
      }
    }
    return true;
  }

  private cancelEntry(entry: MatchEntry, notify: boolean): void {
    this.clearSelectionTimer(entry);
    entry.state = 'cancelled';
    this.entriesByPlayer.delete(entry.playerId);
    this.entriesBySocket.delete(entry.socket);
    if (notify && isOpen(entry.socket)) {
      this.send(entry.socket, {
        type: 'matchmaking-cancelled',
        protocolVersion: PROTOCOL_VERSION,
        reason: 'client',
      });
    }
    this.broadcastQueuePositions();
  }

  private handleClose(socket: WebSocket): void {
    const entry = this.entriesBySocket.get(socket);
    if (!entry) {
      return;
    }
    this.entriesBySocket.delete(socket);
    if (entry.state === 'queued' || entry.state === 'selecting') {
      this.clearSelectionTimer(entry);
      entry.state = 'cancelled';
      this.entriesByPlayer.delete(entry.playerId);
      this.broadcastQueuePositions();
    }
  }

  private broadcastQueuePositions(): void {
    const queued = [...this.entriesByPlayer.values()]
      .filter((entry) => entry.state === 'queued')
      .sort((left, right) => left.queuedAtMs - right.queuedAtMs);
    queued.forEach((entry, index) => {
      this.send(entry.socket, {
        type: 'matchmaking-queued',
        protocolVersion: PROTOCOL_VERSION,
        queueId: entry.queueId,
        queuePosition: index + 1,
        serverTime: Date.now(),
      });
    });
  }

  private sendSelection(entry: MatchEntry): void {
    if (entry.matchId === null || !isOpen(entry.socket)) {
      return;
    }
    this.send(entry.socket, {
      type: 'matchmaking-selection',
      protocolVersion: PROTOCOL_VERSION,
      matchId: entry.matchId,
      offers: entry.offers,
      recommendedHeroId: entry.recommendedHeroId,
      selectionRemainingMs: Math.max(0, (entry.selectionDeadlineMs ?? Date.now()) - Date.now()),
      matchGold: entry.matchGold,
      rerollCount: entry.rerollCount,
      selectedHeroId: entry.selectedHeroId,
    });
  }

  private clearSelectionTimer(entry: MatchEntry): void {
    if (entry.selectionTimer !== null) {
      clearTimeout(entry.selectionTimer);
      entry.selectionTimer = null;
    }
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.send(socket, {
      type: 'error',
      protocolVersion: PROTOCOL_VERSION,
      code,
      message,
    });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (!isOpen(socket)) {
      return;
    }
    socket.send(serverCodec.encode(message));
  }
}
