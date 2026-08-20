import {
  assertSafeInteger,
  type EntityId,
  type EquipmentInstanceId,
  type HeroId,
  invariant,
  type PlayerIntent,
} from '@jwgb/core';
import {
  createObserverWorldSnapshot,
  createWorldSnapshot,
  filterEventsForObserver,
} from './snapshot';
import { addPlayerToState, createSimulationState, getRequiredPlayer, sortedPlayers } from './state';
import { resolveActiveCasts } from './systems/active';
import { replaceActiveLootResult } from './systems/active-replacement';
import { canSeeActiveTarget } from './systems/active-targeting';
import { advanceActiveWorld } from './systems/active-world';
import { advanceAfterimages } from './systems/afterimage';
import {
  type AirdropTransactionResult,
  advanceAirdrops,
  initializeAirdrops,
  startAirdropOpenResult,
} from './systems/airdrop';
import { resolveBasicAttacks } from './systems/combat';
import { applyDamage } from './systems/damage';
import {
  discardEquipmentResult,
  type EquipmentTransactionResult,
  equipInventoryEquipmentResult,
  unequipEquipmentResult,
} from './systems/equipment-inventory';
import { pickupEquipmentLootResult } from './systems/equipment-loot-pickup';
import { advanceEquipmentRuntime } from './systems/equipment-runtime';
import {
  type GambleTransactionResult,
  gambleActiveResult,
  gambleEquipmentResult,
  gambleGoldResult,
  gamblePassiveResult,
} from './systems/gambling';
import { advanceLifeStates } from './systems/life';
import { resolveMatchOutcome, startMatchIfReady } from './systems/match';
import { applyMonsterDamage } from './systems/monster-damage';
import { advanceMovement } from './systems/movement';
import {
  type PassiveTransactionResult,
  replaceSkillBookResult,
  spendGemResult,
} from './systems/passive';
import { advancePassiveEconomy } from './systems/passive-economy';
import { advanceBountyMarks } from './systems/passive-kill';
import { advancePassiveDamageOverTime, advancePassiveRuntime } from './systems/passive-runtime';
import { advanceProjectiles } from './systems/projectile';
import { advancePve, initializePve } from './systems/pve';
import { advanceShields } from './systems/shield';
import {
  advanceShops,
  purchaseShopListing,
  purchaseShopListingResult,
  type ShopTransactionResult,
  sellShopEquipment,
  sellShopEquipmentResult,
  startHeroSwapResult,
  syncShops,
} from './systems/shop';
import { resolveApocalypseStorm } from './systems/storm';
import { advanceStormZone } from './systems/storm-zone';
import { advanceSummons } from './systems/summon';
import {
  advanceWhirlwindTimers,
  applyHardControl,
  resolveWhirlwindPulses,
} from './systems/whirlwind';
import { advanceWindWalls } from './systems/wind-wall';
import type {
  ActiveReplacementTransactionResult,
  AddPlayerOptions,
  DamageForm,
  EquipmentLootPickupDestination,
  EquipmentLootPickupTransactionResult,
  GambleGoldMode,
  MapSimulationOptions,
  MatchSnapshot,
  MonsterSnapshot,
  MutableSimulationState,
  PlayerSnapshot,
  PveSimulationOptions,
  ReplayInputEntry,
  ReplayRosterEntry,
  SimEvent,
  SimulationReplay,
  StaticSolidRect,
  WorldSnapshot,
} from './types';

export interface GameSimulationOptions {
  readonly rootSeed: number;
  readonly staticSolids?: readonly StaticSolidRect[];
  readonly pve?: PveSimulationOptions;
  readonly map?: MapSimulationOptions;
}

export type SimulationPlayerView = Pick<
  PlayerSnapshot,
  'entityId' | 'heroId' | 'position' | 'lifeState'
>;

export type SimulationBotPlayerView = Pick<
  PlayerSnapshot,
  'entityId' | 'position' | 'facing' | 'hp' | 'lifeState' | 'attackRangeMm'
>;

export type SimulationBotMonsterView = Pick<
  MonsterSnapshot,
  'entityId' | 'position' | 'hp' | 'kind'
>;

export interface SimulationBotWorldView {
  readonly match: Pick<MatchSnapshot, 'status'>;
  readonly players: readonly SimulationBotPlayerView[];
  readonly monsters: readonly SimulationBotMonsterView[];
}

export class GameSimulation {
  private readonly state: MutableSimulationState;
  private readonly pendingEvents: SimEvent[] = [];
  private readonly replayRoster: ReplayRosterEntry[] = [];
  private readonly replayInputs: ReplayInputEntry[] = [];

