import { RULESET_VERSION } from '@jwgb/content';
import {
  type EntityId,
  type EquipmentInstanceId,
  type HeroId,
  type PassiveId,
  type PlayerId,
  TICK_DURATION_MS,
} from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
  validateServerMessage,
} from '@jwgb/protocol';
import type { SimEvent, WorldSnapshot } from '@jwgb/sim';
import type { InputController } from '../input/input-controller';
import type {
  HostFrame,
  WorldConnectionState,
  WorldHost,
  WorldTransactionResult,
} from './world-host';

const clientCodec = new JsonMessageCodec<ClientMessage>([
  'join',
  'resume',
  'snapshot-ack',
  'airdrop-open',
  'input',
  'ping',
  'shop-purchase',
  'shop-sale',
  'hero-swap',
  'gamble-passive',
  'gamble-equipment',
  'gamble-active',
  'gamble-gold',
  'spend-gem',
  'skill-book-replace',
  'active-loot-replace',
  'equipment-loot-pickup',
  'equipment-equip',
  'equipment-unequip',
  'equipment-discard',
]);
const serverCodec = new JsonMessageCodec<ServerMessage>([
  'joined',
  'snapshot',
  'events',
  'pong',
  'transaction-result',
  'error',
]);
const SIM_EVENT_TYPES = new Set<SimEvent['type']>([
  'player-added',
  'basic-attack',
  'damage',
  'critical-hit',
  'passive-shield-created',
  'passive-proc',
  'equipment-proc',
  'summon-spawned',
  'summon-expired',
  'active-cast',
  'active-world-spawned',
  'active-world-expired',
  'active-world-damaged',
  'active-heal',
  'active-status-applied',
  'active-status-ended',
  'active-unavailable',
  'active-target-missing',
  'active-cast-blocked',
  'shop-opened',
  'shop-relocating',
  'shop-closed',
  'shop-purchase',
  'shop-sale',
  'passive-upgraded',
  'passive-learned',
  'projectile-blocked',
  'blink',
  'lethal-protection',
  'true-death',
  'respawn',
  'revive-protection-ended',
  'eliminated',
  'match-started',
  'match-ended',
  'monster-spawned',
  'monster-damaged',
  'monster-killed',
  'loot-dropped',
  'loot-collected',
  'loot-expired',
  'active-replacement-required',
  'active-replacement-cancelled',
  'active-replaced',
  'equipment-pickup-replacement-required',
  'equipment-pickup-replacement-cancelled',
  'equipment-equipped',
  'equipment-unequipped',
  'equipment-discarded',
  'hero-kill-reward',
  'hero-swap-channel',
  'gamble-resolved',
  'airdrop-warning',
  'airdrop-landed',
  'airdrop-channel',
  'airdrop-opened',
  'airdrop-expired',
  'final-court-announced',
  'apocalypse-warning',
  'apocalypse-started',
]);
const INVALID_RECOVERY_CODES = new Set(['RESUME_REJECTED', 'SESSION_EXPIRED']);
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

export interface OnlineSessionCredentials {
  readonly playerId: PlayerId;
  readonly recoveryToken: string;
}

export interface ClientWorldHostOptions {
  readonly url: string;
  readonly playerId: PlayerId;
  readonly heroId: HeroId;
  readonly matchTicket?: string | null;
  readonly initialRecoveryToken?: string | null;
  readonly onSessionUpdate?: (session: OnlineSessionCredentials | null) => void;
  readonly restartPlayerIdFactory?: () => PlayerId;
  readonly reconnectDelayMs?: number;
  readonly webSocketFactory?: (url: string) => WebSocket;
}

function isSimEvent(value: unknown): value is SimEvent {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof value.type === 'string' &&
    SIM_EVENT_TYPES.has(value.type as SimEvent['type'])
  );
}

export class ClientWorldHost implements WorldHost {
  readonly mode = 'online' as const;
  readonly canRestart: boolean;
  localEntityId: EntityId | null = null;
  private playerId: PlayerId;
  private socket: WebSocket | null = null;
  private latestSnapshot: WorldSnapshot | null = null;
  private cachedStaticSolids: WorldSnapshot['staticSolids'] = [];
  private cachedMapGeometryHash: string | null = null;
  private events: SimEvent[] = [];
  private accumulatorMs = 0;
  private pingAccumulatorMs = 0;
  private localSequence = 0;
  private disposed = false;
  private state: WorldConnectionState = 'connecting';
  private acknowledgedInputSequence = 0;
  private errorMessage: string | null = null;
  private recoveryToken: string | null;
  private awaitingResumeSnapshotAck = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private transactionSequence = 0;
  private transactionResults: WorldTransactionResult[] = [];

