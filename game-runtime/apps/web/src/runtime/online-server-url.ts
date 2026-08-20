export interface BrowserLocationLike {
  readonly protocol: string;
  readonly hostname: string;
  readonly host: string;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function resolveOnlineServerUrl(
  location: BrowserLocationLike,
  explicitServerUrl: string | null,
): string {
  const candidate =
    explicitServerUrl ??
    (location.protocol === 'https:'
      ? `wss://${location.host}/match`
      : isLocalHostname(location.hostname)
        ? `ws://${location.hostname}:8787/match`
        : `ws://${location.host}/match`);
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('online server must use ws or wss');
  }
  return parsed.toString();
}