  constructor(options: GameSimulationOptions) {
    assertSafeInteger(options.rootSeed, 'rootSeed');
    this.state = createSimulationState(
      options.rootSeed,
      options.staticSolids,
      options.pve,
      options.map,
    );
    initializeAirdrops(this.state);
    initializePve(this.state, this.pendingEvents, options.pve ?? { enabled: false });
  }

  get tick(): number {
    return this.state.tick;
  }

  get playerCount(): number {
    return this.state.players.size;
  }

  get monsterCount(): number {
    return this.state.monsters.size;
  }

  get matchStatus(): MatchSnapshot['status'] {
    return this.state.match.status;
  }

  getPlayerViews(): readonly SimulationPlayerView[] {
    return sortedPlayers(this.state).map((player) => ({
      entityId: player.entityId,
      heroId: player.heroId,
      position: { x: player.position.x, z: player.position.z },
      lifeState: player.lifeState,
    }));
  }

  getBotWorldView(observerEntityId: EntityId): SimulationBotWorldView {
    const observer = getRequiredPlayer(this.state, observerEntityId);
    const players: SimulationBotPlayerView[] = [];
    const monsters: SimulationBotMonsterView[] = [];

    for (const player of this.state.players.values()) {
      if (
        player.entityId !== observerEntityId &&
        !canSeeActiveTarget(this.state, observer, player)
      ) {
        continue;
      }
      players.push({
        entityId: player.entityId,
        position: { x: player.position.x, z: player.position.z },
        facing: { x: player.facing.x, z: player.facing.z },
        hp: player.hp,
        lifeState: player.lifeState,
        attackRangeMm: player.attackRangeMm,
      });
    }

    for (const monster of this.state.monsters.values()) {
      if (!canSeeActiveTarget(this.state, observer, monster)) {
        continue;
      }
      monsters.push({
        entityId: monster.entityId,
        position: { x: monster.position.x, z: monster.position.z },
        hp: monster.hp,
        kind: monster.kind,
      });
    }

    return {
      match: { status: this.state.match.status },
      players,
      monsters,
    };
  }

  addPlayer(options: AddPlayerOptions): EntityId {
    invariant(this.state.match.status !== 'finished', 'cannot join a finished match');
    const player = addPlayerToState(this.state, options);
    this.replayRoster.push({
      entityId: player.entityId,
      joinedAtTick: this.state.tick,
      playerId: player.playerId,
      heroId: player.heroId,
      activeAbilityId: player.activeAbilityId,
      ...(options.position ? { position: { x: options.position.x, z: options.position.z } } : {}),
      passives: player.passives.map((entry) => ({ ...entry })),
      equipmentIds: player.equipment.map((instance) => instance.equipmentId),
    });
    this.pendingEvents.push({
      type: 'player-added',
      tick: this.state.tick,
      entityId: player.entityId,
      playerId: player.playerId,
      heroId: player.heroId,
    });
    return player.entityId;
  }

  submitIntent(targetEntityId: EntityId, intent: PlayerIntent): boolean {
    if (this.state.match.status === 'finished') {
      return false;
    }
    const player = getRequiredPlayer(this.state, targetEntityId);
    if (intent.sequence <= player.intent.sequence || player.lifeState === 'eliminated') {
      return false;
    }

    player.intent = intent;
    this.replayInputs.push({
      atTick: this.state.tick,
      entityId: targetEntityId,
      intent,
    });
    return true;
  }

  step(count = 1): void {
    assertSafeInteger(count, 'step count');
    invariant(count > 0, 'step count must be positive');
    if (this.state.match.status === 'finished') {
      return;
    }
    startMatchIfReady(this.state, this.pendingEvents);

    for (let iteration = 0; iteration < count; iteration += 1) {
      this.state.tick += 1;
      advanceStormZone(this.state, this.pendingEvents);
      advanceShops(this.state, this.pendingEvents);
      advancePassiveEconomy(this.state, this.pendingEvents);
      advanceShields(this.state);
      advanceWindWalls(this.state, this.pendingEvents);
      advanceWhirlwindTimers(this.state, this.pendingEvents);
      advanceLifeStates(this.state, this.pendingEvents);
      advanceBountyMarks(this.state);
      advancePassiveRuntime(this.state, this.pendingEvents);
      advanceEquipmentRuntime(this.state, this.pendingEvents);
      advancePassiveDamageOverTime(this.state, this.pendingEvents, applyDamage, applyMonsterDamage);
      advanceActiveWorld(this.state, this.pendingEvents);
      resolveActiveCasts(this.state, this.pendingEvents);
      advanceMovement(this.state, this.pendingEvents);
      advanceAfterimages(this.state, this.pendingEvents);
      resolveWhirlwindPulses(this.state, this.pendingEvents);
      resolveBasicAttacks(this.state, this.pendingEvents);
      advanceProjectiles(this.state, this.pendingEvents);
      advanceSummons(this.state, this.pendingEvents);
      advancePve(this.state, this.pendingEvents);
      resolveApocalypseStorm(this.state, this.pendingEvents);
      advanceAirdrops(this.state, this.pendingEvents);
      resolveMatchOutcome(this.state, this.pendingEvents);
      if (this.state.match.finishedAtTick !== null) {
        break;
      }
    }
  }

