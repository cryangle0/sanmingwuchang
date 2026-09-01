import { Readable } from 'node:stream';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

function normalizedBase(value: string | undefined): string {
  const base = value?.trim() || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

const modelProxyOrigin =
  process.env.JWGB_MODEL_PROXY_ORIGIN?.trim() || 'https://vibe-files.aigcresearch.com';
const modelProxyPrefix = '/AIGame/JourneyWestGreatBrawl/models/v1';
const MODEL_PROXY_ATTEMPTS = 3;
const MODEL_PROXY_TIMEOUT_MS = 45_000;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function modelProxyPlugin(): Plugin {
  return {
    name: 'jwgb-model-proxy',
    configureServer(server) {
      server.middlewares.use('/models', async (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next();
          return;
        }

        const requestUrl = request.url ?? '/';
        const relativeUrl = requestUrl.startsWith('/models')
          ? requestUrl.slice('/models'.length)
          : requestUrl;
        // Foliage and converted map GLBs are bundled with the web app.
        // Character FBX files stay on the model CDN, but forwarding these
        // paths would hide local files behind a remote 404 during development.
        if (
          relativeUrl.startsWith('/characters/') ||
          relativeUrl.startsWith('/shops/') ||
          relativeUrl.startsWith('/foliage/') ||
          relativeUrl.startsWith('/map-assets/') ||
          relativeUrl.startsWith('/global-scenes/') ||
          relativeUrl.startsWith('/grassworks/')
        ) {
          next();
          return;
        }
        const upstreamUrl = new URL(`${modelProxyPrefix}${relativeUrl}`, modelProxyOrigin);
        let lastError: unknown = null;

        for (let attempt = 0; attempt < MODEL_PROXY_ATTEMPTS; attempt += 1) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), MODEL_PROXY_TIMEOUT_MS);
          try {
            const rangeHeader = request.headers.range;
            const upstream = await fetch(upstreamUrl, {
              signal: controller.signal,
              ...(rangeHeader
                ? { headers: { range: Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader } }
                : {}),
            });
            if (upstream.status >= 500 && attempt + 1 < MODEL_PROXY_ATTEMPTS) {
              await upstream.body?.cancel();
              await wait(250 * (attempt + 1));
              continue;
            }

            response.statusCode = upstream.status;
            for (const [key, value] of upstream.headers) {
              if (key !== 'connection' && key !== 'transfer-encoding') {
                response.setHeader(key, value);
              }
            }
            if (request.method === 'HEAD' || !upstream.body) {
              response.end();
              return;
            }
            Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(
              response,
            );
            return;
          } catch (error) {
            lastError = error;
            if (attempt + 1 < MODEL_PROXY_ATTEMPTS) {
              await wait(250 * (attempt + 1));
            }
          } finally {
            clearTimeout(timeout);
          }
        }

        server.config.logger.warn(
          `model proxy failed after ${MODEL_PROXY_ATTEMPTS} attempts: ${String(lastError)}`,
        );
        response.statusCode = 502;
        response.setHeader('content-type', 'text/plain; charset=utf-8');
        response.end('Bad Gateway');
      });
    },
  };
}

export default defineConfig({
  base: normalizedBase(process.env.JWGB_WEB_BASE_URL),
  plugins: [modelProxyPlugin()],
  build: {
    assetsDir: 'assets',
    sourcemap: false,
  },
});
