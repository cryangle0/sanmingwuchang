import { invariant } from '@jwgb/core';

export interface MessageCodec<Message> {
  encode(message: Message): Uint8Array;
  decode(payload: ArrayBuffer | Uint8Array | string): Message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class JsonMessageCodec<Message extends { readonly type: string }>
  implements MessageCodec<Message>
{
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly allowedTypes: ReadonlySet<string>;

  constructor(allowedTypes: readonly Message['type'][]) {
    this.allowedTypes = new Set(allowedTypes);
  }

  encode(message: Message): Uint8Array {
    invariant(this.allowedTypes.has(message.type), `unsupported message type: ${message.type}`);
    return this.encoder.encode(JSON.stringify(message));
  }

  decode(payload: ArrayBuffer | Uint8Array | string): Message {
    const text =
      typeof payload === 'string'
        ? payload
        : this.decoder.decode(payload instanceof Uint8Array ? payload : new Uint8Array(payload));
    const parsed: unknown = JSON.parse(text);
    invariant(isRecord(parsed), 'message payload must be an object');
    invariant(typeof parsed.type === 'string', 'message type must be a string');
    invariant(this.allowedTypes.has(parsed.type), `unsupported message type: ${parsed.type}`);
    return parsed as Message;
  }
}
