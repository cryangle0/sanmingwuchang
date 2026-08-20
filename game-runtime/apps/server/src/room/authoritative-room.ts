import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AUTHORITATIVE_HEROES, M0_SPAWN_POINTS, RULESET_VERSION } from '@jwgb/content';
import {
  assertSafeInteger,
  createPlayerIntent,
  type EntityId,
  entityId,
  equipmentInstanceId,
  heroId,
  invariant,
  type PlayerId,
  playerId,
  TICK_DURATION_MS,
} from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
  validateClientMessage,
} from '@jwgb/protocol';
import type {
  MapSimulationOptions,
  PveSimulationOptions,
  StaticSolidRect,
  WorldSnapshot,
} from '@jwgb/sim';
import {
  type ActiveReplacementTransactionCode,
  type AirdropTransactionCode,
  type EquipmentLootPickupTransactionCode,
  type EquipmentTransactionCode,
  type GambleTransactionCode,
  GameSimulation,
  type PassiveTransactionCode,
  type ShopTransactionCode,
} from '@jwgb/sim';
import type { RawData, WebSocket } from 'ws';
import { createBotIntent } from './bot-controller';

interface ClientSession {
  readonly socket: WebSocket;
  playerSession: PlayerNetworkSession | null;
  staticWorldSent: boolean;
}

export interface RoomJoinReservation {
  readonly reservationId: string;
  readonly playerId: PlayerId;
  readonly heroId: ReturnType<typeof heroId>;
}

interface StoredJoinReservation extends RoomJoinReservation {
  readonly createdAtMs: number;
}

type PlayerSessionState = 'connected' | 'disconnected' | 'bot-takeover' | 'expired';
type PlayerController = 'player' | 'bot';
type BotDifficulty = 'D2';

interface PlayerNetworkSession {
  readonly entityId: EntityId;
  readonly playerId: PlayerId;
  recoveryTokenHash: Buffer;
  readonly recoverable: boolean;
  connection: ClientSession | null;
  state: PlayerSessionState;
  controller: PlayerController;
  readonly botDifficulty: BotDifficulty | null;
  acknowledgedInputSequence: number;
  resumeDeadlineMs: number | null;
  lastValidInputAtMs: number;
  pendingSnapshotAck: { readonly snapshotTick: number; readonly stateHash: string } | null;
  pendingPlayerControl: boolean;
  pendingPlayerIntent: ReturnType<typeof createPlayerIntent> | null;
  takeoverTimer: ReturnType<typeof setTimeout> | null;
  inactivityTimer: ReturnType<typeof setTimeout> | null;
  expirationTimer: ReturnType<typeof setTimeout> | null;
  readonly transactionResponses: Map<
    string,
    Extract<ServerMessage, { type: 'transaction-result' }>
  >;
}

export const DEFAULT_RESUME_GRACE_PERIOD_MS = 120_000;
export const DEFAULT_BOT_TAKEOVER_DELAY_MS = 3_000;
export const DEFAULT_AFK_TAKEOVER_MS = 90_000;
const LOBBY_BOT_DECISION_INTERVAL_TICKS = 10;
const MAX_TIMER_CATCH_UP_TICKS = 4;
const MAX_TIMER_LAG_MS = 1_000;
export const DEFAULT_LOBBY_FILL_WAIT_MS = 20_000;

export interface AuthoritativeRoomOptions {
  readonly resumeGracePeriodMs?: number;
  readonly botTakeoverDelayMs?: number;
  readonly afkTakeoverMs?: number;
  readonly lobbyFillWaitMs?: number;
  readonly enableBots?: boolean;
  readonly pve?: PveSimulationOptions;
  readonly staticSolids?: readonly StaticSolidRect[];
  readonly map?: MapSimulationOptions;
  readonly fullVisibility?: boolean;
}

export interface PlayerSessionView {
  readonly entityId: EntityId;
  readonly state: PlayerSessionState;
  readonly controller: PlayerController;
  readonly botDifficulty: BotDifficulty | null;
  readonly acknowledgedInputSequence: number;
  readonly resumeDeadlineMs: number | null;
  readonly awaitingSnapshotAck: boolean;
}

export interface RoomNetworkDiagnostics {
  readonly messagesSent: number;
  readonly bytesSent: number;
  readonly snapshotsSent: number;
  readonly snapshotBytesSent: number;
  readonly maximumSnapshotBytes: number;
  readonly eventsSent: number;
  readonly eventBytesSent: number;
  readonly transactionResultsSent: number;
  readonly transactionResultBytesSent: number;
}

export interface RoomLifecycleDiagnostics {
  readonly tick: number;
  readonly createdAtMs: number;
  readonly lastActivityAtMs: number;
  readonly acceptingJoins: boolean;
  readonly connectionCount: number;
  readonly playerSessionCount: number;
  readonly activeRecoverableSessionCount: number;
  readonly authoritativePlayerCount: number;
  readonly reservedJoinCount: number;
  readonly authoritativeMonsterCount: number;
  readonly maximumAuthoritativeMonsterCount: number;
  readonly matchStatus: ReturnType<GameSimulation['getSnapshot']>['match']['status'];
  readonly lobbyComplete: boolean;
  readonly fullVisibility: boolean;
  readonly network: RoomNetworkDiagnostics;
}

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
  'active-loot-replace',
  'equipment-loot-pickup',
  'equipment-equip',
  'equipment-unequip',
  'equipment-discard',
  'airdrop-open',
  'hero-swap',
  'gamble-passive',
  'gamble-equipment',
  'gamble-active',
  'gamble-gold',
]);
const serverCodec = new JsonMessageCodec<ServerMessage>([
  'joined',
  'snapshot',
  'events',
  'pong',
  'transaction-result',
  'error',
]);

type TransactionCode =
  | AirdropTransactionCode
  | ActiveReplacementTransactionCode
  | EquipmentLootPickupTransactionCode
  | ShopTransactionCode
  | PassiveTransactionCode
  | EquipmentTransactionCode
  | GambleTransactionCode;

