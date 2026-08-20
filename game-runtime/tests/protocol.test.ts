import { RULESET_VERSION } from '@jwgb/content';
import { heroId, playerId } from '@jwgb/core';
import {
  type ClientMessage,
  JsonMessageCodec,
  PROTOCOL_VERSION,
  validateServerMessage,
} from '@jwgb/protocol';

describe('M1 JSON protocol codec', () => {
  it('round-trips a versioned join message', () => {
    const codec = new JsonMessageCodec<ClientMessage>([
      'join',
      'resume',
      'snapshot-ack',
      'input',
      'ping',
      'shop-purchase',
      'shop-sale',
      'spend-gem',
      'skill-book-replace',
    ]);
    const message: ClientMessage = {
      type: 'join',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: playerId('player-1'),
      heroId: heroId('H009'),
    };

    expect(codec.decode(codec.encode(message))).toEqual(message);
  });

  it('rejects unknown message types', () => {
    const codec = new JsonMessageCodec<ClientMessage>([
      'join',
      'resume',
      'snapshot-ack',
      'input',
      'ping',
      'shop-purchase',
      'shop-sale',
      'spend-gem',
      'skill-book-replace',
    ]);
    expect(() => codec.decode('{"type":"cheat","damage":999999}')).toThrow(
      'unsupported message type',
    );
  });

  it('round-trips a recovery credential without treating it as gameplay state', () => {
    const codec = new JsonMessageCodec<ClientMessage>([
      'join',
      'resume',
      'snapshot-ack',
      'input',
      'ping',
      'shop-purchase',
      'shop-sale',
      'spend-gem',
      'skill-book-replace',
    ]);
    const message: ClientMessage = {
      type: 'resume',
      protocolVersion: PROTOCOL_VERSION,
      rulesetVersion: RULESET_VERSION,
      playerId: playerId('player-1'),
      recoveryToken: 'a'.repeat(43),
    };

    expect(codec.decode(codec.encode(message))).toEqual(message);
  });

  it('rejects malformed server snapshots before the client applies them', () => {
    expect(() =>
      validateServerMessage({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        acknowledgedInputSequence: 1,
        snapshot: {
          tick: 2,
          rootSeed: 77,
          stateHash: 'deadbeef',
          stormZone: {
            selectedCourtId: null,
            courtAnnouncementTick: 14_400,
            warningTick: 23_940,
            center: { x: 0, z: 0 },
            radiusMm: 520_000,
            courtAnnounced: false,
            apocalypseWarning: false,
            apocalypseStarted: false,
          },
          match: { status: 'invalid' },
          players: [],
          monsters: [],
          monsterRespawns: [],
          lootDrops: [],
          summons: [],
          afterimages: [],
          bountyMarks: [],
          passiveTargetStates: [],
          shops: [],
          airdrops: [],
          airdropChannels: [],
          windWalls: [],
          projectiles: [],
          activeProjectiles: [],
          activeZones: [],
          activeTargetEffects: [],
          staticSolids: [],
        },
      }),
    ).toThrow('snapshot.match.status is invalid');
  });
});
