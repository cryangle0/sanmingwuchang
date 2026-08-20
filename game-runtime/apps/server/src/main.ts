import { AUTHORITATIVE_MAP_STATIC_SOLIDS } from '@jwgb/content';
import { createGameServer } from './network/game-server';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const host = process.env.HOST ?? '0.0.0.0';
const lobbyFillWaitMs = Number.parseInt(process.env.LOBBY_FILL_WAIT_MS ?? '1500', 10);
const pooledRooms = process.env.ROOM_MODE !== 'isolated';
const isolatedRooms = process.env.ROOM_MODE === 'isolated';
const server = createGameServer(undefined, {
  enableBots: true,
  lobbyFillWaitMs,
  pve: { enabled: true, population: 'full' },
  staticSolids: AUTHORITATIVE_MAP_STATIC_SOLIDS,
  map: { enabled: true },
  isolatedRooms,
  pooledRooms,
  fullVisibility: process.env.FULL_VISIBILITY === 'true',
  perMessageDeflate: true,
  requireMatchTicketForJoin: true,
});

server
  .listen(port, host)
  .then((actualPort) => {
    console.log(`Journey West Great Brawl server listening on http://${host}:${actualPort}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