  constructor(private readonly options: ClientWorldHostOptions) {
    this.playerId = options.playerId;
    this.canRestart = options.restartPlayerIdFactory !== undefined;
    this.recoveryToken = options.initialRecoveryToken ?? null;
    this.connect();
  }

  get connectionState(): WorldConnectionState {
    return this.state;
  }

  get lastError(): string | null {
    return this.errorMessage;
  }

  get lastAcknowledgedInputSequence(): number {
    return this.acknowledgedInputSequence;
  }

  update(deltaMs: number, input: InputController): HostFrame {
    this.accumulatorMs = Math.min(this.accumulatorMs + deltaMs, TICK_DURATION_MS * 5);
    this.pingAccumulatorMs += deltaMs;

    while (
      this.accumulatorMs >= TICK_DURATION_MS &&
      this.state === 'online' &&
      this.localEntityId !== null
    ) {
      this.localSequence += 1;
      const intent = input.sample(this.localSequence);
      this.send({
        type: 'input',
        protocolVersion: PROTOCOL_VERSION,
        sequence: intent.sequence,
        moveX: intent.movement.x,
        moveZ: intent.movement.z,
        aimX: intent.aim.x,
        aimZ: intent.aim.z,
        attack: intent.attack,
        targetEntityId: intent.targetEntityId,
        secondaryTargetEntityId: intent.secondaryTargetEntityId ?? null,
        castActive: intent.castActive,
        alternateActive: intent.alternateActive ?? false,
        interact: intent.interact,
      });
      this.accumulatorMs -= TICK_DURATION_MS;
    }

    if (this.state === 'online' && this.pingAccumulatorMs >= 5_000) {
      this.pingAccumulatorMs %= 5_000;
      this.send({
        type: 'ping',
        protocolVersion: PROTOCOL_VERSION,
        clientTime: Date.now(),
      });
    }

    const frame = {
      snapshot: this.latestSnapshot,
      events: this.events,
      transactionResults: this.transactionResults,
      connectionState: this.state,
    };
    this.events = [];
    this.transactionResults = [];
    return frame;
  }

  getSnapshot(): WorldSnapshot | null {
    return this.latestSnapshot;
  }

  reset(): void {
    const createPlayerId = this.options.restartPlayerIdFactory;
    if (!createPlayerId || this.disposed) {
      return;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.removeSocketListeners(socket);
      socket.close(1000, 'starting a new match');
    }

    this.playerId = createPlayerId();
    this.localEntityId = null;
    this.latestSnapshot = null;
    this.cachedStaticSolids = [];
    this.cachedMapGeometryHash = null;
    this.events = [];
    this.transactionResults = [];
    this.accumulatorMs = 0;
    this.pingAccumulatorMs = 0;
    this.localSequence = 0;
    this.acknowledgedInputSequence = 0;
    this.transactionSequence = 0;
    this.recoveryToken = null;
    this.awaitingResumeSnapshotAck = false;
    this.reconnectAttempt = 0;
    this.errorMessage = null;
    this.state = 'connecting';
    this.options.onSessionUpdate?.(null);
    this.connect();
  }

