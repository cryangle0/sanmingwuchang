import { EQUIPMENT_IDS, HERO_IDS, PASSIVE_IDS } from '@jwgb/content';
import {
  createPlayerIntent,
  type EntityId,
  type EquipmentInstanceId,
  type HeroId,
  type PassiveId,
  playerId,
  TICK_DURATION_MS,
  vec2Mm,
} from '@jwgb/core';
import { GameSimulation, type SimEvent, type WorldSnapshot } from '@jwgb/sim';
import type { InputController } from '../input/input-controller';
import { DEFAULT_LOCAL_WORLD_SCENARIO, type LocalWorldScenario } from './local-scenario';
import type { HostFrame, WorldHost, WorldTransactionResult } from './world-host';

export class LocalWorldHost implements WorldHost {
  readonly mode = 'local' as const;
  readonly canRestart = true;
  private simulation: GameSimulation;
  private accumulatorMs = 0;
  private localSequence = 0;
  private readonly botSequences = new Map<EntityId, number>();
  private events: SimEvent[] = [];
  private transactionResults: WorldTransactionResult[] = [];
  private transactionSequence = 0;
  private combatStarted = false;
  private snapshot: WorldSnapshot;
  localEntityId: EntityId;

  constructor(private readonly scenario: LocalWorldScenario = DEFAULT_LOCAL_WORLD_SCENARIO) {
    this.simulation = this.createSimulation();
    this.localEntityId = this.populateWorld();
    this.events.push(...this.simulation.drainEvents());
    this.snapshot = this.simulation.getSnapshot();
  }

  update(deltaMs: number, input: InputController): HostFrame {
    this.accumulatorMs = Math.min(this.accumulatorMs + deltaMs, TICK_DURATION_MS * 5);
    let advanced = false;

    while (this.accumulatorMs >= TICK_DURATION_MS) {
      this.localSequence += 1;
      const localIntent = input.sample(this.localSequence);
      if (localIntent.attack || localIntent.castActive) {
        this.combatStarted = true;
      }
      this.simulation.submitIntent(this.localEntityId, localIntent);
      this.submitBotInputs();
      this.simulation.step();
      this.events.push(...this.simulation.drainEvents());
      this.accumulatorMs -= TICK_DURATION_MS;
      advanced = true;
    }
    if (advanced) {
      this.refreshSnapshot(false);
    }

    const frame = {
      snapshot: this.snapshot,
      events: this.events,
      transactionResults: this.transactionResults,
      connectionState: 'local' as const,
    };
    this.events = [];
    this.transactionResults = [];
    return frame;
  }

  reset(): void {
    this.simulation = this.createSimulation();
    this.accumulatorMs = 0;
    this.localSequence = 0;
    this.combatStarted = false;
    this.botSequences.clear();
    this.events = [];
    this.transactionResults = [];
    this.transactionSequence = 0;
    this.localEntityId = this.populateWorld();
    this.events.push(...this.simulation.drainEvents());
    this.refreshSnapshot();
  }

  getSnapshot(): WorldSnapshot {
    return this.simulation.getSnapshot();
  }

  exportReplay(): ReturnType<GameSimulation['exportReplay']> {
    return this.simulation.exportReplay();
  }

  dispose(): void {}

