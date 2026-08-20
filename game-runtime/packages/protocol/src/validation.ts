import {
  assertIntegerInRange,
  assertSafeInteger,
  entityId,
  equipmentId,
  equipmentInstanceId,
  heroId,
  invariant,
  passiveId,
} from '@jwgb/core';
import { type ClientMessage, PROTOCOL_VERSION, type ServerMessage } from './messages';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateTransactionId(value: unknown): void {
  invariant(
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value),
    'transactionId must be a base64url string',
  );
}

function validateCredential(value: unknown, path: string): void {
  invariant(
    typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value),
    `${path} must be a base64url credential`,
  );
}

function validateShopListing(value: unknown, path: string): void {
  invariant(isRecord(value), `${path} must be an object`);
  invariant(
    typeof value.listingId === 'string' && value.listingId.length > 0,
    `${path}.listingId is invalid`,
  );
  invariant(
    value.kind === 'equipment' || value.kind === 'gem' || value.kind === 'consumable',
    `${path}.kind is invalid`,
  );
  assertSafeInteger(value.price as number, `${path}.price`);
  invariant((value.price as number) >= 0, `${path}.price must be non-negative`);

  if (value.kind === 'equipment') {
    invariant(typeof value.equipmentId === 'string', `${path}.equipmentId is invalid`);
    equipmentId(value.equipmentId);
    invariant(
      value.consumableId === undefined || value.consumableId === null,
      `${path}.consumableId must be empty for equipment`,
    );
    return;
  }

  invariant(value.equipmentId === null, `${path}.equipmentId must be null`);
  if (value.kind === 'gem') {
    invariant(
      value.consumableId === undefined || value.consumableId === null,
      `${path}.consumableId must be empty for gems`,
    );
    return;
  }
  invariant(
    value.consumableId === 'clairvoyance-talisman' ||
      value.consumableId === 'demon-revealing-mirror',
    `${path}.consumableId is invalid`,
  );
}

function validateShopSnapshot(value: unknown, index: number): void {
  const path = `snapshot.shops[${index}]`;
  invariant(isRecord(value), `${path} must be an object`);
  invariant(
    typeof value.shopId === 'string' && value.shopId.length > 0,
    `${path}.shopId is invalid`,
  );
  invariant(
    value.kind === 'land-god' ||
      value.kind === 'shoemaker' ||
      value.kind === 'taibai' ||
      value.kind === 'heishan',
    `${path}.kind is invalid`,
  );
  invariant(isRecord(value.position), `${path}.position must be an object`);
  assertSafeInteger(value.position.x as number, `${path}.position.x`);
  assertSafeInteger(value.position.z as number, `${path}.position.z`);
  invariant(
    value.anchorId === null || typeof value.anchorId === 'string',
    `${path}.anchorId is invalid`,
  );
  invariant(
    value.macroId === null || typeof value.macroId === 'string',
    `${path}.macroId is invalid`,
  );
  assertSafeInteger(value.openAtTick as number, `${path}.openAtTick`);
  assertSafeInteger(value.closeAtTick as number, `${path}.closeAtTick`);
  invariant(
    (value.openAtTick as number) >= 0 &&
      (value.closeAtTick as number) > (value.openAtTick as number),
    `${path} window is invalid`,
  );
  assertSafeInteger(value.version as number, `${path}.version`);
  invariant((value.version as number) > 0, `${path}.version must be positive`);
  invariant(value.status === 'open' || value.status === 'relocating', `${path}.status is invalid`);
  assertSafeInteger(value.nextRelocationAttemptTick as number, `${path}.nextRelocationAttemptTick`);
  invariant(
    (value.nextRelocationAttemptTick as number) >= 0,
    `${path}.nextRelocationAttemptTick must be non-negative`,
  );
  invariant(Array.isArray(value.inventory), `${path}.inventory must be an array`);
  value.inventory.forEach((listing, listingIndex) => {
    validateShopListing(listing, `${path}.inventory[${listingIndex}]`);
  });
}