  damage(
    targetEntityId: EntityId,
    amount: number,
    sourceEntityId: EntityId | null = null,
    form: DamageForm = 'true',
  ): number {
    if (this.state.match.status === 'finished') {
      return 0;
    }
    startMatchIfReady(this.state, this.pendingEvents);
    const appliedDamage = applyDamage(this.state, this.pendingEvents, {
      sourceEntityId,
      targetEntityId,
      amount,
      cause: 'debug',
      form,
    });
    resolveMatchOutcome(this.state, this.pendingEvents);
    return appliedDamage;
  }

  purchaseShopListing(
    playerEntityId: EntityId,
    shopId: string,
    listingId: string,
    expectedVersion: number,
    destination: 'equipped' | 'inventory' = 'inventory',
  ): boolean {
    if (this.state.match.status === 'finished') {
      return false;
    }
    startMatchIfReady(this.state, this.pendingEvents);
    syncShops(this.state, this.pendingEvents);
    return purchaseShopListing(
      this.state,
      this.pendingEvents,
      playerEntityId,
      shopId,
      listingId,
      expectedVersion,
      destination,
    );
  }

  purchaseShopListingResult(
    playerEntityId: EntityId,
    shopId: string,
    listingId: string,
    expectedVersion: number,
    destination: 'equipped' | 'inventory' = 'inventory',
  ): ShopTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'match-finished' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    syncShops(this.state, this.pendingEvents);
    return purchaseShopListingResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      shopId,
      listingId,
      expectedVersion,
      destination,
    );
  }

  sellShopEquipment(
    playerEntityId: EntityId,
    shopId: string,
    instanceId: EquipmentInstanceId,
    expectedVersion: number,
  ): boolean {
    if (this.state.match.status === 'finished') {
      return false;
    }
    startMatchIfReady(this.state, this.pendingEvents);
    syncShops(this.state, this.pendingEvents);
    return sellShopEquipment(
      this.state,
      this.pendingEvents,
      playerEntityId,
      shopId,
      instanceId,
      expectedVersion,
    );
  }

  sellShopEquipmentResult(
    playerEntityId: EntityId,
    shopId: string,
    instanceId: EquipmentInstanceId,
    expectedVersion: number,
  ): ShopTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'match-finished' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    syncShops(this.state, this.pendingEvents);
    return sellShopEquipmentResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      shopId,
      instanceId,
      expectedVersion,
    );
  }

  startHeroSwapResult(
    playerEntityId: EntityId,
    shopId: string,
    expectedVersion: number,
    targetHeroId: HeroId,
  ): ShopTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'match-finished' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    syncShops(this.state, this.pendingEvents);
    return startHeroSwapResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      shopId,
      expectedVersion,
      targetHeroId,
    );
  }

  gamblePassiveResult(
    playerEntityId: EntityId,
    shopId: string,
    expectedVersion: number,
    passiveId: import('@jwgb/core').PassiveId,
  ): GambleTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'player-not-alive' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    syncShops(this.state, this.pendingEvents);
    return gamblePassiveResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      shopId,
      expectedVersion,
      passiveId,
    );
  }

  gambleEquipmentResult(
    playerEntityId: EntityId,
    shopId: string,
    expectedVersion: number,
    instanceId: EquipmentInstanceId,
  ): GambleTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'player-not-alive' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    syncShops(this.state, this.pendingEvents);
    return gambleEquipmentResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      shopId,
      expectedVersion,
      instanceId,
    );
  }

  gambleActiveResult(
    playerEntityId: EntityId,
    shopId: string,
    expectedVersion: number,
  ): GambleTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'player-not-alive' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    syncShops(this.state, this.pendingEvents);
    return gambleActiveResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      shopId,
      expectedVersion,
    );
  }

  gambleGoldResult(
    playerEntityId: EntityId,
    shopId: string,
    expectedVersion: number,
    wagerGold: number,
    mode: GambleGoldMode = 'double',
  ): GambleTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'player-not-alive' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    syncShops(this.state, this.pendingEvents);
    return gambleGoldResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      shopId,
      expectedVersion,
      wagerGold,
      mode,
    );
  }

  equipInventoryEquipmentResult(
    playerEntityId: EntityId,
    instanceId: EquipmentInstanceId,
    replacementInstanceId: EquipmentInstanceId | null = null,
  ): EquipmentTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'player-not-alive' };
    }
    return equipInventoryEquipmentResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      instanceId,
      replacementInstanceId,
    );
  }

  unequipEquipmentResult(
    playerEntityId: EntityId,
    instanceId: EquipmentInstanceId,
  ): EquipmentTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'player-not-alive' };
    }
    return unequipEquipmentResult(this.state, this.pendingEvents, playerEntityId, instanceId);
  }

  discardEquipmentResult(
    playerEntityId: EntityId,
    instanceId: EquipmentInstanceId,
  ): EquipmentTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'player-not-alive' };
    }
    return discardEquipmentResult(this.state, this.pendingEvents, playerEntityId, instanceId);
  }

  spendGem(playerEntityId: EntityId, passiveId: import('@jwgb/core').PassiveId): boolean {
    return this.spendGemResult(playerEntityId, passiveId).accepted;
  }

  spendGemResult(
    playerEntityId: EntityId,
    passiveId: import('@jwgb/core').PassiveId,
  ): PassiveTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'match-finished' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    return spendGemResult(this.state, this.pendingEvents, playerEntityId, passiveId);
  }

  replaceSkillBook(
    playerEntityId: EntityId,
    lootEntityId: EntityId,
    replacePassiveId: import('@jwgb/core').PassiveId,
  ): boolean {
    return this.replaceSkillBookResult(playerEntityId, lootEntityId, replacePassiveId).accepted;
  }

  replaceSkillBookResult(
    playerEntityId: EntityId,
    lootEntityId: EntityId,
    replacePassiveId: import('@jwgb/core').PassiveId,
  ): PassiveTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'match-finished' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    return replaceSkillBookResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      lootEntityId,
      replacePassiveId,
    );
  }

  replaceActiveLootResult(
    playerEntityId: EntityId,
    lootEntityId: EntityId,
    confirm: boolean,
  ): ActiveReplacementTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'match-finished' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    return replaceActiveLootResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      lootEntityId,
      confirm,
    );
  }

  pickupEquipmentLootResult(
    playerEntityId: EntityId,
    lootEntityId: EntityId,
    destination: EquipmentLootPickupDestination,
    replacementInstanceId: EquipmentInstanceId | null = null,
  ): EquipmentLootPickupTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'match-finished' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    return pickupEquipmentLootResult(
      this.state,
      this.pendingEvents,
      playerEntityId,
      lootEntityId,
      destination,
      replacementInstanceId,
    );
  }

  hardControl(targetEntityId: EntityId, durationTicks: number): boolean {
    assertSafeInteger(durationTicks, 'hard control duration');
    invariant(durationTicks > 0, 'hard control duration must be positive');
    if (this.state.match.status === 'finished') {
      return false;
    }
    return applyHardControl(
      getRequiredPlayer(this.state, targetEntityId),
      durationTicks,
      this.state,
      this.pendingEvents,
    );
  }

  startAirdropOpenResult(playerEntityId: EntityId, airdropId: string): AirdropTransactionResult {
    if (this.state.match.status === 'finished') {
      return { accepted: false, code: 'match-finished' };
    }
    startMatchIfReady(this.state, this.pendingEvents);
    return startAirdropOpenResult(this.state, this.pendingEvents, playerEntityId, airdropId);
  }

  getSnapshot(options: { readonly includeStateHash?: boolean } = {}): WorldSnapshot {
    return createWorldSnapshot(this.state, options.includeStateHash === false);
  }

  getObserverSnapshot(observerEntityId: EntityId, baseSnapshot?: WorldSnapshot): WorldSnapshot {
    return createObserverWorldSnapshot(this.state, observerEntityId, baseSnapshot);
  }

  getObserverEvents(
    observerEntityId: EntityId,
    events: readonly SimEvent[],
    baseSnapshot?: WorldSnapshot,
  ): readonly SimEvent[] {
    return filterEventsForObserver(this.state, observerEntityId, events, baseSnapshot);
  }

  getStateHash(): string {
    return this.getSnapshot().stateHash;
  }

  drainEvents(): readonly SimEvent[] {
    return this.pendingEvents.splice(0, this.pendingEvents.length);
  }

  exportReplay(): SimulationReplay {
    return {
      rootSeed: this.state.rootSeed,
      staticSolids: this.state.staticSolids.map((solid) => ({ ...solid })),
      pve: {
        enabled: this.state.pveEnabled,
        population: this.state.pvePopulation,
      },
      map: { enabled: this.state.mapField !== null },
      roster: [...this.replayRoster],
      inputs: [...this.replayInputs],
      finalTick: this.state.tick,
      expectedStateHash: this.getStateHash(),
    };
  }
}