const SHOP_TRANSACTION_MESSAGES: Readonly<Record<TransactionCode, string>> = {
  accepted: 'transaction accepted',
  'match-finished': 'match is already finished',
  'shop-unavailable': 'shop is not open or does not exist',
  'shop-version-mismatch': 'shop inventory has rotated',
  'shop-closed': 'shop is closed',
  'shop-too-far': 'player is too far from the shop',
  'player-not-alive': 'player is not alive',
  'pvp-combat-lock': 'trading is disabled during PVP combat',
  'insufficient-gold': 'not enough gold',
  'listing-not-found': 'listing is no longer available',
  'equipment-capacity': 'equipment destination has no legal capacity',
  'invalid-destination': 'equipment destination is invalid',
  'unsupported-sale-shop': 'this shop does not buy equipment',
  'equipment-not-found': 'equipment instance was not found',
  'equipment-not-eligible': 'only white, blue, or purple equipment can be gambled',
  'no-gems': 'no gems are available',
  'passive-not-learned': 'the passive is not learned',
  'passive-maxed': 'the passive is already level 5',
  'loot-not-found': 'the ground item is no longer available',
  'loot-not-skill-book': 'the ground item is not a skill book',
  'skill-book-too-far': 'the skill book is too far away',
  'skill-book-line-of-sight': 'the skill book is blocked from view',
  'invalid-replacement': 'the selected passive replacement is invalid',
  'hand-full': 'the equipment hand has no free slot',
  'equipped-full': 'all equipped slots are occupied',
  'duplicate-equipped': 'the same equipment cannot be equipped twice',
  'replacement-required': 'an equipped instance must be selected for replacement',
  'unsupported-service-shop': 'this shop does not provide that service',
  'service-cooldown': 'this service is still on cooldown',
  'channel-active': 'the service channel is already active',
  'gamble-limit': 'the gambling limit has been reached',
  'invalid-wager': 'the wager is invalid',
  'airdrop-not-found': 'the airdrop does not exist',
  'airdrop-not-available': 'the airdrop is not available yet',
  'airdrop-expired': 'the airdrop is already gone',
  'airdrop-too-far': 'the player is too far from the airdrop',
  'airdrop-line-of-sight': 'the airdrop is blocked from view',
  'active-replacement-not-found': 'the active replacement prompt is no longer available',
  'active-loot-not-found': 'the active ground item is no longer available',
  'active-loot-too-far': 'the active ground item is too far away',
  'active-loot-line-of-sight': 'the active ground item is blocked from view',
  'active-already-equipped': 'that active is already equipped',
  'active-changed': 'the active replacement changed before confirmation',
  'active-replacement-declined': 'active replacement declined',
  'equipment-loot-not-found': 'the equipment ground item is no longer available',
  'equipment-loot-too-far': 'the equipment ground item is too far away',
  'equipment-loot-line-of-sight': 'the equipment ground item is blocked from view',
  'equipment-pickup-not-found': 'the equipment pickup prompt is no longer available',
  'equipment-pickup-declined': 'equipment pickup declined',
  'equipment-changed': 'the equipment ground item changed before confirmation',
};

