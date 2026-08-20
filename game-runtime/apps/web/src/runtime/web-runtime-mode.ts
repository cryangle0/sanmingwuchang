export type WebRuntimeMode = 'local' | 'online';

export function resolveWebRuntimeMode(value: string | null): WebRuntimeMode {
  return value === 'local' ? 'local' : 'online';
}