  purchaseShopListing(
    shopId: string,
    listingId: string,
    expectedVersion: number,
    destination: 'equipped' | 'inventory',
  ): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'shop-purchase',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      shopId,
      listingId,
      expectedVersion,
      destination,
    });
    return transactionId;
  }

  sellShopEquipment(
    shopId: string,
    instanceId: EquipmentInstanceId,
    expectedVersion: number,
  ): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'shop-sale',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      shopId,
      instanceId,
      expectedVersion,
    });
    return transactionId;
  }

  startHeroSwap(shopId: string, expectedVersion: number, targetHeroId: HeroId): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'hero-swap',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      shopId,
      expectedVersion,
      targetHeroId,
    });
    return transactionId;
  }

  gamblePassive(shopId: string, expectedVersion: number, passiveId: PassiveId): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'gamble-passive',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      shopId,
      expectedVersion,
      passiveId,
    });
    return transactionId;
  }

  gambleEquipment(
    shopId: string,
    expectedVersion: number,
    instanceId: EquipmentInstanceId,
  ): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'gamble-equipment',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      shopId,
      expectedVersion,
      instanceId,
    });
    return transactionId;
  }

  gambleActive(shopId: string, expectedVersion: number): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'gamble-active',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      shopId,
      expectedVersion,
    });
    return transactionId;
  }

  gambleGold(
    shopId: string,
    expectedVersion: number,
    wagerGold: number,
    mode: import('@jwgb/sim').GambleGoldMode,
  ): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'gamble-gold',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      shopId,
      expectedVersion,
      wagerGold,
      mode,
    });
    return transactionId;
  }

  openAirdrop(airdropId: string): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'airdrop-open',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      airdropId,
    });
    return transactionId;
  }

  spendGem(passiveId: PassiveId): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'spend-gem',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      passiveId,
    });
    return transactionId;
  }

  replaceSkillBook(lootEntityId: EntityId, replacePassiveId: PassiveId): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'skill-book-replace',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      lootEntityId,
      replacePassiveId,
    });
    return transactionId;
  }

  replaceActiveLoot(lootEntityId: EntityId, confirm: boolean): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'active-loot-replace',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      lootEntityId,
      confirm,
    });
    return transactionId;
  }

  pickupEquipmentLoot(
    lootEntityId: EntityId,
    destination: 'inventory' | 'equipped' | 'cancel',
    replacementInstanceId: EquipmentInstanceId | null = null,
  ): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'equipment-loot-pickup',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      lootEntityId,
      destination,
      replacementInstanceId,
    });
    return transactionId;
  }

  equipInventoryEquipment(
    instanceId: EquipmentInstanceId,
    replacementInstanceId: EquipmentInstanceId | null = null,
  ): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'equipment-equip',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      instanceId,
      replacementInstanceId,
    });
    return transactionId;
  }

  unequipEquipment(instanceId: EquipmentInstanceId): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'equipment-unequip',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      instanceId,
    });
    return transactionId;
  }

  discardEquipment(instanceId: EquipmentInstanceId): string {
    const transactionId = this.nextTransactionId();
    this.send({
      type: 'equipment-discard',
      protocolVersion: PROTOCOL_VERSION,
      transactionId,
      instanceId,
    });
    return transactionId;
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.removeSocketListeners(socket);
      socket.close();
    }
  }

  private connect(): void {
    if (this.disposed) {
      return;
    }
    if (this.socket?.readyState === SOCKET_CONNECTING || this.socket?.readyState === SOCKET_OPEN) {
      return;
    }

    this.state = this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting';
    try {
      const socket = (this.options.webSocketFactory ?? ((url) => new WebSocket(url)))(
        this.options.url,
      );
      this.socket = socket;
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', this.handleOpen);
      socket.addEventListener('message', this.handleMessage);
      socket.addEventListener('close', this.handleClose);
      socket.addEventListener('error', this.handleError);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'WebSocket creation failed';
      this.scheduleReconnect();
    }
  }

  private readonly handleOpen = (event: Event): void => {
    if (event.currentTarget !== this.socket) {
      return;
    }
    if (this.recoveryToken) {
      this.send({
        type: 'resume',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: this.playerId,
        recoveryToken: this.recoveryToken,
      });
      return;
    }
    this.send({
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: this.playerId,
      heroId: this.options.heroId,
      ...(this.options.matchTicket ? { matchTicket: this.options.matchTicket } : {}),
    });
  };

  private readonly handleMessage = (event: MessageEvent): void => {
    const socket = event.currentTarget as WebSocket | null;
    if (!socket || socket !== this.socket) {
      return;
    }
    if (event.data instanceof Blob) {
      void event.data
        .arrayBuffer()
        .then((payload) => this.processPayload(socket, payload))
        .catch((error: unknown) => this.fail(error));
      return;
    }
    this.processPayload(socket, event.data as ArrayBuffer | string);
  };

  private acceptSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
    if (snapshot.staticSolids.length > 0) {
      this.cachedStaticSolids = snapshot.staticSolids;
      this.cachedMapGeometryHash = snapshot.mapGeometryHash;
      return snapshot;
    }
    if (
      snapshot.mapGeometryHash !== null &&
      snapshot.mapGeometryHash === this.cachedMapGeometryHash &&
      this.cachedStaticSolids.length > 0
    ) {
      return {
        ...snapshot,
        staticSolids: this.cachedStaticSolids,
      };
    }
    if (snapshot.mapGeometryHash !== this.cachedMapGeometryHash) {
      this.cachedStaticSolids = [];
      this.cachedMapGeometryHash = snapshot.mapGeometryHash;
    }
    return snapshot;
  }

  private processPayload(socket: WebSocket, payload: ArrayBuffer | string): void {
    if (socket !== this.socket) {
      return;
    }
    try {
      const message = serverCodec.decode(payload);
      validateServerMessage(message);
      switch (message.type) {
        case 'joined':
          this.localEntityId = message.entityId;
          this.acknowledgedInputSequence = message.acknowledgedInputSequence;
          this.localSequence = Math.max(this.localSequence, message.acknowledgedInputSequence);
          this.recoveryToken = message.recoveryToken;
          this.awaitingResumeSnapshotAck = message.resumed;
          this.options.onSessionUpdate?.({
            playerId: this.playerId,
            recoveryToken: message.recoveryToken,
          });
          this.accumulatorMs = 0;
          this.reconnectAttempt = 0;
          this.state = 'online';
          this.errorMessage = null;
          break;
        case 'snapshot':
          this.latestSnapshot = this.acceptSnapshot(message.snapshot as WorldSnapshot);
          this.acknowledgedInputSequence = message.acknowledgedInputSequence;
          this.localSequence = Math.max(this.localSequence, message.acknowledgedInputSequence);
          if (this.awaitingResumeSnapshotAck) {
            this.awaitingResumeSnapshotAck = false;
            this.send({
              type: 'snapshot-ack',
              protocolVersion: PROTOCOL_VERSION,
              snapshotTick: message.snapshot.tick,
              stateHash: message.snapshot.stateHash,
            });
          }
          break;
        case 'events':
          this.events.push(...message.events.filter(isSimEvent));
          break;
        case 'pong':
          break;
        case 'transaction-result':
          this.latestSnapshot = this.acceptSnapshot(message.snapshot as WorldSnapshot);
          this.acknowledgedInputSequence = message.acknowledgedInputSequence;
          this.localSequence = Math.max(this.localSequence, message.acknowledgedInputSequence);
          this.transactionResults.push({
            transactionId: message.transactionId,
            operation: message.operation,
            accepted: message.accepted,
            code: message.code,
            message: message.message,
          });
          break;
        case 'error':
          if (INVALID_RECOVERY_CODES.has(message.code)) {
            this.recoveryToken = null;
            this.options.onSessionUpdate?.(null);
          }
          this.state = 'error';
          this.errorMessage = `${message.code}: ${message.message}`;
          socket.close();
          break;
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private readonly handleClose = (event: CloseEvent): void => {
    const socket = event.currentTarget as WebSocket | null;
    if (!socket || socket !== this.socket) {
      return;
    }
    this.removeSocketListeners(socket);
    this.socket = null;
    if (this.disposed || this.state === 'error') {
      return;
    }
    this.state = 'reconnecting';
    this.scheduleReconnect();
  };

  private readonly handleError = (event: Event): void => {
    const socket = event.currentTarget as WebSocket | null;
    if (!socket || socket !== this.socket) {
      return;
    }
    this.errorMessage = 'WebSocket transport error';
    socket.close();
  };

  private scheduleReconnect(): void {
    if (this.disposed || this.state === 'error' || this.reconnectTimer !== null) {
      return;
    }
    this.state = 'reconnecting';
    const baseDelayMs = this.options.reconnectDelayMs ?? 250;
    const delayMs = Math.min(2_000, baseDelayMs * 2 ** Math.min(this.reconnectAttempt, 3));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private removeSocketListeners(socket: WebSocket): void {
    socket.removeEventListener('open', this.handleOpen);
    socket.removeEventListener('message', this.handleMessage);
    socket.removeEventListener('close', this.handleClose);
    socket.removeEventListener('error', this.handleError);
  }

  private fail(error: unknown): void {
    this.state = 'error';
    this.errorMessage = error instanceof Error ? error.message : 'unknown client world error';
    this.socket?.close();
  }

  private send(message: ClientMessage): void {
    const socket = this.socket;
    if (socket?.readyState === SOCKET_OPEN) {
      socket.send(clientCodec.encode(message));
    }
  }

  private nextTransactionId(): string {
    this.transactionSequence += 1;
    return `tx-${this.transactionSequence}`;
  }
}
