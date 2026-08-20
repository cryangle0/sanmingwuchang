import { HERO_IDS } from '@jwgb/content';
import { createPlayerIntent, playerId } from '@jwgb/core';
import { createGameServer } from '../apps/server/src/network/game-server';
import type { InputController } from '../apps/web/src/input/input-controller';
import { ClientWorldHost } from '../apps/web/src/runtime/client-world-host';

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for client world state');
}

describe('online ClientWorld host', () => {
  it('joins the authoritative room, submits intent, and applies acknowledged snapshots', async () => {
    const server = createGameServer(0x0c11e17, { startRoomTimer: false });
    const port = await server.listen(0);
    const host = new ClientWorldHost({
      url: `ws://127.0.0.1:${port}/match`,
      playerId: playerId('client-world-player'),
      heroId: HERO_IDS.sunWukong,
    });
    const input = {
      sample(sequence: number) {
        return createPlayerIntent({
          sequence,
          moveX: 1_000,
          moveZ: 0,
        });
      },
    } as InputController;

    await waitFor(() => host.connectionState === 'online' && host.localEntityId !== null);
    const localEntityId = host.localEntityId;
    if (localEntityId === null) {
      throw new Error('client world did not receive a local entity id');
    }
    const initialPlayer = server.room
      .getSnapshot()
      .players.find((player) => player.entityId === localEntityId);
    if (!initialPlayer) {
      throw new Error('authoritative room is missing the joined player');
    }

    host.update(50, input);
    await new Promise<void>((resolve) => setImmediate(resolve));
    server.room.step();
    server.room.step();
    await waitFor(
      () =>
        host.lastAcknowledgedInputSequence === 1 &&
        host.getSnapshot()?.tick === server.room.getSnapshot().tick,
    );
    const acknowledgedSnapshot = host.getSnapshot();

    expect(host.connectionState).toBe('online');
    expect(host.lastAcknowledgedInputSequence).toBeGreaterThan(0);
    expect(
      acknowledgedSnapshot?.players.find((player) => player.entityId === localEntityId)?.position.x,
    ).not.toBe(initialPlayer.position.x);
    expect(acknowledgedSnapshot?.stateHash).toBe(server.room.getSnapshot().stateHash);

    host.dispose();
    await server.close();
  });

  it('automatically resumes the same entity after a real transport interruption', async () => {
    const server = createGameServer(0xc011ec7, {
      startRoomTimer: false,
      resumeGracePeriodMs: 2_000,
    });
    const port = await server.listen(0);
    const reconnectingPlayerId = playerId('client-world-reconnect');
    const issuedTokens: string[] = [];
    const host = new ClientWorldHost({
      url: `ws://127.0.0.1:${port}/match`,
      playerId: reconnectingPlayerId,
      heroId: HERO_IDS.sunWukong,
      reconnectDelayMs: 10,
      onSessionUpdate: (session) => {
        if (session) {
          issuedTokens.push(session.recoveryToken);
        }
      },
    });
    const input = {
      sample(sequence: number) {
        return createPlayerIntent({
          sequence,
          moveX: 1_000,
          moveZ: 0,
        });
      },
    } as InputController;

    await waitFor(() => host.connectionState === 'online' && host.localEntityId !== null);
    const originalEntityId = host.localEntityId;
    host.update(50, input);
    await new Promise<void>((resolve) => setImmediate(resolve));
    server.room.step();
    server.room.step();
    await waitFor(() => host.lastAcknowledgedInputSequence === 1);

    const [serverSocket] = [...server.webSocketServer.clients];
    if (!serverSocket) {
      throw new Error('missing connected server socket');
    }
    serverSocket.terminate();

    await waitFor(() => host.connectionState === 'online' && issuedTokens.length >= 2);
    await new Promise<void>((resolve) => setImmediate(resolve));
    server.room.step();
    await waitFor(() => server.room.getPlayerSession(reconnectingPlayerId)?.state === 'connected');
    expect(host.localEntityId).toBe(originalEntityId);
    expect(server.room.getSnapshot().players).toHaveLength(1);
    expect(issuedTokens[1]).not.toBe(issuedTokens[0]);
    expect(host.lastAcknowledgedInputSequence).toBe(2);

    host.update(50, input);
    await new Promise<void>((resolve) => setImmediate(resolve));
    server.room.step();
    server.room.step();
    await waitFor(() => host.lastAcknowledgedInputSequence === 3);

    host.dispose();
    await server.close();
  });

  it('recreates the Web host from a stored credential without duplicating the player', async () => {
    const server = createGameServer(0xbad5e55, {
      startRoomTimer: false,
      resumeGracePeriodMs: 2_000,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const reloadPlayerId = playerId('client-world-reload');
    let storedToken: string | null = null;
    const oldHost = new ClientWorldHost({
      url,
      playerId: reloadPlayerId,
      heroId: HERO_IDS.sunWukong,
      onSessionUpdate: (session) => {
        storedToken = session?.recoveryToken ?? null;
      },
    });

    await waitFor(
      () => oldHost.connectionState === 'online' && oldHost.localEntityId !== null && !!storedToken,
    );
    const originalEntityId = oldHost.localEntityId;
    if (!storedToken) {
      throw new Error('initial Web host did not persist a recovery token');
    }

    const reloadedHost = new ClientWorldHost({
      url,
      playerId: reloadPlayerId,
      heroId: HERO_IDS.sunWukong,
      initialRecoveryToken: storedToken,
    });
    await waitFor(
      () =>
        reloadedHost.connectionState === 'online' &&
        reloadedHost.localEntityId === originalEntityId &&
        oldHost.connectionState === 'error',
    );

    expect(oldHost.lastError).toContain('SESSION_REPLACED');
    expect(reloadedHost.localEntityId).toBe(originalEntityId);
    expect(server.room.getSnapshot().players).toHaveLength(1);

    oldHost.dispose();
    reloadedHost.dispose();
    await server.close();
  });

  it('starts a fresh isolated room when the online player requests another match', async () => {
    const server = createGameServer(0xf12e501, {
      isolatedRooms: true,
      startRoomTimer: true,
    });
    const port = await server.listen(0);
    const issuedSessions: string[] = [];
    let nextPlayer = 1;
    const host = new ClientWorldHost({
      url: `ws://127.0.0.1:${port}/match`,
      playerId: playerId('client-world-rematch-1'),
      heroId: HERO_IDS.sunWukong,
      restartPlayerIdFactory: () => {
        nextPlayer += 1;
        return playerId(`client-world-rematch-${nextPlayer}`);
      },
      onSessionUpdate: (session) => {
        if (session) {
          issuedSessions.push(`${session.playerId}:${session.recoveryToken}`);
        }
      },
    });

    await waitFor(
      () =>
        host.connectionState === 'online' && host.localEntityId !== null && !!host.getSnapshot(),
    );
    const firstSnapshot = host.getSnapshot();
    host.reset();
    await waitFor(
      () =>
        host.connectionState === 'online' &&
        host.localEntityId !== null &&
        issuedSessions.length >= 2 &&
        host.getSnapshot() !== null,
    );
    const secondSnapshot = host.getSnapshot();

    expect(host.canRestart).toBe(true);
    expect(issuedSessions[0]?.startsWith('client-world-rematch-1:')).toBe(true);
    expect(issuedSessions[1]?.startsWith('client-world-rematch-2:')).toBe(true);
    expect(secondSnapshot?.stateHash).not.toBe(firstSnapshot?.stateHash);

    host.dispose();
    await server.close();
  });
});