  purchaseShopListing(
    shopId: string,
    listingId: string,
    expectedVersion: number,
    destination: 'equipped' | 'inventory',
  ): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.purchaseShopListingResult(
      this.localEntityId,
      shopId,
      listingId,
      expectedVersion,
      destination,
    );
    this.transactionResults.push({
      transactionId,
      operation: 'shop-purchase',
      accepted: result.accepted,
      code: result.code,
      message: result.code === 'accepted' ? 'transaction accepted' : result.code,
    });
    this.events.push(...this.simulation.drainEvents());
    this.refreshSnapshot();
    return transactionId;
  }

  sellShopEquipment(
    shopId: string,
    instanceId: EquipmentInstanceId,
    expectedVersion: number,
  ): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.sellShopEquipmentResult(
      this.localEntityId,
      shopId,
      instanceId,
      expectedVersion,
    );
    this.transactionResults.push({
      transactionId,
      operation: 'shop-sale',
      accepted: result.accepted,
      code: result.code,
      message: result.code === 'accepted' ? 'transaction accepted' : result.code,
    });
    this.events.push(...this.simulation.drainEvents());
    this.refreshSnapshot();
    return transactionId;
  }

  startHeroSwap(shopId: string, expectedVersion: number, targetHeroId: HeroId): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.startHeroSwapResult(
      this.localEntityId,
      shopId,
      expectedVersion,
      targetHeroId,
    );
    this.recordWorldTransaction(transactionId, 'hero-swap', result);
    return transactionId;
  }

  gamblePassive(shopId: string, expectedVersion: number, passiveId: PassiveId): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.gamblePassiveResult(
      this.localEntityId,
      shopId,
      expectedVersion,
      passiveId,
    );
    this.recordWorldTransaction(transactionId, 'gamble-passive', result);
    return transactionId;
  }

  gambleEquipment(
    shopId: string,
    expectedVersion: number,
    instanceId: EquipmentInstanceId,
  ): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.gambleEquipmentResult(
      this.localEntityId,
      shopId,
      expectedVersion,
      instanceId,
    );
    this.recordWorldTransaction(transactionId, 'gamble-equipment', result);
    return transactionId;
  }

  gambleActive(shopId: string, expectedVersion: number): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.gambleActiveResult(this.localEntityId, shopId, expectedVersion);
    this.recordWorldTransaction(transactionId, 'gamble-active', result);
    return transactionId;
  }

  gambleGold(
    shopId: string,
    expectedVersion: number,
    wagerGold: number,
    mode: import('@jwgb/sim').GambleGoldMode,
  ): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.gambleGoldResult(
      this.localEntityId,
      shopId,
      expectedVersion,
      wagerGold,
      mode,
    );
    this.recordWorldTransaction(transactionId, 'gamble-gold', result);
    return transactionId;
  }

  openAirdrop(airdropId: string): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.startAirdropOpenResult(this.localEntityId, airdropId);
    this.recordWorldTransaction(transactionId, 'airdrop-open', result);
    return transactionId;
  }

  spendGem(passiveId: PassiveId): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.spendGemResult(this.localEntityId, passiveId);
    this.transactionResults.push({
      transactionId,
      operation: 'spend-gem',
      accepted: result.accepted,
      code: result.code,
      message: result.code === 'accepted' ? 'transaction accepted' : result.code,
    });
    this.events.push(...this.simulation.drainEvents());
    this.refreshSnapshot();
    return transactionId;
  }

  replaceSkillBook(lootEntityId: EntityId, replacePassiveId: PassiveId): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.replaceSkillBookResult(
      this.localEntityId,
      lootEntityId,
      replacePassiveId,
    );
    this.transactionResults.push({
      transactionId,
      operation: 'skill-book-replace',
      accepted: result.accepted,
      code: result.code,
      message: result.code === 'accepted' ? 'transaction accepted' : result.code,
    });
    this.events.push(...this.simulation.drainEvents());
    this.refreshSnapshot();
    return transactionId;
  }

  replaceActiveLoot(lootEntityId: EntityId, confirm: boolean): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.replaceActiveLootResult(
      this.localEntityId,
      lootEntityId,
      confirm,
    );
    this.transactionResults.push({
      transactionId,
      operation: 'active-loot-replace',
      accepted: result.accepted,
      code: result.code,
      message: result.code === 'accepted' ? 'transaction accepted' : result.code,
    });
    this.events.push(...this.simulation.drainEvents());
    this.refreshSnapshot();
    return transactionId;
  }

  pickupEquipmentLoot(
    lootEntityId: EntityId,
    destination: 'inventory' | 'equipped' | 'cancel',
    replacementInstanceId: EquipmentInstanceId | null = null,
  ): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.pickupEquipmentLootResult(
      this.localEntityId,
      lootEntityId,
      destination,
      replacementInstanceId,
    );
    this.transactionResults.push({
      transactionId,
      operation: 'equipment-loot-pickup',
      accepted: result.accepted,
      code: result.code,
      message: result.code === 'accepted' ? 'transaction accepted' : result.code,
    });
    this.events.push(...this.simulation.drainEvents());
    this.refreshSnapshot();
    return transactionId;
  }

  equipInventoryEquipment(
    instanceId: EquipmentInstanceId,
    replacementInstanceId: EquipmentInstanceId | null = null,
  ): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.equipInventoryEquipmentResult(
      this.localEntityId,
      instanceId,
      replacementInstanceId,
    );
    this.recordEquipmentTransaction(transactionId, 'equipment-equip', result);
    return transactionId;
  }

  unequipEquipment(instanceId: EquipmentInstanceId): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.unequipEquipmentResult(this.localEntityId, instanceId);
    this.recordEquipmentTransaction(transactionId, 'equipment-unequip', result);
    return transactionId;
  }

  discardEquipment(instanceId: EquipmentInstanceId): string {
    const transactionId = this.nextTransactionId();
    const result = this.simulation.discardEquipmentResult(this.localEntityId, instanceId);
    this.recordEquipmentTransaction(transactionId, 'equipment-discard', result);
    return transactionId;
  }

  private recordEquipmentTransaction(
    transactionId: string,
    operation: 'equipment-equip' | 'equipment-unequip' | 'equipment-discard',
    result: { readonly accepted: boolean; readonly code: string },
  ): void {
    this.transactionResults.push({
      transactionId,
      operation,
      accepted: result.accepted,
      code: result.code,
      message: result.code === 'accepted' ? 'transaction accepted' : result.code,
    });
    this.events.push(...this.simulation.drainEvents());
    this.refreshSnapshot();
  }

  private recordWorldTransaction(
    transactionId: string,
    operation:
      | 'hero-swap'
      | 'gamble-passive'
      | 'gamble-equipment'
      | 'gamble-active'
      | 'gamble-gold'
      | 'airdrop-open',
    result: { readonly accepted: boolean; readonly code: string },
  ): void {
    this.transactionResults.push({
      transactionId,
      operation,
      accepted: result.accepted,
      code: result.code,
      message: result.code === 'accepted' ? 'transaction accepted' : result.code,
    });
    this.events.push(...this.simulation.drainEvents());
    this.refreshSnapshot();
  }

  private createSimulation(): GameSimulation {
    return new GameSimulation({
      rootSeed: 0x2026_0723,
      staticSolids: this.scenario.staticSolids,
      ...(this.scenario.pve ? { pve: this.scenario.pve } : {}),
      map: { enabled: this.scenario.mapEnabled ?? false },
    });
  }

  private populateWorld(): EntityId {
    const local = this.simulation.addPlayer({
      playerId: playerId('local-wukong'),
      heroId: this.scenario.localHeroId ?? HERO_IDS.sunWukong,
      ...(this.scenario.localPosition ? { position: this.scenario.localPosition } : {}),
      ...(this.scenario.activeAbilityId ? { activeAbilityId: this.scenario.activeAbilityId } : {}),
      passives: [
        ...(this.scenario.passives ?? [
          { passiveId: PASSIVE_IDS.feignDeath, level: 5 as const },
          { passiveId: PASSIVE_IDS.passiveRevive, level: 5 as const },
        ]),
      ],
      equipmentIds: this.scenario.equipmentIds ?? [EQUIPMENT_IDS.nineTurnPill],
    });
    if (this.scenario.mapEnabled) {
      // Map bots spawn on authoritative map spawn points spread across zones.
      const botHeroes = [
        HERO_IDS.ironFanPrincess,
        HERO_IDS.bullDemonKing,
        HERO_IDS.ironFanPrincess,
        HERO_IDS.bullDemonKing,
        HERO_IDS.ironFanPrincess,
        HERO_IDS.bullDemonKing,
      ];
      const botCount = Math.min(this.scenario.botCount ?? 2, botHeroes.length);
      for (let index = 0; index < botCount; index += 1) {
        const bot = this.simulation.addPlayer({
          playerId: playerId(`bot-${index}`),
          heroId: botHeroes[index] ?? HERO_IDS.bullDemonKing,
        });
        this.botSequences.set(bot, 0);
      }
      return local;
    }
    const ironFan = this.simulation.addPlayer({
      playerId: playerId('bot-iron-fan'),
      heroId: HERO_IDS.ironFanPrincess,
      position: vec2Mm(18_000, -7_000),
    });
    const bull = this.simulation.addPlayer({
      playerId: playerId('bot-bull'),
      heroId: HERO_IDS.bullDemonKing,
      position: vec2Mm(-14_000, 8_000),
    });
    this.botSequences.set(ironFan, 0);
    this.botSequences.set(bull, 0);
    return local;
  }

  private submitBotInputs(): void {
    const players = this.simulation.getPlayerViews();
    const local = players.find((player) => player.entityId === this.localEntityId);
    if (!local) {
      return;
    }

    for (const bot of players) {
      if (bot.entityId === this.localEntityId || bot.lifeState !== 'alive') {
        continue;
      }
      const target = players
        .filter(
          (candidate) => candidate.entityId !== bot.entityId && candidate.lifeState === 'alive',
        )
        .sort((left, right) => {
          const leftDx = left.position.x - bot.position.x;
          const leftDz = left.position.z - bot.position.z;
          const rightDx = right.position.x - bot.position.x;
          const rightDz = right.position.z - bot.position.z;
          return (
            leftDx * leftDx + leftDz * leftDz - (rightDx * rightDx + rightDz * rightDz) ||
            Number(left.entityId) - Number(right.entityId)
          );
        })[0];
      if (!target) {
        continue;
      }

      const currentSequence = this.botSequences.get(bot.entityId) ?? 0;
      const dx = target.position.x - bot.position.x;
      const dz = target.position.z - bot.position.z;
      const distanceSquared = dx * dx + dz * dz;
      const holdDistanceMm = bot.heroId === HERO_IDS.ironFanPrincess ? 14_000 : 2_500;
      const shouldAdvance = distanceSquared > holdDistanceMm * holdDistanceMm;
      const moveScale = Math.max(Math.abs(dx), Math.abs(dz), 1);
      const moveX = shouldAdvance ? Math.trunc((dx * 1_000) / moveScale) : 0;
      const moveZ = shouldAdvance ? Math.trunc((dz * 1_000) / moveScale) : 0;
      const nextSequence = currentSequence + 1;

      this.simulation.submitIntent(
        bot.entityId,
        createPlayerIntent({
          sequence: nextSequence,
          moveX,
          moveZ,
          aimX: Math.trunc((dx * 1_000) / moveScale),
          aimZ: Math.trunc((dz * 1_000) / moveScale),
          attack: this.combatStarted,
          targetEntityId: target.entityId,
          castActive: this.combatStarted,
        }),
      );
      this.botSequences.set(bot.entityId, nextSequence);
    }
  }

  private nextTransactionId(): string {
    this.transactionSequence += 1;
    return `local-tx-${this.transactionSequence}`;
  }

  private refreshSnapshot(includeStateHash = true): void {
    this.snapshot = this.simulation.getSnapshot({ includeStateHash });
  }
}