function rawDataToUint8Array(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function createRecoveryToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashRecoveryToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function recoveryTokenMatches(token: string, expectedHash: Buffer): boolean {
  const candidateHash = hashRecoveryToken(token);
  return (
    candidateHash.byteLength === expectedHash.byteLength &&
    timingSafeEqual(candidateHash, expectedHash)
  );
}

export class AuthoritativeRoom {
  private readonly simulation: GameSimulation;
  private readonly connections = new Set<ClientSession>();
  private readonly playerSessions = new Map<PlayerId, PlayerNetworkSession>();
  private readonly joinReservations = new Map<string, StoredJoinReservation>();
  private readonly resumeGracePeriodMs: number;
  private readonly botTakeoverDelayMs: number;
  private readonly afkTakeoverMs: number;
  private readonly lobbyFillWaitMs: number;
  private readonly enableBots: boolean;
  private readonly fullVisibility: boolean;
  private readonly createdAtMs = Date.now();
  private lastActivityAtMs = this.createdAtMs;
  private messagesSent = 0;
  private bytesSent = 0;
  private snapshotsSent = 0;
  private snapshotBytesSent = 0;
  private maximumSnapshotBytes = 0;
  private eventsSent = 0;
  private eventBytesSent = 0;
  private transactionResultsSent = 0;
  private transactionResultBytesSent = 0;
  private maximumAuthoritativeMonsterCount: number;
  private lobbyFillTimer: ReturnType<typeof setTimeout> | null = null;
  private lobbyComplete: boolean;
  private nextBotIndex = 0;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTickAtMs = 0;
  private lastBroadcastSnapshotTick = -1;
  private disposed = false;

  constructor(rootSeed: number, options: AuthoritativeRoomOptions = {}) {
    this.simulation = new GameSimulation({
      rootSeed,
      ...(options.pve ? { pve: options.pve } : {}),
      ...(options.staticSolids ? { staticSolids: options.staticSolids } : {}),
      ...(options.map ? { map: options.map } : {}),
    });
    this.resumeGracePeriodMs = options.resumeGracePeriodMs ?? DEFAULT_RESUME_GRACE_PERIOD_MS;
    this.botTakeoverDelayMs = options.botTakeoverDelayMs ?? DEFAULT_BOT_TAKEOVER_DELAY_MS;
    this.afkTakeoverMs = options.afkTakeoverMs ?? DEFAULT_AFK_TAKEOVER_MS;
    this.lobbyFillWaitMs = options.lobbyFillWaitMs ?? 0;
    this.enableBots = options.enableBots ?? false;
    this.fullVisibility = options.fullVisibility ?? false;
    this.maximumAuthoritativeMonsterCount = this.simulation.monsterCount;
    this.lobbyComplete = !this.enableBots;
    assertSafeInteger(this.resumeGracePeriodMs, 'resumeGracePeriodMs');
    assertSafeInteger(this.botTakeoverDelayMs, 'botTakeoverDelayMs');
    assertSafeInteger(this.afkTakeoverMs, 'afkTakeoverMs');
    assertSafeInteger(this.lobbyFillWaitMs, 'lobbyFillWaitMs');
    invariant(this.resumeGracePeriodMs > 0, 'resumeGracePeriodMs must be positive');
    invariant(this.botTakeoverDelayMs >= 0, 'botTakeoverDelayMs must be non-negative');
    invariant(this.afkTakeoverMs > 0, 'afkTakeoverMs must be positive');
    invariant(this.lobbyFillWaitMs >= 0, 'lobbyFillWaitMs must be non-negative');
  }

  start(): void {
    invariant(!this.disposed, 'cannot start a disposed room');
    if (this.tickTimer !== null) {
      return;
    }
    this.nextTickAtMs = performance.now() + TICK_DURATION_MS;
    this.tickTimer = setTimeout(this.runScheduledTicks, TICK_DURATION_MS);
  }

  stop(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    if (this.lobbyFillTimer !== null) {
      clearTimeout(this.lobbyFillTimer);
      this.lobbyFillTimer = null;
    }
    this.joinReservations.clear();
    for (const playerSession of this.playerSessions.values()) {
      this.clearTakeoverTimer(playerSession);
      this.clearInactivityTimer(playerSession);
      this.clearExpirationTimer(playerSession);
    }
  }

  attach(socket: WebSocket, initialMessage?: RawData, reservation?: RoomJoinReservation): void {
    if (this.disposed) {
      socket.close(1012, 'room is shutting down');
      return;
    }
    const session: ClientSession = {
      socket,
      playerSession: null,
      staticWorldSent: false,
    };
    this.connections.add(session);
    this.lastActivityAtMs = Date.now();

    socket.on('message', (data) => this.handleMessage(session, data));
    socket.on('close', () => this.handleClose(session));
    if (initialMessage !== undefined) {
      this.handleMessage(session, initialMessage, reservation);
    }
  }

  readonly step = (): void => {
    if (this.enableBots && !this.lobbyComplete) {
      return;
    }
    this.activatePendingPlayerControls();
    this.driveBots();
    this.simulation.step();
    this.maximumAuthoritativeMonsterCount = Math.max(
      this.maximumAuthoritativeMonsterCount,
      this.simulation.monsterCount,
    );
    const events = this.simulation.drainEvents();
    const matchEnded = events.some((event) => event.type === 'match-ended');
    let sharedSnapshot: WorldSnapshot | null = null;
    const currentSnapshot = (): WorldSnapshot => {
      sharedSnapshot ??= this.simulation.getSnapshot();
      return sharedSnapshot;
    };
    if (events.length > 0) {
      for (const session of this.connections) {
        const playerSession = session.playerSession;
        if (playerSession === null) {
          continue;
        }
        const observerEvents = this.simulation.getObserverEvents(
          playerSession.entityId,
          events,
          currentSnapshot(),
        );
        if (observerEvents.length > 0) {
          this.send(session, {
            type: 'events',
            protocolVersion: PROTOCOL_VERSION,
            events: observerEvents,
          });
        }
      }
    }

    if (
      this.simulation.tick !== this.lastBroadcastSnapshotTick &&
      (this.simulation.tick % 2 === 0 || matchEnded)
    ) {
      for (const session of this.connections) {
        const playerSession = session.playerSession;
        if (playerSession === null) {
          continue;
        }
        this.sendSnapshot(
          session,
          playerSession,
          this.snapshotFor(playerSession.entityId, currentSnapshot()),
        );
      }
      this.lastBroadcastSnapshotTick = this.simulation.tick;
    }
  };

  getSnapshot() {
    return this.simulation.getSnapshot();
  }

  hasPlayerSession(player: PlayerId): boolean {
    return this.playerSessions.has(player);
  }

  hasActivePlayerSession(player: PlayerId): boolean {
    const session = this.playerSessions.get(player);
    return session !== undefined && session.state !== 'expired';
  }

  canAcceptJoin(): boolean {
    return (
      !this.disposed &&
      this.simulation.playerCount + this.joinReservations.size < M0_SPAWN_POINTS.length &&
      (!this.enableBots || !this.lobbyComplete)
    );
  }

  canReserveJoin(): boolean {
    return (
      !this.disposed &&
      this.simulation.playerCount + this.joinReservations.size < M0_SPAWN_POINTS.length &&
      (!this.enableBots || !this.lobbyComplete)
    );
  }

  reserveJoin(player: PlayerId, selectedHeroId: ReturnType<typeof heroId>): string | null {
    if (!this.canReserveJoin()) {
      return null;
    }
    const reservationId = randomBytes(18).toString('base64url');
    this.joinReservations.set(reservationId, {
      reservationId,
      playerId: player,
      heroId: selectedHeroId,
      createdAtMs: Date.now(),
    });
    return reservationId;
  }

  releaseJoinReservation(reservationId: string): boolean {
    const released = this.joinReservations.delete(reservationId);
    if (
      released &&
      this.enableBots &&
      !this.lobbyComplete &&
      this.simulation.playerCount > 0 &&
      this.lobbyFillTimer === null
    ) {
      this.completeLobbyWithBots();
    }
    return released;
  }

  claimJoinReservation(
    reservationId: string,
    player: PlayerId,
    selectedHeroId: ReturnType<typeof heroId>,
  ): boolean {
    const reservation = this.joinReservations.get(reservationId);
    if (!reservation || reservation.playerId !== player || reservation.heroId !== selectedHeroId) {
      return false;
    }
    this.joinReservations.delete(reservationId);
    return true;
  }

  canRecycle(): boolean {
    if (this.connections.size > 0) {
      return false;
    }
    if (this.joinReservations.size > 0) {
      return false;
    }
    return ![...this.playerSessions.values()].some(
      (session) => session.recoverable && session.state !== 'expired',
    );
  }

  getNetworkDiagnostics(): RoomNetworkDiagnostics {
    return {
      messagesSent: this.messagesSent,
      bytesSent: this.bytesSent,
      snapshotsSent: this.snapshotsSent,
      snapshotBytesSent: this.snapshotBytesSent,
      maximumSnapshotBytes: this.maximumSnapshotBytes,
      eventsSent: this.eventsSent,
      eventBytesSent: this.eventBytesSent,
      transactionResultsSent: this.transactionResultsSent,
      transactionResultBytesSent: this.transactionResultBytesSent,
    };
  }

  getLifecycleDiagnostics(): RoomLifecycleDiagnostics {
    return {
      tick: this.simulation.tick,
      createdAtMs: this.createdAtMs,
      lastActivityAtMs: this.lastActivityAtMs,
      acceptingJoins: this.canAcceptJoin(),
      connectionCount: this.connections.size,
      playerSessionCount: this.playerSessions.size,
      activeRecoverableSessionCount: [...this.playerSessions.values()].filter(
        (session) => session.recoverable && session.state !== 'expired',
      ).length,
      authoritativePlayerCount: this.simulation.playerCount,
      reservedJoinCount: this.joinReservations.size,
      authoritativeMonsterCount: this.simulation.monsterCount,
      maximumAuthoritativeMonsterCount: this.maximumAuthoritativeMonsterCount,
      matchStatus: this.simulation.matchStatus,
      lobbyComplete: this.lobbyComplete,
      fullVisibility: this.fullVisibility,
      network: this.getNetworkDiagnostics(),
    };
  }

  getPlayerSession(player: PlayerId): PlayerSessionView | null {
    const session = this.playerSessions.get(player);
    if (!session) {
      return null;
    }
    return {
      entityId: session.entityId,
      state: session.state,
      controller: session.controller,
      botDifficulty: session.botDifficulty,
      acknowledgedInputSequence: session.acknowledgedInputSequence,
      resumeDeadlineMs: session.resumeDeadlineMs,
      awaitingSnapshotAck: session.pendingSnapshotAck !== null,
    };
  }

  private handleMessage(
    session: ClientSession,
    data: RawData,
    reservation?: RoomJoinReservation,
  ): void {
    this.lastActivityAtMs = Date.now();
    try {
      const message = clientCodec.decode(rawDataToUint8Array(data));
      validateClientMessage(message);
      if (
        session.playerSession !== null &&
        message.type !== 'join' &&
        message.type !== 'resume' &&
        message.type !== 'snapshot-ack' &&
        message.type !== 'input' &&
        message.type !== 'ping' &&
        !this.canAcceptPlayerCommands(session.playerSession)
      ) {
        return;
      }
      switch (message.type) {
        case 'join':
          this.handleJoin(session, message, reservation);
          break;
        case 'resume':
          this.handleResume(session, message);
          break;
        case 'snapshot-ack':
          this.handleSnapshotAck(session, message);
          break;
        case 'airdrop-open':
          this.handleAirdropOpen(session, message);
          break;
        case 'input':
          this.handleInput(session, message);
          break;
        case 'ping':
          this.send(session, {
            type: 'pong',
            protocolVersion: PROTOCOL_VERSION,
            clientTime: message.clientTime,
            serverTime: Date.now(),
          });
          break;
        case 'shop-purchase':
          this.handleShopPurchase(session, message);
          break;
        case 'shop-sale':
          this.handleShopSale(session, message);
          break;
        case 'hero-swap':
          this.handleHeroSwap(session, message);
          break;
        case 'gamble-passive':
          this.handleGamblePassive(session, message);
          break;
        case 'gamble-equipment':
          this.handleGambleEquipment(session, message);
          break;
        case 'gamble-active':
          this.handleGambleActive(session, message);
          break;
        case 'gamble-gold':
          this.handleGambleGold(session, message);
          break;
        case 'spend-gem':
          this.handleSpendGem(session, message);
          break;
        case 'skill-book-replace':
          this.handleSkillBookReplace(session, message);
          break;
        case 'active-loot-replace':
          this.handleActiveLootReplace(session, message);
          break;
        case 'equipment-loot-pickup':
          this.handleEquipmentLootPickup(session, message);
          break;
        case 'equipment-equip':
          this.handleEquipmentEquip(session, message);
          break;
        case 'equipment-unequip':
          this.handleEquipmentUnequip(session, message);
          break;
        case 'equipment-discard':
          this.handleEquipmentDiscard(session, message);
          break;
      }
    } catch (error) {
      this.sendError(
        session,
        'BAD_MESSAGE',
        error instanceof Error ? error.message : 'bad message',
      );
    }
  }

  private handleJoin(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'join' }>,
    reservation?: RoomJoinReservation,
  ): void {
    if (session.playerSession !== null) {
      this.sendError(session, 'ALREADY_JOINED', 'session has already joined');
      return;
    }
    if (message.rulesetVersion !== RULESET_VERSION) {
      this.sendError(session, 'RULESET_MISMATCH', `server ruleset is ${RULESET_VERSION}`);
      return;
    }
    if (message.playerId.startsWith('__jwgb_bot_')) {
      this.sendError(session, 'INVALID_PLAYER_ID', 'reserved player id');
      return;
    }
    const joinedPlayerId = playerId(message.playerId);
    const joinedHeroId = heroId(message.heroId);
    const existingSession = this.playerSessions.get(joinedPlayerId);
    if (existingSession) {
      this.sendError(
        session,
        existingSession.state === 'expired' ? 'SESSION_EXPIRED' : 'RESUME_REQUIRED',
        existingSession.state === 'expired'
          ? 'the recovery window for this player has expired'
          : 'this player already exists; resume with its recovery token',
      );
      return;
    }
    if (reservation !== undefined) {
      if (
        message.matchTicket === undefined ||
        reservation.playerId !== joinedPlayerId ||
        reservation.heroId !== joinedHeroId
      ) {
        this.sendError(session, 'MATCH_TICKET_REJECTED', 'the match reservation is invalid');
        return;
      }
    } else if (message.matchTicket !== undefined) {
      this.sendError(session, 'MATCH_TICKET_REJECTED', 'the match reservation is missing');
      return;
    }
    if (this.simulation.playerCount >= M0_SPAWN_POINTS.length) {
      this.sendError(session, 'ROOM_FULL', `room capacity is ${M0_SPAWN_POINTS.length}`);
      return;
    }
    if (this.enableBots && this.lobbyComplete && reservation === undefined) {
      this.sendError(session, 'MATCH_STARTED', 'the match lobby is closed');
      return;
    }
    if (
      reservation !== undefined &&
      !this.claimJoinReservation(reservation.reservationId, joinedPlayerId, joinedHeroId)
    ) {
      this.sendError(session, 'MATCH_TICKET_REJECTED', 'the match reservation is invalid');
      return;
    }

    const joinedEntityId = this.simulation.addPlayer({
      playerId: joinedPlayerId,
      heroId: joinedHeroId,
    });
    const recoveryToken = createRecoveryToken();
    const playerSession: PlayerNetworkSession = {
      entityId: joinedEntityId,
      playerId: joinedPlayerId,
      recoveryTokenHash: hashRecoveryToken(recoveryToken),
      recoverable: true,
      connection: session,
      state: 'connected',
      controller: 'player',
      botDifficulty: null,
      acknowledgedInputSequence: 0,
      resumeDeadlineMs: null,
      lastValidInputAtMs: Date.now(),
      pendingSnapshotAck: null,
      pendingPlayerControl: false,
      pendingPlayerIntent: null,
      takeoverTimer: null,
      inactivityTimer: null,
      expirationTimer: null,
      transactionResponses: new Map(),
    };
    this.playerSessions.set(joinedPlayerId, playerSession);
    session.playerSession = playerSession;
    this.sendJoined(session, playerSession, recoveryToken, false);
    this.scheduleInactivityTimer(playerSession);
    if (this.enableBots && this.simulation.playerCount === 1) {
      this.scheduleLobbyFill();
    }
    if (
      this.enableBots &&
      this.simulation.playerCount + this.joinReservations.size >= M0_SPAWN_POINTS.length
    ) {
      this.completeLobbyWithBots();
    }
  }

  private snapshotFor(observerEntityId: EntityId, baseSnapshot?: WorldSnapshot) {
    return this.fullVisibility
      ? (baseSnapshot ?? this.simulation.getSnapshot())
      : this.simulation.getObserverSnapshot(observerEntityId, baseSnapshot);
  }

  private networkSnapshotFor(
    session: ClientSession,
    observerEntityId: EntityId,
    snapshot = this.snapshotFor(observerEntityId),
    forceStaticWorld = false,
  ): WorldSnapshot {
    if (
      snapshot.mapGeometryHash === null ||
      forceStaticWorld ||
      !session.staticWorldSent ||
      snapshot.staticSolids.length === 0
    ) {
      return snapshot;
    }
    return {
      ...snapshot,
      staticSolids: [],
    };
  }

  private sendSnapshot(
    session: ClientSession,
    playerSession: PlayerNetworkSession,
    snapshot = this.snapshotFor(playerSession.entityId),
    forceStaticWorld = false,
  ): void {
    const networkSnapshot = this.networkSnapshotFor(
      session,
      playerSession.entityId,
      snapshot,
      forceStaticWorld,
    );
    const sent = this.send(session, {
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      snapshot: networkSnapshot,
      acknowledgedInputSequence: playerSession.acknowledgedInputSequence,
    });
    if (
      sent &&
      networkSnapshot.mapGeometryHash !== null &&
      networkSnapshot.staticSolids.length > 0
    ) {
      session.staticWorldSent = true;
    }
  }

  private handleResume(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'resume' }>,
  ): void {
    if (session.playerSession !== null) {
      this.sendError(session, 'ALREADY_JOINED', 'session has already joined');
      return;
    }
    if (message.rulesetVersion !== RULESET_VERSION) {
      this.sendError(session, 'RULESET_MISMATCH', `server ruleset is ${RULESET_VERSION}`);
      return;
    }

    const resumedPlayerId = playerId(message.playerId);
    const playerSession = this.playerSessions.get(resumedPlayerId);
    if (
      playerSession?.recoverable &&
      playerSession.resumeDeadlineMs !== null &&
      Date.now() >= playerSession.resumeDeadlineMs
    ) {
      this.expirePlayerSession(playerSession);
    }
    if (
      !playerSession?.recoverable ||
      playerSession.state === 'expired' ||
      !recoveryTokenMatches(message.recoveryToken, playerSession.recoveryTokenHash)
    ) {
      this.sendError(session, 'RESUME_REJECTED', 'recovery credential is invalid or expired');
      return;
    }

    const previousConnection = playerSession.connection;
    if (previousConnection && previousConnection !== session) {
      previousConnection.playerSession = null;
      this.sendError(
        previousConnection,
        'SESSION_REPLACED',
        'this player session resumed on another connection',
      );
      previousConnection.socket.close(4001, 'session replaced');
    }

    const now = Date.now();
    this.clearTakeoverTimer(playerSession);
    this.clearInactivityTimer(playerSession);
    if (playerSession.resumeDeadlineMs === null) {
      playerSession.resumeDeadlineMs = now + this.resumeGracePeriodMs;
    }
    this.scheduleExpirationTimer(playerSession);
    const recoveryToken = createRecoveryToken();
    playerSession.recoveryTokenHash = hashRecoveryToken(recoveryToken);
    playerSession.connection = session;
    playerSession.state = 'bot-takeover';
    playerSession.controller = 'bot';
    playerSession.pendingPlayerControl = false;
    playerSession.pendingPlayerIntent = null;
    session.playerSession = playerSession;
    this.sendJoined(session, playerSession, recoveryToken, true);
  }

  private sendJoined(
    session: ClientSession,
    playerSession: PlayerNetworkSession,
    recoveryToken: string,
    resumed: boolean,
  ): void {
    const snapshot = this.snapshotFor(playerSession.entityId);
    if (resumed) {
      playerSession.pendingSnapshotAck = {
        snapshotTick: snapshot.tick,
        stateHash: snapshot.stateHash,
      };
    } else {
      playerSession.pendingSnapshotAck = null;
    }
    this.send(session, {
      type: 'joined',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      entityId: playerSession.entityId,
      serverTick: this.simulation.tick,
      acknowledgedInputSequence: playerSession.acknowledgedInputSequence,
      recoveryToken,
      resumeGracePeriodMs: this.resumeGracePeriodMs,
      resumed,
    });
    this.sendSnapshot(session, playerSession, snapshot, true);
  }

  private handleSnapshotAck(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'snapshot-ack' }>,
  ): void {
    const playerSession = session.playerSession;
    if (
      playerSession === null ||
      playerSession.connection !== session ||
      playerSession.pendingSnapshotAck === null
    ) {
      return;
    }
    if (playerSession.resumeDeadlineMs !== null && Date.now() >= playerSession.resumeDeadlineMs) {
      this.expirePlayerSession(playerSession);
      this.sendError(session, 'SESSION_EXPIRED', 'the recovery window for this player has expired');
      return;
    }
    if (
      message.snapshotTick !== playerSession.pendingSnapshotAck.snapshotTick ||
      message.stateHash !== playerSession.pendingSnapshotAck.stateHash
    ) {
      return;
    }
    playerSession.pendingSnapshotAck = null;
    playerSession.pendingPlayerControl = true;
    // Send the current sequence after the acknowledgement. The next room
    // tick applies the player controller, so a bot cannot be double-driven.
    this.sendSnapshot(session, playerSession);
  }

  private handleInput(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'input' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending input');
      return;
    }

    if (playerSession.pendingSnapshotAck !== null || playerSession.state === 'expired') {
      return;
    }
    const intent = createPlayerIntent({
      sequence: message.sequence,
      moveX: message.moveX,
      moveZ: message.moveZ,
      aimX: message.aimX,
      aimZ: message.aimZ,
      attack: message.attack,
      targetEntityId:
        message.targetEntityId === null ? null : entityId(Number(message.targetEntityId)),
      secondaryTargetEntityId:
        message.secondaryTargetEntityId === undefined || message.secondaryTargetEntityId === null
          ? null
          : entityId(Number(message.secondaryTargetEntityId)),
      castActive: message.castActive,
      alternateActive: message.alternateActive ?? false,
      interact: message.interact,
    });

    if (playerSession.controller === 'bot') {
      // An AFK client can request control back with its next valid intent.
      // A disconnected/reconnecting client must first acknowledge the full
      // observer snapshot sent by handleResume.
      if (playerSession.resumeDeadlineMs !== null) {
        return;
      }
      if (intent.sequence <= playerSession.acknowledgedInputSequence) {
        return;
      }
      playerSession.pendingPlayerIntent = intent;
      playerSession.pendingPlayerControl = true;
      playerSession.lastValidInputAtMs = Date.now();
      this.clearInactivityTimer(playerSession);
      return;
    }

    if (!this.canAcceptPlayerCommands(playerSession)) {
      return;
    }
    const accepted = this.simulation.submitIntent(playerSession.entityId, intent);
    if (accepted) {
      playerSession.acknowledgedInputSequence = message.sequence;
      playerSession.lastValidInputAtMs = Date.now();
      this.scheduleInactivityTimer(playerSession);
    }
  }

  private handleAirdropOpen(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'airdrop-open' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending airdrop transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const result = this.simulation.startAirdropOpenResult(
      playerSession.entityId,
      message.airdropId,
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'airdrop-open',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleShopPurchase(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'shop-purchase' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending shop transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }

    const result = this.simulation.purchaseShopListingResult(
      playerSession.entityId,
      message.shopId,
      message.listingId,
      message.expectedVersion,
      message.destination,
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'shop-purchase',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleShopSale(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'shop-sale' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending shop transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }

    const result = this.simulation.sellShopEquipmentResult(
      playerSession.entityId,
      message.shopId,
      equipmentInstanceId(Number(message.instanceId)),
      message.expectedVersion,
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'shop-sale',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleHeroSwap(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'hero-swap' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending service transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const result = this.simulation.startHeroSwapResult(
      playerSession.entityId,
      message.shopId,
      message.expectedVersion,
      heroId(message.targetHeroId),
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'hero-swap',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleGamblePassive(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'gamble-passive' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending gambling transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const result = this.simulation.gamblePassiveResult(
      playerSession.entityId,
      message.shopId,
      message.expectedVersion,
      message.passiveId,
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'gamble-passive',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleGambleEquipment(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'gamble-equipment' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending gambling transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const result = this.simulation.gambleEquipmentResult(
      playerSession.entityId,
      message.shopId,
      message.expectedVersion,
      equipmentInstanceId(Number(message.instanceId)),
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'gamble-equipment',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleGambleActive(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'gamble-active' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending gambling transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const result = this.simulation.gambleActiveResult(
      playerSession.entityId,
      message.shopId,
      message.expectedVersion,
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'gamble-active',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleGambleGold(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'gamble-gold' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending gambling transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const result = this.simulation.gambleGoldResult(
      playerSession.entityId,
      message.shopId,
      message.expectedVersion,
      message.wagerGold,
      message.mode,
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'gamble-gold',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleSpendGem(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'spend-gem' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending passive transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }

    const result = this.simulation.spendGemResult(playerSession.entityId, message.passiveId);
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'spend-gem',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleSkillBookReplace(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'skill-book-replace' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending passive transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }

    const result = this.simulation.replaceSkillBookResult(
      playerSession.entityId,
      entityId(Number(message.lootEntityId)),
      message.replacePassiveId,
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'skill-book-replace',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleActiveLootReplace(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'active-loot-replace' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending active replacement transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const result = this.simulation.replaceActiveLootResult(
      playerSession.entityId,
      entityId(Number(message.lootEntityId)),
      message.confirm,
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'active-loot-replace',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleEquipmentEquip(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'equipment-equip' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending equipment transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const result = this.simulation.equipInventoryEquipmentResult(
      playerSession.entityId,
      equipmentInstanceId(Number(message.instanceId)),
      message.replacementInstanceId === null
        ? null
        : equipmentInstanceId(Number(message.replacementInstanceId)),
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'equipment-equip',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleEquipmentLootPickup(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'equipment-loot-pickup' }>,
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending equipment transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const result = this.simulation.pickupEquipmentLootResult(
      playerSession.entityId,
      entityId(Number(message.lootEntityId)),
      message.destination,
      message.replacementInstanceId === null
        ? null
        : equipmentInstanceId(Number(message.replacementInstanceId)),
    );
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      'equipment-loot-pickup',
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private handleEquipmentUnequip(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'equipment-unequip' }>,
  ): void {
    this.handleSimpleEquipmentTransaction(session, message, 'equipment-unequip');
  }

  private handleEquipmentDiscard(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'equipment-discard' }>,
  ): void {
    this.handleSimpleEquipmentTransaction(session, message, 'equipment-discard');
  }

  private handleSimpleEquipmentTransaction(
    session: ClientSession,
    message: Extract<ClientMessage, { readonly type: 'equipment-unequip' | 'equipment-discard' }>,
    operation: 'equipment-unequip' | 'equipment-discard',
  ): void {
    const playerSession = session.playerSession;
    if (playerSession === null) {
      this.sendError(session, 'NOT_JOINED', 'join before sending equipment transactions');
      return;
    }
    const cached = playerSession.transactionResponses.get(message.transactionId);
    if (cached) {
      this.send(session, cached);
      return;
    }
    const instanceId = equipmentInstanceId(Number(message.instanceId));
    const result =
      operation === 'equipment-unequip'
        ? this.simulation.unequipEquipmentResult(playerSession.entityId, instanceId)
        : this.simulation.discardEquipmentResult(playerSession.entityId, instanceId);
    const response = this.createTransactionResponse(
      playerSession,
      message.transactionId,
      operation,
      result.accepted,
      result.code,
    );
    this.rememberTransactionResponse(playerSession, response);
    this.send(session, response);
  }

  private createTransactionResponse(
    playerSession: PlayerNetworkSession,
    transactionId: string,
    operation: Extract<ServerMessage, { readonly type: 'transaction-result' }>['operation'],
    accepted: boolean,
    code: TransactionCode,
  ): Extract<ServerMessage, { type: 'transaction-result' }> {
    return {
      type: 'transaction-result',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      operation,
      accepted,
      code,
      message: SHOP_TRANSACTION_MESSAGES[code],
      snapshot: this.snapshotFor(playerSession.entityId),
      acknowledgedInputSequence: playerSession.acknowledgedInputSequence,
    };
  }

  private rememberTransactionResponse(
    playerSession: PlayerNetworkSession,
    response: Extract<ServerMessage, { type: 'transaction-result' }>,
  ): void {
    playerSession.transactionResponses.set(response.transactionId, response);
    while (playerSession.transactionResponses.size > 256) {
      const oldest = playerSession.transactionResponses.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      playerSession.transactionResponses.delete(oldest);
    }
  }

  private canAcceptPlayerCommands(playerSession: PlayerNetworkSession): boolean {
    return (
      playerSession.recoverable &&
      playerSession.connection !== null &&
      playerSession.controller === 'player' &&
      playerSession.state === 'connected' &&
      playerSession.pendingSnapshotAck === null &&
      !playerSession.pendingPlayerControl
    );
  }

  private activatePendingPlayerControls(): void {
    const now = Date.now();
    for (const playerSession of this.playerSessions.values()) {
      if (!playerSession.pendingPlayerControl || playerSession.connection === null) {
        continue;
      }
      if (playerSession.resumeDeadlineMs !== null && now >= playerSession.resumeDeadlineMs) {
        this.expirePlayerSession(playerSession);
        continue;
      }
      const pendingIntent = playerSession.pendingPlayerIntent;
      playerSession.pendingPlayerControl = false;
      playerSession.pendingSnapshotAck = null;
      playerSession.pendingPlayerIntent = null;
      playerSession.controller = 'player';
      playerSession.state = 'connected';
      playerSession.resumeDeadlineMs = null;
      this.clearTakeoverTimer(playerSession);
      this.clearExpirationTimer(playerSession);
      playerSession.lastValidInputAtMs = now;
      if (
        pendingIntent !== null &&
        this.simulation.submitIntent(playerSession.entityId, pendingIntent)
      ) {
        playerSession.acknowledgedInputSequence = pendingIntent.sequence;
      }
      this.scheduleInactivityTimer(playerSession);
    }
  }

  private driveBots(): void {
    for (const playerSession of this.playerSessions.values()) {
      if (playerSession.controller !== 'bot') {
        continue;
      }
      if (
        !playerSession.recoverable &&
        (this.simulation.tick + Number(playerSession.entityId)) %
          LOBBY_BOT_DECISION_INTERVAL_TICKS !==
          0
      ) {
        continue;
      }
      const sequence = playerSession.acknowledgedInputSequence + 1;
      const worldView = this.simulation.getBotWorldView(playerSession.entityId);
      const intent = createBotIntent(worldView, playerSession.entityId, sequence);
      if (this.simulation.submitIntent(playerSession.entityId, intent)) {
        playerSession.acknowledgedInputSequence = sequence;
      }
    }
  }

  private readonly runScheduledTicks = (): void => {
    if (this.tickTimer === null || this.disposed) {
      return;
    }

    let now = performance.now();
    if (now - this.nextTickAtMs > MAX_TIMER_LAG_MS) {
      this.nextTickAtMs = now;
    }

    let stepped = 0;
    while (now >= this.nextTickAtMs && stepped < MAX_TIMER_CATCH_UP_TICKS) {
      this.step();
      this.nextTickAtMs += TICK_DURATION_MS;
      stepped += 1;
      now = performance.now();
    }

    if (this.tickTimer === null || this.disposed) {
      return;
    }
    this.tickTimer = setTimeout(
      this.runScheduledTicks,
      Math.max(0, this.nextTickAtMs - performance.now()),
    );
  };

  private scheduleLobbyFill(): void {
    if (!this.enableBots || this.lobbyComplete || this.lobbyFillTimer !== null) {
      return;
    }
    if (this.lobbyFillWaitMs === 0) {
      this.completeLobbyWithBots();
      return;
    }
    this.lobbyFillTimer = setTimeout(() => {
      this.lobbyFillTimer = null;
      this.completeLobbyWithBots();
    }, this.lobbyFillWaitMs);
    this.lobbyFillTimer.unref?.();
  }

  private completeLobbyWithBots(): void {
    if (!this.enableBots || this.lobbyComplete) {
      return;
    }
    if (this.lobbyFillTimer !== null) {
      clearTimeout(this.lobbyFillTimer);
      this.lobbyFillTimer = null;
    }
    while (this.simulation.playerCount + this.joinReservations.size < M0_SPAWN_POINTS.length) {
      const heroRecord = AUTHORITATIVE_HEROES[this.nextBotIndex % AUTHORITATIVE_HEROES.length];
      const botPlayerId = playerId(`__jwgb_bot_${this.nextBotIndex + 1}`);
      this.nextBotIndex += 1;
      if (!heroRecord || this.playerSessions.has(botPlayerId)) {
        continue;
      }
      const botEntityId = this.simulation.addPlayer({
        playerId: botPlayerId,
        heroId: heroId(heroRecord.id),
      });
      const botSession: PlayerNetworkSession = {
        entityId: botEntityId,
        playerId: botPlayerId,
        recoveryTokenHash: randomBytes(32),
        recoverable: false,
        connection: null,
        state: 'bot-takeover',
        controller: 'bot',
        botDifficulty: 'D2',
        acknowledgedInputSequence: 0,
        resumeDeadlineMs: null,
        lastValidInputAtMs: Date.now(),
        pendingSnapshotAck: null,
        pendingPlayerControl: false,
        pendingPlayerIntent: null,
        takeoverTimer: null,
        inactivityTimer: null,
        expirationTimer: null,
        transactionResponses: new Map(),
      };
      this.playerSessions.set(botPlayerId, botSession);
    }
    this.lobbyComplete = true;
  }

  private scheduleInactivityTimer(playerSession: PlayerNetworkSession): void {
    this.clearInactivityTimer(playerSession);
    if (
      !playerSession.recoverable ||
      playerSession.connection === null ||
      playerSession.controller !== 'player' ||
      playerSession.state !== 'connected'
    ) {
      return;
    }
    const delay = Math.max(0, playerSession.lastValidInputAtMs + this.afkTakeoverMs - Date.now());
    playerSession.inactivityTimer = setTimeout(() => {
      playerSession.inactivityTimer = null;
      if (
        playerSession.connection !== null &&
        playerSession.controller === 'player' &&
        playerSession.state === 'connected' &&
        Date.now() - playerSession.lastValidInputAtMs >= this.afkTakeoverMs
      ) {
        playerSession.controller = 'bot';
        playerSession.state = 'bot-takeover';
        playerSession.pendingPlayerControl = false;
        playerSession.pendingPlayerIntent = null;
      } else {
        this.scheduleInactivityTimer(playerSession);
      }
    }, delay);
    playerSession.inactivityTimer.unref?.();
  }

  private scheduleTakeoverTimer(playerSession: PlayerNetworkSession): void {
    this.clearTakeoverTimer(playerSession);
    if (
      !playerSession.recoverable ||
      playerSession.connection !== null ||
      playerSession.controller !== 'player' ||
      playerSession.state !== 'disconnected'
    ) {
      return;
    }
    const delay = Math.max(
      0,
      playerSession.lastValidInputAtMs + this.botTakeoverDelayMs - Date.now(),
    );
    playerSession.takeoverTimer = setTimeout(() => {
      playerSession.takeoverTimer = null;
      if (
        playerSession.connection === null &&
        playerSession.controller === 'player' &&
        playerSession.state === 'disconnected'
      ) {
        playerSession.controller = 'bot';
        playerSession.state = 'bot-takeover';
        playerSession.pendingSnapshotAck = null;
        playerSession.pendingPlayerControl = false;
        playerSession.pendingPlayerIntent = null;
      }
    }, delay);
    playerSession.takeoverTimer.unref?.();
  }

  private scheduleExpirationTimer(playerSession: PlayerNetworkSession): void {
    this.clearExpirationTimer(playerSession);
    if (playerSession.resumeDeadlineMs === null || !playerSession.recoverable) {
      return;
    }
    const delay = Math.max(0, playerSession.resumeDeadlineMs - Date.now());
    const expirationTimer = setTimeout(() => {
      if (playerSession.expirationTimer !== expirationTimer) {
        return;
      }
      playerSession.expirationTimer = null;
      if (playerSession.resumeDeadlineMs !== null && Date.now() < playerSession.resumeDeadlineMs) {
        this.scheduleExpirationTimer(playerSession);
        return;
      }
      this.expirePlayerSession(playerSession);
    }, delay);
    playerSession.expirationTimer = expirationTimer;
    expirationTimer.unref?.();
  }

  private handleClose(session: ClientSession): void {
    this.connections.delete(session);
    const playerSession = session.playerSession;
    session.playerSession = null;
    if (this.disposed || playerSession === null || playerSession.connection !== session) {
      return;
    }

    playerSession.connection = null;
    this.clearInactivityTimer(playerSession);
    playerSession.pendingSnapshotAck = null;
    playerSession.pendingPlayerControl = false;
    playerSession.pendingPlayerIntent = null;
    if (!playerSession.recoverable) {
      return;
    }

    const now = Date.now();
    if (playerSession.controller === 'player') {
      const neutralSequence = playerSession.acknowledgedInputSequence + 1;
      const accepted = this.simulation.submitIntent(
        playerSession.entityId,
        createPlayerIntent({
          sequence: neutralSequence,
          moveX: 0,
          moveZ: 0,
        }),
      );
      if (accepted) {
        playerSession.acknowledgedInputSequence = neutralSequence;
      }
      playerSession.state = 'disconnected';
      playerSession.resumeDeadlineMs = now + this.resumeGracePeriodMs;
      this.scheduleTakeoverTimer(playerSession);
    } else {
      playerSession.state = 'bot-takeover';
      if (playerSession.resumeDeadlineMs === null) {
        playerSession.resumeDeadlineMs = now + this.resumeGracePeriodMs;
      }
    }
    this.scheduleExpirationTimer(playerSession);
  }

  private expirePlayerSession(playerSession: PlayerNetworkSession): void {
    if (
      !playerSession.recoverable ||
      playerSession.state === 'expired' ||
      playerSession.resumeDeadlineMs === null ||
      Date.now() < playerSession.resumeDeadlineMs
    ) {
      return;
    }
    playerSession.state = 'expired';
    playerSession.controller = 'bot';
    playerSession.resumeDeadlineMs = null;
    playerSession.expirationTimer = null;
    playerSession.recoveryTokenHash = randomBytes(32);
    playerSession.pendingSnapshotAck = null;
    playerSession.pendingPlayerControl = false;
    playerSession.pendingPlayerIntent = null;
    this.clearTakeoverTimer(playerSession);
    this.clearInactivityTimer(playerSession);
    const connection = playerSession.connection;
    if (connection !== null) {
      playerSession.connection = null;
      connection.playerSession = null;
      this.sendError(
        connection,
        'SESSION_EXPIRED',
        'the recovery window for this player has expired',
      );
      connection.socket.close(4002, 'recovery window expired');
    }
  }

  private clearTakeoverTimer(playerSession: PlayerNetworkSession): void {
    if (playerSession.takeoverTimer !== null) {
      clearTimeout(playerSession.takeoverTimer);
      playerSession.takeoverTimer = null;
    }
  }

  private clearInactivityTimer(playerSession: PlayerNetworkSession): void {
    if (playerSession.inactivityTimer !== null) {
      clearTimeout(playerSession.inactivityTimer);
      playerSession.inactivityTimer = null;
    }
  }

  private clearExpirationTimer(playerSession: PlayerNetworkSession): void {
    if (playerSession.expirationTimer !== null) {
      clearTimeout(playerSession.expirationTimer);
      playerSession.expirationTimer = null;
    }
  }

  private send(session: ClientSession, message: ServerMessage): boolean {
    if (session.socket.readyState !== session.socket.OPEN) {
      return false;
    }
    const payload = serverCodec.encode(message);
    session.socket.send(payload);
    this.messagesSent += 1;
    this.bytesSent += payload.byteLength;
    this.lastActivityAtMs = Date.now();
    if (message.type === 'snapshot') {
      this.snapshotsSent += 1;
      this.snapshotBytesSent += payload.byteLength;
      this.maximumSnapshotBytes = Math.max(this.maximumSnapshotBytes, payload.byteLength);
    } else if (message.type === 'events') {
      this.eventsSent += 1;
      this.eventBytesSent += payload.byteLength;
    } else if (message.type === 'transaction-result') {
      this.transactionResultsSent += 1;
      this.transactionResultBytesSent += payload.byteLength;
    }
    return true;
  }

  private sendError(session: ClientSession, code: string, message: string): void {
    this.send(session, {
      type: 'error',
      protocolVersion: PROTOCOL_VERSION,
      code,
      message,
    });
  }
}
