import { RULESET_VERSION } from '@jwgb/content';
import type { HeroId, PlayerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
  validateServerMessage,
} from '@jwgb/protocol';

const clientCodec = new JsonMessageCodec<ClientMessage>([
  'matchmaking-enqueue',
  'matchmaking-cancel',
  'matchmaking-reroll',
  'matchmaking-select',
]);
const serverCodec = new JsonMessageCodec<ServerMessage>([
  'matchmaking-queued',
  'matchmaking-selection',
  'matchmaking-assigned',
  'matchmaking-cancelled',
  'error',
]);
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

type QueuedMessage = Extract<ServerMessage, { readonly type: 'matchmaking-queued' }>;
type SelectionMessage = Extract<ServerMessage, { readonly type: 'matchmaking-selection' }>;
type AssignedMessage = Extract<ServerMessage, { readonly type: 'matchmaking-assigned' }>;
type CancelledMessage = Extract<ServerMessage, { readonly type: 'matchmaking-cancelled' }>;
type ErrorMessage = Extract<ServerMessage, { readonly type: 'error' }>;

export interface MatchmakingClientCallbacks {
  readonly onQueued?: (message: QueuedMessage) => void;
  readonly onSelection?: (message: SelectionMessage) => void;
  readonly onAssigned?: (message: AssignedMessage) => void;
  readonly onCancelled?: (message: CancelledMessage) => void;
  readonly onError?: (message: ErrorMessage | Error) => void;
}

export interface MatchmakingClientOptions extends MatchmakingClientCallbacks {
  readonly url: string;
  readonly playerId: PlayerId;
  readonly rulesetVersion?: string;
  readonly webSocketFactory?: (url: string) => WebSocket;
}

export class MatchmakingClient {
  private socket: WebSocket | null = null;
  private disposed = false;
  private pendingEnqueue = false;

  constructor(private readonly options: MatchmakingClientOptions) {}

  enqueue(): void {
    if (this.disposed) {
      return;
    }
    this.pendingEnqueue = true;
    this.connect();
    this.sendWhenOpen({
      type: 'matchmaking-enqueue',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: this.options.rulesetVersion ?? RULESET_VERSION,
      playerId: this.options.playerId,
    });
  }

  cancel(): boolean {
    this.pendingEnqueue = false;
    const socket = this.socket;
    if (socket?.readyState !== SOCKET_OPEN) {
      return false;
    }
    try {
      socket.send(
        clientCodec.encode({
          type: 'matchmaking-cancel',
          protocolVersion: PROTOCOL_VERSION,
        }),
      );
      return true;
    } catch (error) {
      this.notifyError(error);
      return false;
    }
  }

  reroll(matchId: string): void {
    this.send({
      type: 'matchmaking-reroll',
      protocolVersion: PROTOCOL_VERSION,
      matchId,
    });
  }

  select(matchId: string, heroId: HeroId): void {
    this.send({
      type: 'matchmaking-select',
      protocolVersion: PROTOCOL_VERSION,
      matchId,
      heroId,
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pendingEnqueue = false;
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      this.removeListeners(socket);
      socket.close(1000, 'matchmaking complete');
    }
  }

  private connect(): void {
    if (
      this.disposed ||
      this.socket?.readyState === SOCKET_CONNECTING ||
      this.socket?.readyState === SOCKET_OPEN
    ) {
      return;
    }
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
      this.notifyError(error instanceof Error ? error : new Error('WebSocket creation failed'));
    }
  }

  private readonly handleOpen = (event: Event): void => {
    if (event.currentTarget !== this.socket || !this.pendingEnqueue) {
      return;
    }
    this.send({
      type: 'matchmaking-enqueue',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: this.options.rulesetVersion ?? RULESET_VERSION,
      playerId: this.options.playerId,
    });
  };

  private readonly handleMessage = (event: MessageEvent): void => {
    const socket = event.currentTarget as WebSocket | null;
    if (socket === null || socket !== this.socket) {
      return;
    }
    if (event.data instanceof Blob) {
      void event.data
        .arrayBuffer()
        .then((payload) => this.processPayload(socket, payload))
        .catch((error: unknown) => this.notifyError(error));
      return;
    }
    this.processPayload(socket, event.data as ArrayBuffer | string);
  };

  private processPayload(socket: WebSocket, payload: ArrayBuffer | string): void {
    if (socket !== this.socket || this.disposed) {
      return;
    }
    try {
      const message = serverCodec.decode(payload);
      validateServerMessage(message);
      switch (message.type) {
        case 'matchmaking-queued':
          this.options.onQueued?.(message);
          break;
        case 'matchmaking-selection':
          this.options.onSelection?.(message);
          break;
        case 'matchmaking-assigned':
          this.pendingEnqueue = false;
          this.options.onAssigned?.(message);
          break;
        case 'matchmaking-cancelled':
          this.pendingEnqueue = false;
          this.options.onCancelled?.(message);
          break;
        case 'error':
          this.options.onError?.(message);
          break;
      }
    } catch (error) {
      this.notifyError(error);
    }
  }

  private readonly handleClose = (event: CloseEvent): void => {
    const socket = event.currentTarget as WebSocket | null;
    if (socket === null || socket !== this.socket) {
      return;
    }
    this.removeListeners(socket);
    this.socket = null;
    if (!this.disposed && this.pendingEnqueue) {
      this.notifyError(new Error(`matchmaking socket closed (${event.code})`));
    }
  };

  private readonly handleError = (event: Event): void => {
    const socket = event.currentTarget as WebSocket | null;
    if (socket === null || socket !== this.socket) {
      return;
    }
    this.notifyError(new Error('matchmaking transport error'));
  };

  private sendWhenOpen(message: ClientMessage): void {
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.send(message);
    }
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.socket.send(clientCodec.encode(message));
    }
  }

  private notifyError(error: unknown): void {
    if (this.disposed) {
      return;
    }
    if (error !== null && typeof error === 'object' && 'code' in error && 'message' in error) {
      this.options.onError?.(error as ErrorMessage);
      return;
    }
    this.options.onError?.(error instanceof Error ? error : new Error('unknown matchmaking error'));
  }

  private removeListeners(socket: WebSocket): void {
    socket.removeEventListener('open', this.handleOpen);
    socket.removeEventListener('message', this.handleMessage);
    socket.removeEventListener('close', this.handleClose);
    socket.removeEventListener('error', this.handleError);
  }
}