export function validateClientMessage(value: unknown): asserts value is ClientMessage {
  invariant(isRecord(value), 'client message must be an object');
  invariant(value.protocolVersion === PROTOCOL_VERSION, 'protocol version mismatch');
  invariant(typeof value.type === 'string', 'client message type must be a string');

  switch (value.type) {
    case 'matchmaking-enqueue':
      invariant(typeof value.rulesetVersion === 'string', 'rulesetVersion must be a string');
      invariant(typeof value.playerId === 'string', 'playerId must be a string');
      break;
    case 'matchmaking-cancel':
      break;
    case 'matchmaking-reroll':
      invariant(
        typeof value.matchId === 'string' && value.matchId.length > 0,
        'matchId is invalid',
      );
      break;
    case 'matchmaking-select':
      invariant(
        typeof value.matchId === 'string' && value.matchId.length > 0,
        'matchId is invalid',
      );
      invariant(typeof value.heroId === 'string', 'heroId must be a string');
      heroId(value.heroId);
      break;
    case 'join':
      invariant(typeof value.rulesetVersion === 'string', 'rulesetVersion must be a string');
      invariant(typeof value.playerId === 'string', 'playerId must be a string');
      invariant(typeof value.heroId === 'string', 'heroId must be a string');
      if (value.matchTicket !== undefined) {
        validateCredential(value.matchTicket, 'matchTicket');
      }
      break;
    case 'resume':
      invariant(typeof value.rulesetVersion === 'string', 'rulesetVersion must be a string');
      invariant(typeof value.playerId === 'string', 'playerId must be a string');
      invariant(typeof value.recoveryToken === 'string', 'recoveryToken must be a string');
      invariant(
        /^[A-Za-z0-9_-]{32,128}$/.test(value.recoveryToken),
        'recoveryToken must be a base64url credential',
      );
      break;
    case 'snapshot-ack':
      assertSafeInteger(value.snapshotTick as number, 'snapshotTick');
      invariant(
        typeof value.stateHash === 'string' &&
          value.stateHash.length > 0 &&
          value.stateHash.length <= 128,
        'stateHash must be a non-empty string',
      );
      break;
    case 'airdrop-open':
      validateTransactionId(value.transactionId);
      invariant(
        typeof value.airdropId === 'string' && /^airdrop-[1-3]$/.test(value.airdropId),
        'airdropId is invalid',
      );
      break;
    case 'input':
      assertSafeInteger(value.sequence as number, 'sequence');
      assertIntegerInRange(value.moveX as number, -1_000, 1_000, 'moveX');
      assertIntegerInRange(value.moveZ as number, -1_000, 1_000, 'moveZ');
      assertIntegerInRange(value.aimX as number, -1_000, 1_000, 'aimX');
      assertIntegerInRange(value.aimZ as number, -1_000, 1_000, 'aimZ');
      invariant(typeof value.attack === 'boolean', 'attack must be boolean');
      invariant(
        value.targetEntityId === null || Number.isSafeInteger(value.targetEntityId),
        'targetEntityId must be an integer or null',
      );
      invariant(
        value.secondaryTargetEntityId === undefined ||
          value.secondaryTargetEntityId === null ||
          Number.isSafeInteger(value.secondaryTargetEntityId),
        'secondaryTargetEntityId must be an integer or null',
      );
      invariant(typeof value.castActive === 'boolean', 'castActive must be boolean');
      invariant(
        value.alternateActive === undefined || typeof value.alternateActive === 'boolean',
        'alternateActive must be boolean',
      );
      invariant(typeof value.interact === 'boolean', 'interact must be boolean');
      break;
    case 'ping':
      invariant(typeof value.clientTime === 'number', 'clientTime must be a number');
      break;
    case 'shop-purchase':
      validateTransactionId(value.transactionId);
      invariant(typeof value.shopId === 'string' && value.shopId.length > 0, 'shopId is invalid');
      invariant(
        typeof value.listingId === 'string' && value.listingId.length > 0,
        'listingId is invalid',
      );
      assertSafeInteger(value.expectedVersion as number, 'expectedVersion');
      invariant(
        value.destination === 'equipped' || value.destination === 'inventory',
        'destination is invalid',
      );
      break;
    case 'shop-sale':
      validateTransactionId(value.transactionId);
      invariant(typeof value.shopId === 'string' && value.shopId.length > 0, 'shopId is invalid');
      assertSafeInteger(value.instanceId as number, 'instanceId');
      equipmentInstanceId(value.instanceId as number);
      assertSafeInteger(value.expectedVersion as number, 'expectedVersion');
      break;
    case 'hero-swap':
      validateTransactionId(value.transactionId);
      invariant(typeof value.shopId === 'string' && value.shopId.length > 0, 'shopId is invalid');
      assertSafeInteger(value.expectedVersion as number, 'expectedVersion');
      invariant(typeof value.targetHeroId === 'string', 'targetHeroId must be a string');
      heroId(value.targetHeroId);
      break;
    case 'gamble-passive':
      validateTransactionId(value.transactionId);
      invariant(typeof value.shopId === 'string' && value.shopId.length > 0, 'shopId is invalid');
      assertSafeInteger(value.expectedVersion as number, 'expectedVersion');
      invariant(typeof value.passiveId === 'string', 'passiveId must be a string');
      passiveId(value.passiveId);
      break;
    case 'gamble-equipment':
      validateTransactionId(value.transactionId);
      invariant(typeof value.shopId === 'string' && value.shopId.length > 0, 'shopId is invalid');
      assertSafeInteger(value.expectedVersion as number, 'expectedVersion');
      assertSafeInteger(value.instanceId as number, 'instanceId');
      equipmentInstanceId(value.instanceId as number);
      break;
    case 'gamble-active':
      validateTransactionId(value.transactionId);
      invariant(typeof value.shopId === 'string' && value.shopId.length > 0, 'shopId is invalid');
      assertSafeInteger(value.expectedVersion as number, 'expectedVersion');
      break;
    case 'gamble-gold':
      validateTransactionId(value.transactionId);
      invariant(typeof value.shopId === 'string' && value.shopId.length > 0, 'shopId is invalid');
      assertSafeInteger(value.expectedVersion as number, 'expectedVersion');
      assertSafeInteger(value.wagerGold as number, 'wagerGold');
      invariant((value.wagerGold as number) > 0, 'wagerGold must be positive');
      invariant(value.mode === 'double' || value.mode === 'purple', 'gamble gold mode is invalid');
      break;
    case 'spend-gem':
      validateTransactionId(value.transactionId);
      invariant(typeof value.passiveId === 'string', 'passiveId must be a string');
      passiveId(value.passiveId);
      break;
    case 'skill-book-replace':
      validateTransactionId(value.transactionId);
      assertSafeInteger(value.lootEntityId as number, 'lootEntityId');
      entityId(value.lootEntityId as number);
      invariant(typeof value.replacePassiveId === 'string', 'replacePassiveId must be a string');
      passiveId(value.replacePassiveId);
      break;
    case 'active-loot-replace':
      validateTransactionId(value.transactionId);
      assertSafeInteger(value.lootEntityId as number, 'lootEntityId');
      entityId(value.lootEntityId as number);
      invariant(typeof value.confirm === 'boolean', 'confirm must be boolean');
      break;
    case 'equipment-loot-pickup':
      validateTransactionId(value.transactionId);
      assertSafeInteger(value.lootEntityId as number, 'lootEntityId');
      entityId(value.lootEntityId as number);
      invariant(
        value.destination === 'inventory' ||
          value.destination === 'equipped' ||
          value.destination === 'cancel',
        'equipment pickup destination is invalid',
      );
      invariant(
        value.replacementInstanceId === null || Number.isSafeInteger(value.replacementInstanceId),
        'replacementInstanceId must be an integer or null',
      );
      if (value.replacementInstanceId !== null) {
        equipmentInstanceId(value.replacementInstanceId as number);
      }
      break;
    case 'equipment-equip':
      validateTransactionId(value.transactionId);
      assertSafeInteger(value.instanceId as number, 'instanceId');
      equipmentInstanceId(value.instanceId as number);
      invariant(
        value.replacementInstanceId === null || Number.isSafeInteger(value.replacementInstanceId),
        'replacementInstanceId must be an integer or null',
      );
      if (value.replacementInstanceId !== null) {
        equipmentInstanceId(value.replacementInstanceId as number);
      }
      break;
    case 'equipment-unequip':
    case 'equipment-discard':
      validateTransactionId(value.transactionId);
      assertSafeInteger(value.instanceId as number, 'instanceId');
      equipmentInstanceId(value.instanceId as number);
      break;
    default:
      throw new Error(`unsupported client message type: ${value.type}`);
  }
}

