import type { EntityId, EquipmentInstanceId, HeroId, PassiveId } from '@jwgb/core';
import type { ServerMessage } from '@jwgb/protocol';
import type { GambleGoldMode, SimEvent, WorldSnapshot } from '@jwgb/sim';
import type { InputController } from '../input/input-controller';

export type WorldTransactionResult = Pick<
  Extract<ServerMessage, { readonly type: 'transaction-result' }>,
  'transactionId' | 'operation' | 'accepted' | 'code' | 'message'
>;

export type WorldConnectionState =
  | 'local'
  | 'connecting'
  | 'reconnecting'
  | 'online'
  | 'disconnected'
  | 'error';

export interface HostFrame {
  readonly snapshot: WorldSnapshot | null;
  readonly events: readonly SimEvent[];
  readonly transactionResults: readonly WorldTransactionResult[];
  readonly connectionState: WorldConnectionState;
}

export interface WorldHost {
  readonly mode: 'local' | 'online';
  readonly canRestart: boolean;
  readonly localEntityId: EntityId | null;
  update(deltaMs: number, input: InputController): HostFrame;
  getSnapshot(): WorldSnapshot | null;
  purchaseShopListing(
    shopId: string,
    listingId: string,
    expectedVersion: number,
    destination: 'equipped' | 'inventory',
  ): string;
  sellShopEquipment(
    shopId: string,
    instanceId: EquipmentInstanceId,
    expectedVersion: number,
  ): string;
  startHeroSwap(shopId: string, expectedVersion: number, targetHeroId: HeroId): string;
  gamblePassive(shopId: string, expectedVersion: number, passiveId: PassiveId): string;
  gambleEquipment(shopId: string, expectedVersion: number, instanceId: EquipmentInstanceId): string;
  gambleActive(shopId: string, expectedVersion: number): string;
  gambleGold(
    shopId: string,
    expectedVersion: number,
    wagerGold: number,
    mode: GambleGoldMode,
  ): string;
  openAirdrop(airdropId: string): string;
  spendGem(passiveId: PassiveId): string;
  replaceSkillBook(lootEntityId: EntityId, replacePassiveId: PassiveId): string;
  replaceActiveLoot(lootEntityId: EntityId, confirm: boolean): string;
  pickupEquipmentLoot(
    lootEntityId: EntityId,
    destination: 'inventory' | 'equipped' | 'cancel',
    replacementInstanceId?: EquipmentInstanceId | null,
  ): string;
  equipInventoryEquipment(
    instanceId: EquipmentInstanceId,
    replacementInstanceId?: EquipmentInstanceId | null,
  ): string;
  unequipEquipment(instanceId: EquipmentInstanceId): string;
  discardEquipment(instanceId: EquipmentInstanceId): string;
  reset(): void;
  dispose(): void;
}
