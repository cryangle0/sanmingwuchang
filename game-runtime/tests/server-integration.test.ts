import { PASSIVE_IDS, RULESET_VERSION } from '@jwgb/content';
import { createPlayerIntent, entityId, heroId, passiveId, playerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@jwgb/protocol';
import { WebSocket } from 'ws';
import { createGameServer } from '../apps/server/src/network/game-server';
import { GameSimulation } from '../packages/sim/src/simulation';
import { syncShops } from '../packages/sim/src/systems/shop';
import type { SimEvent } from '../packages/sim/src/types';

const clientCodec = new JsonMessageCodec<ClientMessage>([
  'join',
  'resume',
  'snapshot-ack',
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
  'equipment-equip',
  'equipment-unequip',
  'equipment-discard',
  'airdrop-open',
]);
const serverCodec = new JsonMessageCodec<ServerMessage>([
  'joined',
  'snapshot',
  'events',
  'pong',
  'transaction-result',
  'error',
]);

class MessageQueue {
  private readonly messages: ServerMessage[] = [];

  constructor(socket: WebSocket) {
    socket.on('message', (data) => {
      this.messages.push(serverCodec.decode(new Uint8Array(data as Buffer)));
    });
  }

  async waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 2_000,
  ): Promise<ServerMessage> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) {
        const [message] = this.messages.splice(index, 1);
        if (message) {
          return message;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('timed out waiting for WebSocket message');
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function send(socket: WebSocket, payload: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(payload, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}

describe('authoritative WebSocket room', () => {
  it('joins two clients, accepts intent, and acknowledges movement input', async () => {
    const server = createGameServer(0x1234);
    const port = await server.listen(0);
    const first = await connect(`ws://127.0.0.1:${port}/match`);
    const second = await connect(`ws://127.0.0.1:${port}/match`);
    const firstQueue = new MessageQueue(first);
    const secondQueue = new MessageQueue(second);

    first.send(
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('ws-first'),
        heroId: heroId('H009'),
      }),
    );
    second.send(
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('ws-second'),
        heroId: heroId('H018'),
      }),
    );

    const firstJoined = await firstQueue.waitFor((message) => message.type === 'joined');
    await secondQueue.waitFor((message) => message.type === 'joined');
    expect(firstJoined.type).toBe('joined');
    if (firstJoined.type !== 'joined') {
      throw new Error('expected joined message');
    }

    const intent = createPlayerIntent({
      sequence: 1,
      moveX: 1_000,
      moveZ: 0,
    });
    first.send(
      clientCodec.encode({
        type: 'input',
        protocolVersion: PROTOCOL_VERSION,
        sequence: intent.sequence,
        moveX: intent.movement.x,
        moveZ: intent.movement.z,
        aimX: intent.aim.x,
        aimZ: intent.aim.z,
        attack: intent.attack,
        targetEntityId: intent.targetEntityId,
        castActive: intent.castActive,
        interact: intent.interact,
      }),
    );

    const acknowledged = await firstQueue.waitFor(
      (message) =>
        message.type === 'snapshot' &&
        message.acknowledgedInputSequence === 1 &&
        (message.snapshot.players.find((player) => player.entityId === firstJoined.entityId)
          ?.position.x ?? 0) !== 0,
    );
    expect(acknowledged).toMatchObject({
      type: 'snapshot',
      acknowledgedInputSequence: 1,
    });

    first.close();
    second.close();
    await server.close();
  });

  it('executes shop transactions over WebSocket and replays duplicate transaction ids idempotently', async () => {
    const server = createGameServer(0x51_0f_11, { startRoomTimer: false });
    const port = await server.listen(0);
    const socket = await connect(`ws://127.0.0.1:${port}/match`);
    const queue = new MessageQueue(socket);

    await send(
      socket,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('shop-network-player'),
        heroId: heroId('H009'),
      }),
    );
    const joined = await queue.waitFor((message) => message.type === 'joined');
    if (joined.type !== 'joined') {
      throw new Error('expected shop test player to join');
    }

    const simulation = (
      server.room as unknown as {
        readonly simulation: GameSimulation;
      }
    ).simulation;
    simulation.step(30 * 20);
    const shop = simulation
      .getSnapshot()
      .shops.find((candidate) => candidate.shopId === 'land-god-a');
    if (!shop) {
      throw new Error('shop did not open for network transaction test');
    }
    const state = (
      simulation as unknown as {
        readonly state: {
          readonly players: Map<number, { position: { x: number; z: number }; gold: number }>;
        };
      }
    ).state;
    const player = state.players.get(Number(joined.entityId));
    if (!player) {
      throw new Error('joined player missing from authoritative state');
    }
    player.position = { x: shop.position.x, z: shop.position.z };
    player.gold = 5_000;

    const listing = shop.inventory.find((candidate) => candidate.kind === 'equipment');
    if (!listing) {
      throw new Error('shop equipment listing missing');
    }
    const purchase: Extract<ClientMessage, { readonly type: 'shop-purchase' }> = {
      type: 'shop-purchase',
      protocolVersion: PROTOCOL_VERSION,
      transactionId: 'network-purchase-1',
      shopId: shop.shopId,
      listingId: listing.listingId,
      expectedVersion: shop.version,
      destination: 'equipped' as const,
    };
    await send(socket, clientCodec.encode(purchase));
    const purchaseResult = await queue.waitFor(
      (message) =>
        message.type === 'transaction-result' && message.transactionId === purchase.transactionId,
    );
    expect(purchaseResult).toMatchObject({
      type: 'transaction-result',
      operation: 'shop-purchase',
      accepted: true,
      code: 'accepted',
    });
    if (purchaseResult.type !== 'transaction-result') {
      throw new Error('expected purchase transaction result');
    }
    const firstPurchaseHash = purchaseResult.snapshot.stateHash;
    const firstPurchasedPlayer = purchaseResult.snapshot.players.find(
      (candidate) => candidate.entityId === joined.entityId,
    );
    expect(firstPurchasedPlayer?.equipment).toHaveLength(1);
    const firstGold = firstPurchasedPlayer?.gold;

    await send(socket, clientCodec.encode(purchase));
    const duplicateResult = await queue.waitFor(
      (message) =>
        message.type === 'transaction-result' && message.transactionId === purchase.transactionId,
    );
    expect(duplicateResult).toMatchObject({
      type: 'transaction-result',
      accepted: true,
      code: 'accepted',
    });
    if (duplicateResult.type !== 'transaction-result') {
      throw new Error('expected duplicate purchase transaction result');
    }
    expect(duplicateResult.snapshot.stateHash).toBe(firstPurchaseHash);
    expect(
      duplicateResult.snapshot.players.find((candidate) => candidate.entityId === joined.entityId)
        ?.gold,
    ).toBe(firstGold);

    const purchasedInstance = firstPurchasedPlayer?.equipment[0];
    if (!purchasedInstance) {
      throw new Error('purchased equipment instance missing from transaction snapshot');
    }
    await send(
      socket,
      clientCodec.encode({
        type: 'shop-sale',
        protocolVersion: PROTOCOL_VERSION,
        transactionId: 'network-sale-1',
        shopId: shop.shopId,
        instanceId: purchasedInstance.instanceId,
        expectedVersion: shop.version,
      }),
    );
    await expect(
      queue.waitFor(
        (message) =>
          message.type === 'transaction-result' && message.transactionId === 'network-sale-1',
      ),
    ).resolves.toMatchObject({
      type: 'transaction-result',
      operation: 'shop-sale',
      accepted: true,
      code: 'accepted',
    });

    const authoritativePlayer = state.players.get(Number(joined.entityId)) as
      | {
          gems: number;
          passives: {
            passiveId: typeof PASSIVE_IDS.critical;
            level: 1 | 2 | 3 | 4 | 5;
          }[];
        }
      | undefined;
    if (!authoritativePlayer) {
      throw new Error('authoritative player missing before gem transaction');
    }
    authoritativePlayer.gems = 1;
    authoritativePlayer.passives.push({ passiveId: PASSIVE_IDS.critical, level: 1 });
    await send(
      socket,
      clientCodec.encode({
        type: 'spend-gem',
        protocolVersion: PROTOCOL_VERSION,
        transactionId: 'network-gem-1',
        passiveId: PASSIVE_IDS.critical,
      }),
    );
    await expect(
      queue.waitFor(
        (message) =>
          message.type === 'transaction-result' && message.transactionId === 'network-gem-1',
      ),
    ).resolves.toMatchObject({
      type: 'transaction-result',
      operation: 'spend-gem',
      accepted: true,
      code: 'accepted',
    });

    socket.close();
    await server.close();
  });

  it('replays an identical Black Mountain transaction without a second commit', async () => {
    const server = createGameServer(0x51_0f_21, { startRoomTimer: false });
    const port = await server.listen(0);
    const socket = await connect(`ws://127.0.0.1:${port}/match`);
    const queue = new MessageQueue(socket);

    await send(
      socket,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('gamble-network-player'),
        heroId: heroId('H009'),
      }),
    );
    const joined = await queue.waitFor((message) => message.type === 'joined');
    if (joined.type !== 'joined') {
      throw new Error('expected gambling test player to join');
    }
    const simulation = (
      server.room as unknown as {
        readonly simulation: GameSimulation;
      }
    ).simulation;
    const state = (
      simulation as unknown as {
        readonly state: {
          tick: number;
          readonly players: Map<
            number,
            {
              position: { x: number; z: number };
              gold: number;
              heishanGambleCount: number;
            }
          >;
          readonly shops: Map<
            string,
            {
              position: { x: number; z: number };
              version: number;
            }
          >;
          readonly random: {
            readonly blackMountain: { snapshot(): number };
          };
        };
      }
    ).state;
    state.tick = 75 * 20;
    syncShops(state as unknown as Parameters<typeof syncShops>[0], []);
    const player = state.players.get(Number(joined.entityId));
    const shop = state.shops.get('heishan');
    if (!player || !shop) {
      throw new Error('authoritative gambling fixture is incomplete');
    }
    player.position = { x: 0, z: 0 };
    shop.position = { x: 0, z: 0 };
    player.gold = 10_000;

    const transaction: Extract<ClientMessage, { readonly type: 'gamble-gold' }> = {
      type: 'gamble-gold',
      protocolVersion: PROTOCOL_VERSION,
      transactionId: 'network-gamble-1',
      shopId: 'heishan',
      expectedVersion: shop.version,
      wagerGold: 500,
      mode: 'double',
    };
    await send(socket, clientCodec.encode(transaction));
    const first = await queue.waitFor(
      (message) =>
        message.type === 'transaction-result' &&
        message.transactionId === transaction.transactionId,
    );
    if (first.type !== 'transaction-result') {
      throw new Error('expected first gambling transaction result');
    }
    expect(first).toMatchObject({
      operation: 'gamble-gold',
      accepted: true,
      code: 'accepted',
    });
    const committedGold = player.gold;
    const committedHash = first.snapshot.stateHash;
    const committedRng = state.random.blackMountain.snapshot();
    expect(player.heishanGambleCount).toBe(1);

    await send(socket, clientCodec.encode(transaction));
    const duplicate = await queue.waitFor(
      (message) =>
        message.type === 'transaction-result' &&
        message.transactionId === transaction.transactionId,
    );
    if (duplicate.type !== 'transaction-result') {
      throw new Error('expected duplicate gambling transaction result');
    }
    expect(duplicate.snapshot.stateHash).toBe(committedHash);
    expect(player.heishanGambleCount).toBe(1);
    expect(player.gold).toBe(committedGold);
    expect(state.random.blackMountain.snapshot()).toBe(committedRng);

    socket.close();
    await server.close();
  });

  it('replays an identical airdrop transaction without creating a second channel', async () => {
    const server = createGameServer(0xa1_d0_51, { startRoomTimer: false });
    const port = await server.listen(0);
    const socket = await connect(`ws://127.0.0.1:${port}/match`);
    const queue = new MessageQueue(socket);

    await send(
      socket,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('airdrop-network-player'),
        heroId: heroId('H009'),
      }),
    );
    const joined = await queue.waitFor((message) => message.type === 'joined');
    if (joined.type !== 'joined') {
      throw new Error('expected airdrop test player to join');
    }

    const simulation = (
      server.room as unknown as {
        readonly simulation: GameSimulation;
      }
    ).simulation;
    const state = (
      simulation as unknown as {
        readonly state: {
          tick: number;
          nextAirdropChannelSequence: number;
          readonly players: Map<
            number,
            {
              position: { x: number; z: number };
              worldInteractionLockTicks: number;
            }
          >;
          readonly airdrops: Map<
            string,
            {
              phase: 'pending' | 'warning' | 'available' | 'opened' | 'expired';
              position: { x: number; z: number } | null;
              landedAtTick: number | null;
              expiresAtTick: number | null;
            }
          >;
          readonly airdropChannels: Map<number, unknown>;
          readonly random: {
            readonly airdrop: { snapshot(): number };
          };
        };
      }
    ).state;
    const player = state.players.get(Number(joined.entityId));
    const airdrop = state.airdrops.get('airdrop-1');
    if (!player || !airdrop) {
      throw new Error('authoritative airdrop fixture is incomplete');
    }
    player.position = { x: 0, z: 0 };
    airdrop.phase = 'available';
    airdrop.position = { x: 0, z: 0 };
    airdrop.landedAtTick = state.tick;
    airdrop.expiresAtTick = state.tick + 120 * 20;

    const transaction: Extract<ClientMessage, { readonly type: 'airdrop-open' }> = {
      type: 'airdrop-open',
      protocolVersion: PROTOCOL_VERSION,
      transactionId: 'network-airdrop-1',
      airdropId: 'airdrop-1',
    };
    await send(socket, clientCodec.encode(transaction));
    const first = await queue.waitFor(
      (message) =>
        message.type === 'transaction-result' &&
        message.transactionId === transaction.transactionId,
    );
    if (first.type !== 'transaction-result') {
      throw new Error('expected first airdrop transaction result');
    }
    expect(first).toMatchObject({
      operation: 'airdrop-open',
      accepted: true,
      code: 'accepted',
    });
    const committedHash = first.snapshot.stateHash;
    const committedSequence = state.nextAirdropChannelSequence;
    const committedRng = state.random.airdrop.snapshot();
    expect(state.airdropChannels.size).toBe(1);
    expect(player.worldInteractionLockTicks).toBe(60);

    await send(socket, clientCodec.encode(transaction));
    const duplicate = await queue.waitFor(
      (message) =>
        message.type === 'transaction-result' &&
        message.transactionId === transaction.transactionId,
    );
    if (duplicate.type !== 'transaction-result') {
      throw new Error('expected duplicate airdrop transaction result');
    }
    expect(duplicate.snapshot.stateHash).toBe(committedHash);
    expect(state.airdropChannels.size).toBe(1);
    expect(state.nextAirdropChannelSequence).toBe(committedSequence);
    expect(state.random.airdrop.snapshot()).toBe(committedRng);

    socket.close();
    await server.close();
  });

  it('matches the local simulation hash for the same seed, join order, and accepted input', async () => {
    const rootSeed = 0x5a17;
    const server = createGameServer(rootSeed, { startRoomTimer: false });
    const port = await server.listen(0);
    const first = await connect(`ws://127.0.0.1:${port}/match`);
    const second = await connect(`ws://127.0.0.1:${port}/match`);
    const firstQueue = new MessageQueue(first);
    const secondQueue = new MessageQueue(second);

    await send(
      first,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('hash-first'),
        heroId: heroId('H009'),
      }),
    );
    await send(
      second,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('hash-second'),
        heroId: heroId('H018'),
      }),
    );
    const firstJoined = await firstQueue.waitFor((message) => message.type === 'joined');
    const secondJoined = await secondQueue.waitFor((message) => message.type === 'joined');
    if (firstJoined.type !== 'joined' || secondJoined.type !== 'joined') {
      throw new Error('expected both clients to join');
    }

    const local = new GameSimulation({ rootSeed });
    const localFirst = local.addPlayer({
      playerId: playerId('hash-first'),
      heroId: heroId('H009'),
    });
    local.addPlayer({
      playerId: playerId('hash-second'),
      heroId: heroId('H018'),
    });
    expect(localFirst).toBe(firstJoined.entityId);

    const intent = createPlayerIntent({
      sequence: 1,
      moveX: 1_000,
      moveZ: -250,
      aimX: 900,
      aimZ: 100,
    });
    await send(
      first,
      clientCodec.encode({
        type: 'input',
        protocolVersion: PROTOCOL_VERSION,
        sequence: intent.sequence,
        moveX: intent.movement.x,
        moveZ: intent.movement.z,
        aimX: intent.aim.x,
        aimZ: intent.aim.z,
        attack: intent.attack,
        targetEntityId: intent.targetEntityId,
        castActive: intent.castActive,
        interact: intent.interact,
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    local.submitIntent(localFirst, intent);
    server.room.step();
    local.step();
    server.room.step();
    local.step();

    const serverSnapshotMessage = await firstQueue.waitFor(
      (message) =>
        message.type === 'snapshot' &&
        message.snapshot.tick === 2 &&
        message.acknowledgedInputSequence === 1,
    );
    if (serverSnapshotMessage.type !== 'snapshot') {
      throw new Error('expected deterministic server snapshot');
    }
    expect(serverSnapshotMessage.snapshot.stateHash).toBe(local.getStateHash());
    expect(server.room.getSnapshot().stateHash).toBe(local.getStateHash());

    first.close();
    second.close();
    await server.close();
  });

  it('executes skill-book replacement over WebSocket and rejects invalid replacements', async () => {
    const server = createGameServer(0x51_0f_12, { startRoomTimer: false });
    const port = await server.listen(0);
    const socket = await connect(`ws://127.0.0.1:${port}/match`);
    const queue = new MessageQueue(socket);

    await send(
      socket,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('skill-book-network-player'),
        heroId: heroId('H009'),
      }),
    );
    const joined = await queue.waitFor((message) => message.type === 'joined');
    if (joined.type !== 'joined') {
      throw new Error('expected skill-book test player to join');
    }

    const simulation = (
      server.room as unknown as {
        readonly simulation: GameSimulation;
      }
    ).simulation;
    const state = (
      simulation as unknown as {
        readonly state: {
          readonly players: Map<
            number,
            {
              position: { x: number; z: number };
              passives: { passiveId: string; level: 1 | 2 | 3 | 4 | 5 }[];
            }
          >;
          readonly lootDrops: Map<
            number,
            {
              entityId: number;
              position: { x: number; z: number };
              gold: number;
              experience: number;
              gems: number;
              equipmentId: null;
              bookPassiveId: string | null;
              createdAtTick: number;
              expiresAtTick: number;
            }
          >;
          nextEntityId: number;
        };
      }
    ).state;
    const player = state.players.get(Number(joined.entityId));
    if (!player) {
      throw new Error('authoritative skill-book player is missing');
    }
    player.position = { x: 0, z: 0 };
    player.passives.push(
      { passiveId: PASSIVE_IDS.critical, level: 1 },
      { passiveId: PASSIVE_IDS.reactiveShield, level: 1 },
      { passiveId: PASSIVE_IDS.feignDeath, level: 1 },
      { passiveId: PASSIVE_IDS.passiveRevive, level: 1 },
    );

    const createDrop = (
      position: { x: number; z: number },
      bookPassiveId: string | null,
    ): number => {
      const dropEntityId = state.nextEntityId;
      state.nextEntityId += 1;
      state.lootDrops.set(dropEntityId, {
        entityId: dropEntityId,
        position,
        gold: 0,
        experience: 0,
        gems: 0,
        equipmentId: null,
        bookPassiveId,
        createdAtTick: simulation.tick,
        expiresAtTick: simulation.tick + 2_400,
      });
      return dropEntityId;
    };

    const successfulDrop = createDrop({ x: 0, z: 0 }, 'B01');
    const replacement: Extract<ClientMessage, { readonly type: 'skill-book-replace' }> = {
      type: 'skill-book-replace',
      protocolVersion: PROTOCOL_VERSION,
      transactionId: 'network-book-replace-1',
      lootEntityId: entityId(successfulDrop),
      replacePassiveId: PASSIVE_IDS.critical,
    };
    await send(socket, clientCodec.encode(replacement));
    const accepted = await queue.waitFor(
      (message) =>
        message.type === 'transaction-result' &&
        message.transactionId === replacement.transactionId,
    );
    expect(accepted).toMatchObject({
      type: 'transaction-result',
      operation: 'skill-book-replace',
      accepted: true,
      code: 'accepted',
    });
    if (accepted.type !== 'transaction-result') {
      throw new Error('expected accepted skill-book replacement');
    }
    expect(
      accepted.snapshot.players.find((candidate) => candidate.entityId === joined.entityId)
        ?.passives,
    ).toContainEqual({ passiveId: 'B01', level: 1 });
    expect(accepted.snapshot.lootDrops.some((drop) => drop.entityId === successfulDrop)).toBe(
      false,
    );
    const acceptedHash = accepted.snapshot.stateHash;

    await send(socket, clientCodec.encode(replacement));
    const duplicate = await queue.waitFor(
      (message) =>
        message.type === 'transaction-result' &&
        message.transactionId === replacement.transactionId,
    );
    expect(duplicate).toMatchObject({
      type: 'transaction-result',
      accepted: true,
      code: 'accepted',
    });
    if (duplicate.type !== 'transaction-result') {
      throw new Error('expected duplicate skill-book transaction result');
    }
    expect(duplicate.snapshot.stateHash).toBe(acceptedHash);

    const nonSkillBook = createDrop({ x: 0, z: 0 }, null);
    await send(
      socket,
      clientCodec.encode({
        ...replacement,
        transactionId: 'network-book-not-a-book',
        lootEntityId: entityId(nonSkillBook),
      }),
    );
    await expect(
      queue.waitFor(
        (message) =>
          message.type === 'transaction-result' &&
          message.transactionId === 'network-book-not-a-book',
      ),
    ).resolves.toMatchObject({
      operation: 'skill-book-replace',
      accepted: false,
      code: 'loot-not-skill-book',
    });

    const farAwayBook = createDrop({ x: 10_000, z: 0 }, 'B02');
    await send(
      socket,
      clientCodec.encode({
        ...replacement,
        transactionId: 'network-book-too-far',
        lootEntityId: entityId(farAwayBook),
        replacePassiveId: PASSIVE_IDS.reactiveShield,
      }),
    );
    await expect(
      queue.waitFor(
        (message) =>
          message.type === 'transaction-result' && message.transactionId === 'network-book-too-far',
      ),
    ).resolves.toMatchObject({
      operation: 'skill-book-replace',
      accepted: false,
      code: 'skill-book-too-far',
    });

    const invalidReplacementBook = createDrop({ x: 0, z: 0 }, 'B02');
    await send(
      socket,
      clientCodec.encode({
        ...replacement,
        transactionId: 'network-book-invalid-replacement',
        lootEntityId: entityId(invalidReplacementBook),
        replacePassiveId: passiveId('B44'),
      }),
    );
    await expect(
      queue.waitFor(
        (message) =>
          message.type === 'transaction-result' &&
          message.transactionId === 'network-book-invalid-replacement',
      ),
    ).resolves.toMatchObject({
      operation: 'skill-book-replace',
      accepted: false,
      code: 'invalid-replacement',
    });

    socket.close();
    await server.close();
  });

  it('accepts thirty clients and rejects the thirty-first with ROOM_FULL', async () => {
    const server = createGameServer(0x30, { startRoomTimer: false });
    const port = await server.listen(0);
    const sockets = await Promise.all(
      Array.from({ length: 31 }, () => connect(`ws://127.0.0.1:${port}/match`)),
    );
    const queues = sockets.map((socket) => new MessageQueue(socket));

    for (let index = 0; index < 30; index += 1) {
      const socket = sockets[index];
      if (!socket) {
        throw new Error(`missing socket ${index}`);
      }
      await send(
        socket,
        clientCodec.encode({
          type: 'join',
          protocolVersion: PROTOCOL_VERSION,
          rulesetVersion: RULESET_VERSION,
          playerId: playerId(`capacity-ws-${index + 1}`),
          heroId: heroId('H009'),
        }),
      );
    }
    await Promise.all(
      queues.slice(0, 30).map((queue) => queue.waitFor((message) => message.type === 'joined')),
    );

    const overflowSocket = sockets[30];
    const overflowQueue = queues[30];
    if (!overflowSocket || !overflowQueue) {
      throw new Error('missing overflow client');
    }
    await send(
      overflowSocket,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('capacity-ws-31'),
        heroId: heroId('H009'),
      }),
    );
    const rejected = await overflowQueue.waitFor((message) => message.type === 'error');

    expect(rejected).toMatchObject({
      type: 'error',
      code: 'ROOM_FULL',
      message: 'room capacity is 30',
    });
    expect(server.room.getSnapshot().players).toHaveLength(30);

    for (const socket of sockets) {
      socket.close();
    }
    await server.close();
  });

  it('does not broadcast simulation events before a connection joins or resumes', async () => {
    const server = createGameServer(0xa110, { startRoomTimer: false });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const observer = await connect(url);
    const player = await connect(url);
    const observerQueue = new MessageQueue(observer);
    const playerQueue = new MessageQueue(player);

    await send(
      player,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: playerId('joined-event-player'),
        heroId: heroId('H009'),
      }),
    );
    await playerQueue.waitFor((message) => message.type === 'joined');
    server.room.step();

    await expect(
      observerQueue.waitFor((message) => message.type === 'events', 100),
    ).rejects.toThrow('timed out waiting for WebSocket message');

    observer.close();
    player.close();
    await server.close();
  });

  it('does not disclose distant combat events to an observer outside vision', async () => {
    const server = createGameServer(0x0b5e_7e, { startRoomTimer: false });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const attackerSocket = await connect(url);
    const victimSocket = await connect(url);
    const observerSocket = await connect(url);
    const attackerQueue = new MessageQueue(attackerSocket);
    const victimQueue = new MessageQueue(victimSocket);
    const observerQueue = new MessageQueue(observerSocket);

    const join = async (
      socket: WebSocket,
      queue: MessageQueue,
      id: string,
    ): Promise<Extract<ServerMessage, { readonly type: 'joined' }>> => {
      await send(
        socket,
        clientCodec.encode({
          type: 'join',
          protocolVersion: PROTOCOL_VERSION,
          rulesetVersion: RULESET_VERSION,
          playerId: playerId(id),
          heroId: heroId('H009'),
        }),
      );
      const message = await queue.waitFor((candidate) => candidate.type === 'joined');
      if (message.type !== 'joined') {
        throw new Error('expected observer visibility test player to join');
      }
      return message;
    };

    const attacker = await join(attackerSocket, attackerQueue, 'event-attacker');
    const victim = await join(victimSocket, victimQueue, 'event-victim');
    const observer = await join(observerSocket, observerQueue, 'event-observer');
    const simulation = (
      server.room as unknown as {
        readonly simulation: GameSimulation;
      }
    ).simulation;
    const state = (
      simulation as unknown as {
        readonly state: {
          readonly players: Map<number, { position: { x: number; z: number } }>;
        };
      }
    ).state;
    const attackerState = state.players.get(Number(attacker.entityId));
    const victimState = state.players.get(Number(victim.entityId));
    const observerState = state.players.get(Number(observer.entityId));
    if (!attackerState || !victimState || !observerState) {
      throw new Error('observer visibility test state is incomplete');
    }
    attackerState.position = { x: 0, z: 0 };
    victimState.position = { x: 1_000, z: 0 };
    observerState.position = { x: 100_000, z: 100_000 };

    simulation.drainEvents();
    simulation.damage(victim.entityId, 10, attacker.entityId, 'basic');
    server.room.step();
    const isTestDamage = (message: ServerMessage): boolean =>
      message.type === 'events' &&
      (message.events as readonly SimEvent[]).some(
        (event) =>
          event.type === 'damage' &&
          event.sourceEntityId === attacker.entityId &&
          event.targetEntityId === victim.entityId,
      );

    await expect(attackerQueue.waitFor(isTestDamage)).resolves.toMatchObject({
      type: 'events',
    });
    await expect(victimQueue.waitFor(isTestDamage)).resolves.toMatchObject({
      type: 'events',
    });
    await expect(observerQueue.waitFor(isTestDamage, 100)).rejects.toThrow(
      'timed out waiting for WebSocket message',
    );

    attackerSocket.close();
    victimSocket.close();
    observerSocket.close();
    await server.close();
  });

  it('broadcasts an odd-tick final snapshot exactly once', async () => {
    const server = createGameServer(0x51a7, { startRoomTimer: false });
    const port = await server.listen(0);
    const first = await connect(`ws://127.0.0.1:${port}/match`);
    const second = await connect(`ws://127.0.0.1:${port}/match`);
    const firstQueue = new MessageQueue(first);
    const secondQueue = new MessageQueue(second);

    for (const [socket, id, hero] of [
      [first, 'final-first', 'H009'],
      [second, 'final-second', 'H018'],
    ] as const) {
      await send(
        socket,
        clientCodec.encode({
          type: 'join',
          protocolVersion: PROTOCOL_VERSION,
          rulesetVersion: RULESET_VERSION,
          playerId: playerId(id),
          heroId: heroId(hero),
        }),
      );
    }
    const firstJoined = await firstQueue.waitFor((message) => message.type === 'joined');
    const secondJoined = await secondQueue.waitFor((message) => message.type === 'joined');
    if (firstJoined.type !== 'joined' || secondJoined.type !== 'joined') {
      throw new Error('expected joined clients');
    }

    const simulation = (
      server.room as unknown as {
        readonly simulation: GameSimulation;
      }
    ).simulation;
    simulation.step();
    for (let death = 0; death < 3; death += 1) {
      if (death === 2 && simulation.tick % 2 === 0) {
        simulation.step();
      }
      simulation.damage(secondJoined.entityId, 99_999, firstJoined.entityId);
      if (death < 2) {
        for (let tick = 0; tick < 500; tick += 1) {
          const loser = simulation
            .getSnapshot()
            .players.find((player) => player.entityId === secondJoined.entityId);
          if (loser?.lifeState === 'alive') {
            break;
          }
          simulation.step();
        }
      }
    }
    if (simulation.tick % 2 === 0) {
      throw new Error('test setup must finish on an odd tick');
    }

    server.room.step();
    const finalSnapshot = await firstQueue.waitFor(
      (message) =>
        message.type === 'snapshot' &&
        message.snapshot.match.status === 'finished' &&
        message.snapshot.tick % 2 === 1,
    );
    expect(finalSnapshot).toMatchObject({
      type: 'snapshot',
      snapshot: {
        match: {
          winnerEntityId: firstJoined.entityId,
        },
      },
    });

    server.room.step();
    await expect(
      firstQueue.waitFor(
        (message) =>
          message.type === 'snapshot' &&
          message.snapshot.tick ===
            (finalSnapshot.type === 'snapshot' ? finalSnapshot.snapshot.tick : -1),
        100,
      ),
    ).rejects.toThrow('timed out waiting for WebSocket message');

    first.close();
    second.close();
    await server.close();
  });

  it('resumes the same entity, continues input sequence, and rotates the recovery token', async () => {
    const server = createGameServer(0x7ec0, {
      startRoomTimer: false,
      resumeGracePeriodMs: 1_000,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const reconnectingPlayerId = playerId('resume-player');
    const first = await connect(url);
    const firstQueue = new MessageQueue(first);

    await send(
      first,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: reconnectingPlayerId,
        heroId: heroId('H009'),
      }),
    );
    const firstJoined = await firstQueue.waitFor((message) => message.type === 'joined');
    if (firstJoined.type !== 'joined') {
      throw new Error('expected first join');
    }

    await send(
      first,
      clientCodec.encode({
        type: 'input',
        protocolVersion: PROTOCOL_VERSION,
        sequence: 1,
        moveX: 1_000,
        moveZ: 0,
        aimX: 0,
        aimZ: 1_000,
        attack: false,
        targetEntityId: null,
        castActive: false,
        interact: false,
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    server.room.step();
    server.room.step();
    await firstQueue.waitFor(
      (message) => message.type === 'snapshot' && message.acknowledgedInputSequence === 1,
    );
    const beforeDisconnect = server.room
      .getSnapshot()
      .players.find((player) => player.entityId === firstJoined.entityId);
    if (!beforeDisconnect) {
      throw new Error('missing player before disconnect');
    }

    first.close();
    await waitForCondition(
      () => server.room.getPlayerSession(reconnectingPlayerId)?.state === 'disconnected',
    );
    expect(server.room.getPlayerSession(reconnectingPlayerId)).toMatchObject({
      entityId: firstJoined.entityId,
      acknowledgedInputSequence: 2,
      state: 'disconnected',
    });

    const resumedSocket = await connect(url);
    const resumedQueue = new MessageQueue(resumedSocket);
    await send(
      resumedSocket,
      clientCodec.encode({
        type: 'resume',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: reconnectingPlayerId,
        recoveryToken: firstJoined.recoveryToken,
      }),
    );
    const resumed = await resumedQueue.waitFor((message) => message.type === 'joined');
    if (resumed.type !== 'joined') {
      throw new Error('expected resumed join');
    }

    expect(resumed).toMatchObject({
      entityId: firstJoined.entityId,
      acknowledgedInputSequence: 2,
      resumed: true,
    });
    expect(resumed.recoveryToken).not.toBe(firstJoined.recoveryToken);
    expect(server.room.getSnapshot().players).toHaveLength(1);
    expect(
      server.room.getSnapshot().players.find((player) => player.entityId === resumed.entityId),
    ).toMatchObject({
      position: beforeDisconnect.position,
      hp: beforeDisconnect.hp,
      equipment: beforeDisconnect.equipment,
    });

    const resumedSnapshot = await resumedQueue.waitFor(
      (message) => message.type === 'snapshot' && message.snapshot.tick === resumed.serverTick,
    );
    if (resumedSnapshot.type !== 'snapshot') {
      throw new Error('expected resumed snapshot');
    }
    await send(
      resumedSocket,
      clientCodec.encode({
        type: 'snapshot-ack',
        protocolVersion: PROTOCOL_VERSION,
        snapshotTick: resumedSnapshot.snapshot.tick,
        stateHash: resumedSnapshot.snapshot.stateHash,
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    server.room.step();

    await send(
      resumedSocket,
      clientCodec.encode({
        type: 'input',
        protocolVersion: PROTOCOL_VERSION,
        sequence: 3,
        moveX: -1_000,
        moveZ: 0,
        aimX: 0,
        aimZ: 1_000,
        attack: false,
        targetEntityId: null,
        castActive: false,
        interact: false,
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    server.room.step();
    server.room.step();
    await resumedQueue.waitFor(
      (message) => message.type === 'snapshot' && message.acknowledgedInputSequence === 3,
    );

    const staleTokenSocket = await connect(url);
    const staleTokenQueue = new MessageQueue(staleTokenSocket);
    await send(
      staleTokenSocket,
      clientCodec.encode({
        type: 'resume',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: reconnectingPlayerId,
        recoveryToken: firstJoined.recoveryToken,
      }),
    );
    await expect(
      staleTokenQueue.waitFor((message) => message.type === 'error'),
    ).resolves.toMatchObject({
      type: 'error',
      code: 'RESUME_REJECTED',
    });
    expect(server.room.getPlayerSession(reconnectingPlayerId)?.state).toBe('connected');

    staleTokenSocket.close();
    resumedSocket.close();
    await server.close();
  });

  it('allows a valid recovery token to take over during a page reload race', async () => {
    const server = createGameServer(0x7ace, {
      startRoomTimer: false,
      resumeGracePeriodMs: 1_000,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const reloadPlayerId = playerId('reload-race-player');
    const oldSocket = await connect(url);
    const oldQueue = new MessageQueue(oldSocket);

    await send(
      oldSocket,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: reloadPlayerId,
        heroId: heroId('H018'),
      }),
    );
    const joined = await oldQueue.waitFor((message) => message.type === 'joined');
    if (joined.type !== 'joined') {
      throw new Error('expected initial page to join');
    }

    const newSocket = await connect(url);
    const newQueue = new MessageQueue(newSocket);
    await send(
      newSocket,
      clientCodec.encode({
        type: 'resume',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: reloadPlayerId,
        recoveryToken: joined.recoveryToken,
      }),
    );
    const resumed = await newQueue.waitFor((message) => message.type === 'joined');
    if (resumed.type !== 'joined') {
      throw new Error('expected reloaded page to resume');
    }

    expect(resumed).toMatchObject({
      entityId: joined.entityId,
      resumed: true,
    });
    await expect(oldQueue.waitFor((message) => message.type === 'error')).resolves.toMatchObject({
      type: 'error',
      code: 'SESSION_REPLACED',
    });
    expect(server.room.getSnapshot().players).toHaveLength(1);

    newSocket.close();
    await server.close();
  });

  it('expires recovery credentials without inventing a disconnect elimination rule', async () => {
    const server = createGameServer(0x7e57, {
      startRoomTimer: false,
      resumeGracePeriodMs: 40,
    });
    const port = await server.listen(0);
    const url = `ws://127.0.0.1:${port}/match`;
    const expiringPlayerId = playerId('expired-player');
    const first = await connect(url);
    const firstQueue = new MessageQueue(first);

    await send(
      first,
      clientCodec.encode({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: expiringPlayerId,
        heroId: heroId('H009'),
      }),
    );
    const joined = await firstQueue.waitFor((message) => message.type === 'joined');
    if (joined.type !== 'joined') {
      throw new Error('expected expiring player to join');
    }
    first.close();
    await waitForCondition(
      () => server.room.getPlayerSession(expiringPlayerId)?.state === 'expired',
    );

    const resumedSocket = await connect(url);
    const resumedQueue = new MessageQueue(resumedSocket);
    await send(
      resumedSocket,
      clientCodec.encode({
        type: 'resume',
        protocolVersion: PROTOCOL_VERSION,
        rulesetVersion: RULESET_VERSION,
        playerId: expiringPlayerId,
        recoveryToken: joined.recoveryToken,
      }),
    );
    await expect(
      resumedQueue.waitFor((message) => message.type === 'error'),
    ).resolves.toMatchObject({
      type: 'error',
      code: 'RESUME_REJECTED',
    });
    expect(server.room.getSnapshot().players).toHaveLength(1);
    expect(server.room.getSnapshot().players[0]).toMatchObject({
      entityId: joined.entityId,
      lifeState: 'alive',
    });

    resumedSocket.close();
    await server.close();
  });
});