export function validateServerMessage(value: unknown): asserts value is ServerMessage {
  invariant(isRecord(value), 'server message must be an object');
  invariant(value.protocolVersion === PROTOCOL_VERSION, 'protocol version mismatch');
  invariant(typeof value.type === 'string', 'server message type must be a string');

  switch (value.type) {
    case 'matchmaking-queued':
      validateCredential(value.queueId, 'queueId');
      assertSafeInteger(value.queuePosition as number, 'queuePosition');
      invariant((value.queuePosition as number) > 0, 'queuePosition must be positive');
      invariant(typeof value.serverTime === 'number', 'serverTime must be a number');
      break;
    case 'matchmaking-selection':
      invariant(
        typeof value.matchId === 'string' && value.matchId.length > 0,
        'matchId is invalid',
      );
      invariant(Array.isArray(value.offers), 'offers must be an array');
      invariant(value.offers.length > 0 && value.offers.length <= 8, 'offers length is invalid');
      value.offers.forEach((offeredHeroId, index) => {
        invariant(typeof offeredHeroId === 'string', `offers[${index}] must be a string`);
        heroId(offeredHeroId);
      });
      invariant(
        value.recommendedHeroId === null || typeof value.recommendedHeroId === 'string',
        'recommendedHeroId is invalid',
      );
      if (value.recommendedHeroId !== null) {
        heroId(value.recommendedHeroId);
      }
      assertSafeInteger(value.selectionRemainingMs as number, 'selectionRemainingMs');
      invariant(
        (value.selectionRemainingMs as number) >= 0,
        'selectionRemainingMs must be non-negative',
      );
      assertSafeInteger(value.matchGold as number, 'matchGold');
      invariant((value.matchGold as number) >= 0, 'matchGold must be non-negative');
      assertSafeInteger(value.rerollCount as number, 'rerollCount');
      invariant((value.rerollCount as number) >= 0, 'rerollCount must be non-negative');
      invariant(
        value.selectedHeroId === null || typeof value.selectedHeroId === 'string',
        'selectedHeroId is invalid',
      );
      if (value.selectedHeroId !== null) {
        heroId(value.selectedHeroId);
      }
      break;
    case 'matchmaking-assigned':
      invariant(
        typeof value.matchId === 'string' && value.matchId.length > 0,
        'matchId is invalid',
      );
      invariant(typeof value.heroId === 'string', 'heroId must be a string');
      heroId(value.heroId);
      validateCredential(value.matchTicket, 'matchTicket');
      assertSafeInteger(value.ticketExpiresAtMs as number, 'ticketExpiresAtMs');
      invariant(typeof value.roomId === 'string' && value.roomId.length > 0, 'roomId is invalid');
      break;
    case 'matchmaking-cancelled':
      invariant(
        value.reason === 'client' || value.reason === 'expired' || value.reason === 'server',
        'matchmaking cancellation reason is invalid',
      );
      break;
    case 'joined':
      assertSafeInteger(value.entityId as number, 'entityId');
      assertSafeInteger(value.serverTick as number, 'serverTick');
      assertSafeInteger(value.acknowledgedInputSequence as number, 'acknowledgedInputSequence');
      assertSafeInteger(value.resumeGracePeriodMs as number, 'resumeGracePeriodMs');
      invariant(typeof value.rulesetVersion === 'string', 'rulesetVersion must be a string');
      invariant(typeof value.recoveryToken === 'string', 'recoveryToken must be a string');
      invariant(
        /^[A-Za-z0-9_-]{32,128}$/.test(value.recoveryToken),
        'recoveryToken must be a base64url credential',
      );
      invariant(typeof value.resumed === 'boolean', 'resumed must be boolean');
      break;
    case 'snapshot': {
      assertSafeInteger(value.acknowledgedInputSequence as number, 'acknowledgedInputSequence');
      invariant(isRecord(value.snapshot), 'snapshot must be an object');
      assertSafeInteger(value.snapshot.tick as number, 'snapshot.tick');
      assertSafeInteger(value.snapshot.rootSeed as number, 'snapshot.rootSeed');
      invariant(
        (value.snapshot.rootSeed as number) >= 0 &&
          (value.snapshot.rootSeed as number) <= 0xffff_ffff,
        'snapshot.rootSeed must be an unsigned 32-bit integer',
      );
      invariant(
        typeof value.snapshot.stateHash === 'string',
        'snapshot.stateHash must be a string',
      );
      invariant(isRecord(value.snapshot.stormZone), 'snapshot.stormZone must be an object');
      invariant(
        typeof value.snapshot.stormZone.radiusMm === 'number' &&
          Number.isSafeInteger(value.snapshot.stormZone.radiusMm),
        'snapshot.stormZone.radiusMm must be an integer',
      );
      invariant(isRecord(value.snapshot.match), 'snapshot.match must be an object');
      invariant(
        value.snapshot.match.status === 'waiting' ||
          value.snapshot.match.status === 'running' ||
          value.snapshot.match.status === 'finished',
        'snapshot.match.status is invalid',
      );
      invariant(
        value.snapshot.match.outcome === null ||
          value.snapshot.match.outcome === 'winner' ||
          value.snapshot.match.outcome === 'tied-first' ||
          value.snapshot.match.outcome === 'draw' ||
          value.snapshot.match.outcome === 'void-abort',
        'snapshot.match.outcome is invalid',
      );
      invariant(
        value.snapshot.match.winnerEntityId === null ||
          Number.isSafeInteger(value.snapshot.match.winnerEntityId),
        'snapshot.match.winnerEntityId is invalid',
      );
      invariant(
        Array.isArray(value.snapshot.match.winnerEntityIds),
        'snapshot.match.winnerEntityIds must be an array',
      );
      value.snapshot.match.winnerEntityIds.forEach((id, index) => {
        assertSafeInteger(id as number, `snapshot.match.winnerEntityIds[${index}]`);
        entityId(id as number);
      });
      invariant(
        Array.isArray(value.snapshot.match.placements),
        'snapshot.match.placements must be an array',
      );
      value.snapshot.match.placements.forEach((id, index) => {
        assertSafeInteger(id as number, `snapshot.match.placements[${index}]`);
        entityId(id as number);
      });
      invariant(
        Array.isArray(value.snapshot.match.placementGroups),
        'snapshot.match.placementGroups must be an array',
      );
      value.snapshot.match.placementGroups.forEach((group, groupIndex) => {
        invariant(
          Array.isArray(group),
          `snapshot.match.placementGroups[${groupIndex}] must be an array`,
        );
        group.forEach((id, index) => {
          assertSafeInteger(
            id as number,
            `snapshot.match.placementGroups[${groupIndex}][${index}]`,
          );
          entityId(id as number);
        });
      });
      invariant(
        value.snapshot.match.voidAbortReason === null ||
          value.snapshot.match.voidAbortReason === 'VOID_ABORT',
        'snapshot.match.voidAbortReason is invalid',
      );
      invariant(
        typeof value.snapshot.match.mmrEligible === 'boolean',
        'snapshot.match.mmrEligible must be boolean',
      );
      invariant(
        Array.isArray(value.snapshot.match.cultivationAwards),
        'snapshot.match.cultivationAwards must be an array',
      );
      value.snapshot.match.cultivationAwards.forEach((award, index) => {
        invariant(isRecord(award), `snapshot.match.cultivationAwards[${index}] must be an object`);
        assertSafeInteger(
          award.entityId as number,
          `snapshot.match.cultivationAwards[${index}].entityId`,
        );
        entityId(award.entityId as number);
        assertSafeInteger(
          award.amount as number,
          `snapshot.match.cultivationAwards[${index}].amount`,
        );
        invariant(
          (award.amount as number) >= 0,
          `snapshot.match.cultivationAwards[${index}].amount must be non-negative`,
        );
      });
      invariant(
        typeof value.snapshot.match.diagnosticReplayRequired === 'boolean',
        'snapshot.match.diagnosticReplayRequired must be boolean',
      );
      invariant(Array.isArray(value.snapshot.players), 'snapshot.players must be an array');
      invariant(Array.isArray(value.snapshot.monsters), 'snapshot.monsters must be an array');
      invariant(
        Array.isArray(value.snapshot.monsterRespawns),
        'snapshot.monsterRespawns must be an array',
      );
      invariant(
        Array.isArray(value.snapshot.coreBossRuntimes),
        'snapshot.coreBossRuntimes must be an array',
      );
      invariant(
        Array.isArray(value.snapshot.coreBossHazards),
        'snapshot.coreBossHazards must be an array',
      );
      invariant(
        Array.isArray(value.snapshot.coreBossRevealAnchors),
        'snapshot.coreBossRevealAnchors must be an array',
      );
      invariant(
        Array.isArray(value.snapshot.coreBossThreat),
        'snapshot.coreBossThreat must be an array',
      );
      invariant(
        Array.isArray(value.snapshot.pendingActiveReplacements),
        'snapshot.pendingActiveReplacements must be an array',
      );
      invariant(
        Array.isArray(value.snapshot.pendingEquipmentPickups),
        'snapshot.pendingEquipmentPickups must be an array',
      );
      invariant(Array.isArray(value.snapshot.lootDrops), 'snapshot.lootDrops must be an array');
      invariant(Array.isArray(value.snapshot.summons), 'snapshot.summons must be an array');
      invariant(Array.isArray(value.snapshot.afterimages), 'snapshot.afterimages must be an array');
      invariant(Array.isArray(value.snapshot.bountyMarks), 'snapshot.bountyMarks must be an array');
      invariant(
        Array.isArray(value.snapshot.passiveTargetStates),
        'snapshot.passiveTargetStates must be an array',
      );
      invariant(Array.isArray(value.snapshot.shops), 'snapshot.shops must be an array');
      value.snapshot.shops.forEach(validateShopSnapshot);
      invariant(Array.isArray(value.snapshot.airdrops), 'snapshot.airdrops must be an array');
      invariant(
        Array.isArray(value.snapshot.airdropChannels),
        'snapshot.airdropChannels must be an array',
      );
      invariant(Array.isArray(value.snapshot.windWalls), 'snapshot.windWalls must be an array');
      invariant(Array.isArray(value.snapshot.projectiles), 'snapshot.projectiles must be an array');
      invariant(
        Array.isArray(value.snapshot.activeProjectiles),
        'snapshot.activeProjectiles must be an array',
      );
      invariant(Array.isArray(value.snapshot.activeZones), 'snapshot.activeZones must be an array');
      invariant(
        Array.isArray(value.snapshot.activeTargetEffects),
        'snapshot.activeTargetEffects must be an array',
      );
      invariant(
        Array.isArray(value.snapshot.staticSolids),
        'snapshot.staticSolids must be an array',
      );
      break;
    }
    case 'events':
      invariant(Array.isArray(value.events), 'events must be an array');
      break;
    case 'pong':
      invariant(typeof value.clientTime === 'number', 'clientTime must be a number');
      invariant(typeof value.serverTime === 'number', 'serverTime must be a number');
      break;
    case 'transaction-result':
      validateTransactionId(value.transactionId);
      invariant(
        value.operation === 'shop-purchase' ||
          value.operation === 'shop-sale' ||
          value.operation === 'hero-swap' ||
          value.operation === 'gamble-passive' ||
          value.operation === 'gamble-equipment' ||
          value.operation === 'gamble-active' ||
          value.operation === 'gamble-gold' ||
          value.operation === 'spend-gem' ||
          value.operation === 'skill-book-replace' ||
          value.operation === 'active-loot-replace' ||
          value.operation === 'equipment-loot-pickup' ||
          value.operation === 'equipment-equip' ||
          value.operation === 'equipment-unequip' ||
          value.operation === 'equipment-discard' ||
          value.operation === 'airdrop-open',
        'transaction operation is invalid',
      );
      invariant(typeof value.accepted === 'boolean', 'transaction accepted must be boolean');
      invariant(typeof value.code === 'string', 'transaction code must be a string');
      invariant(typeof value.message === 'string', 'transaction message must be a string');
      assertSafeInteger(value.acknowledgedInputSequence as number, 'acknowledgedInputSequence');
      invariant(isRecord(value.snapshot), 'transaction snapshot must be an object');
      assertSafeInteger(value.snapshot.tick as number, 'transaction snapshot.tick');
      assertSafeInteger(value.snapshot.rootSeed as number, 'transaction snapshot.rootSeed');
      invariant(
        (value.snapshot.rootSeed as number) >= 0 &&
          (value.snapshot.rootSeed as number) <= 0xffff_ffff,
        'transaction snapshot.rootSeed must be an unsigned 32-bit integer',
      );
      invariant(
        typeof value.snapshot.stateHash === 'string',
        'transaction snapshot.stateHash must be a string',
      );
      break;
    case 'error':
      invariant(typeof value.code === 'string', 'error code must be a string');
      invariant(typeof value.message === 'string', 'error message must be a string');
      break;
    default:
      throw new Error(`unsupported server message type: ${value.type}`);
  }
}
