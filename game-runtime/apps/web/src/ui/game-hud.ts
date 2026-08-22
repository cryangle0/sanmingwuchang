import {
  EQUIPMENT_IDS,
  getActiveDefinition,
  getAuthoritativePassive,
  getEquipmentDefinition,
  getHeroDefinition,
} from '@jwgb/content';
import { distanceSquaredMm, type EntityId, heroId, TICKS_PER_SECOND } from '@jwgb/core';
import type { PlayerSnapshot, SimEvent, WorldSnapshot } from '@jwgb/sim';
import { describeStormForPlayer, type StormPlayerStatus } from '@jwgb/sim';
import {
  ArrowUp,
  Camera,
  ChevronDown,
  createElement,
  Hand,
  Heart,
  MapPin,
  RotateCcw,
  ShoppingBag,
  Sword,
  Wifi,
} from 'lucide';
import type { InputController } from '../input/input-controller';
import type { CameraViewState } from '../render/arena-renderer';
import {
  activePresentationRange,
  type CombatRangePreviewMode,
} from '../render/combat-range-preview';
import {
  activeIconUrl,
  equipmentIconUrl,
  heroPortraitUrl,
  passiveIconUrl,
} from '../runtime/asset-url';
import type {
  WorldConnectionState,
  WorldHost,
  WorldTransactionResult,
} from '../runtime/world-host';
import {
  clusterLootHeaps,
  heapFocusKey,
  lootDropKindLabel,
  lootDropTitle,
  nearbyLootDrops,
  nearbyShop,
  shopDisplayName,
  shopStatusLabel,
  stableTaibaiOffers,
  WORLD_SHEET_PAGE_SIZE,
} from './world-proximity';

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing HUD element: ${selector}`);
  }
  return element;
}

function tryCapturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Synthetic QA events are not registered as active OS pointers.
  }
}

function formatTime(tick: number): string {
  const seconds = Math.floor(tick / TICKS_PER_SECOND);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

const ELEMENT_LABELS: Readonly<Record<string, string>> = {
  metal: '金',
  wood: '木',
  water: '水',
  fire: '火',
  earth: '土',
};

const XP_CUMULATIVE: readonly number[] = [
  0, 50, 120, 210, 320, 450, 605, 785, 995, 1_235, 1_510, 1_825, 2_275, 2_825, 3_525,
];

function experienceProgress(player: PlayerSnapshot): number {
  if (player.level >= 15) {
    return 1;
  }
  const current = XP_CUMULATIVE[player.level - 1] ?? 0;
  const next = XP_CUMULATIVE[player.level] ?? current + 1;
  return Math.max(0, Math.min(1, (player.experience - current) / Math.max(1, next - current)));
}

function monsterDisplayName(kind: string): string {
  const names: Readonly<Record<string, string>> = {
    'ground-melee': '近战妖兵',
    'ground-ranged': '远程妖兵',
    flying: '飞行妖兵',
    'elite-tank': '重甲精英',
    'elite-ranged': '远程精英',
    pig: '五行肥猪',
    'dragon-king': '五行龙王',
    'core-boss': '核心首领',
  };
  return names[kind] ?? kind;
}

function eventText(event: SimEvent, localEntityId: EntityId): string | null {
  if (event.type === 'active-cast' && event.entityId === localEntityId) {
    return `${event.activeName}已发动`;
  }
  if (event.type === 'active-target-missing' && event.entityId === localEntityId) {
    return `${event.activeName}释放失败：范围内没有有效目标`;
  }
  if (event.type === 'active-cast-blocked' && event.entityId === localEntityId) {
    return event.reason === 'polymorphed'
      ? `${event.activeName}释放失败：变形期间无法施法`
      : `${event.activeName}释放失败：当前被位移锁定`;
  }
  if (event.type === 'active-unavailable' && event.entityId === localEntityId) {
    return `${event.activeName}当前不可用`;
  }
  if (event.type === 'blink' && event.entityId === localEntityId) {
    const meters = (event.actualDistanceMm / 1_000).toFixed(2);
    return event.blockingSolidId ? `闪现 ${meters} 米，前方受阻` : `闪现 ${meters} 米`;
  }
  if (event.type === 'true-death' && event.entityId === localEntityId) {
    return event.livesRemaining > 0 ? `真死，第 ${event.trueDeaths} 命已失` : '第三次真死';
  }
  if (event.type === 'respawn' && event.entityId === localEntityId) {
    return '灵魂归位';
  }
  if (event.type === 'critical-hit' && event.sourceEntityId === localEntityId) {
    return `暴击 ${event.criticalDamagePercent}%`;
  }
  if (event.type === 'passive-shield-created' && event.entityId === localEntityId) {
    return `护盾触发 +${event.amount}`;
  }
  if (event.type === 'passive-upgraded' && event.entityId === localEntityId) {
    return `${event.passiveId} level ${event.level}`;
  }
  if (event.type === 'passive-learned' && event.entityId === localEntityId) {
    return `${event.passiveId} learned`;
  }
  if (event.type === 'active-replacement-required' && event.entityId === localEntityId) {
    return '确认替换地面主动';
  }
  if (event.type === 'active-replaced' && event.entityId === localEntityId) {
    return `已替换主动 ${event.activeId}`;
  }
  if (event.type === 'active-replacement-cancelled' && event.entityId === localEntityId) {
    return '主动替换已取消';
  }
  if (event.type === 'equipment-pickup-replacement-required' && event.entityId === localEntityId) {
    return '手牌已满，请选择装备去向';
  }
  if (event.type === 'equipment-pickup-replacement-cancelled' && event.entityId === localEntityId) {
    return event.reason === 'declined' ? '装备拾取已取消' : '装备拾取提示已失效';
  }
  if (event.type === 'airdrop-warning') {
    return `空投将在 ${Math.max(
      0,
      Math.ceil((event.scheduledAtTick - event.tick) / TICKS_PER_SECOND),
    )} 秒后落地`;
  }
  if (event.type === 'airdrop-landed') {
    return '空投已落地';
  }
  if (event.type === 'airdrop-channel' && event.entityId === localEntityId) {
    if (event.phase === 'started') {
      return '正在开启空投';
    }
    if (event.phase === 'completed') {
      return '空投开启成功';
    }
    const reasons: Readonly<Record<NonNullable<typeof event.reason>, string>> = {
      moved: '移动打断了开启',
      damaged: '受伤打断了开启',
      'forced-displacement': '强制位移打断了开启',
      'hard-control': '硬控打断了开启',
      'true-death': '真死打断了开启',
      expired: '空投已经消失',
      'opened-by-other': '空投已被其他玩家开启',
    };
    return event.reason ? reasons[event.reason] : '开启已取消';
  }
  if (event.type === 'airdrop-opened') {
    if (event.entityId === localEntityId) {
      return `获得 ${event.rewardGold} 金，${getEquipmentDefinition(event.equipmentId).name} 已公开落地`;
    }
    return '空投已被开启';
  }
  if (event.type === 'airdrop-expired') {
    return '空投已消失';
  }
  if (event.type === 'final-court-announced') {
    return `决赛庭已公布：${event.courtId}`;
  }
  if (event.type === 'apocalypse-warning') {
    return '灭世雷暴将在 5 秒后降临';
  }
  if (event.type === 'apocalypse-started') {
    return '安全区已归零';
  }
  if (event.type === 'lethal-protection' && event.entityId === localEntityId) {
    switch (event.protection) {
      case 'b19-feign-death':
        return event.didBlink ? '假死脱身' : '假死保命';
      case 'b20-passive-revive':
        return event.buffTicks > 0 ? '复活触发，进入强化' : '复活触发';
      case 'g1-nine-turn-pill':
        return '九转金丹触发';
    }
  }
  if (
    event.type === 'projectile-blocked' &&
    (event.sourceEntityId === localEntityId || event.targetEntityId === localEntityId)
  ) {
    return event.blockingSolidId === null ? '弹道被芭蕉风墙截断' : '弹道被墙体阻挡';
  }
  if (event.type === 'match-ended') {
    if (event.winnerEntityId === localEntityId) {
      return '大乱斗胜利';
    }
    return event.outcome === 'draw' ? '同归于尽' : '比赛结束';
  }
  return null;
}

export function transactionResultText(result: WorldTransactionResult): string {
  if (result.code.endsWith('declined')) {
    return result.operation === 'active-loot-replace' ? '已保留当前主动技能' : '已取消本次操作';
  }
  if (result.accepted) {
    switch (result.operation) {
      case 'shop-purchase':
        return '购买成功';
      case 'shop-sale':
        return '出售成功';
      case 'spend-gem':
        return '被动技能升级成功';
      case 'skill-book-replace':
        return '技能书替换成功';
      case 'active-loot-replace':
        return '主动技能替换成功';
      case 'equipment-loot-pickup':
        return '装备拾取成功';
      case 'equipment-equip':
        return '装备已穿戴';
      case 'equipment-unequip':
        return '装备已放入手牌';
      case 'equipment-discard':
        return '装备已丢弃';
      case 'hero-swap':
        return '英雄更换已开始';
      case 'airdrop-open':
        return '空投开启已开始';
      default:
        return '操作成功';
    }
  }

  const exactMessages: Readonly<Record<string, string>> = {
    'insufficient-gold': '操作失败：金币不足',
    'hand-full': '操作失败：手牌已满',
    'equipped-full': '操作失败：装备栏已满',
    'duplicate-equipped': '操作失败：不能重复穿戴同名装备',
    'replacement-required': '请选择要替换的装备',
    'invalid-replacement': '操作失败：替换目标已失效',
    'player-not-alive': '操作失败：当前状态无法操作',
    'match-finished': '操作失败：对局已经结束',
    'shop-stale-version': '操作失败：商店库存已刷新',
    'shop-unavailable': '操作失败：商店当前不可用',
  };
  const exact = exactMessages[result.code];
  if (exact) {
    return exact;
  }
  if (result.code.includes('too-far')) {
    return '操作失败：距离目标过远';
  }
  if (result.code.includes('line-of-sight')) {
    return '操作失败：目标被障碍物遮挡';
  }
  if (result.code.includes('not-found')) {
    return '操作失败：目标已经不存在';
  }
  if (result.code.includes('cooldown')) {
    return '操作失败：仍在冷却中';
  }
  if (result.code.includes('combat')) {
    return '操作失败：战斗状态下不可使用';
  }
  return `操作失败：${result.code}`;
}

export class GameHud {
  private readonly root: HTMLElement;
  private readonly input: InputController;
  private readonly onRestart: () => void;
  private readonly healthFill: HTMLElement;
  private readonly healthText: HTMLElement;
  private readonly shieldFill: HTMLElement;
  private readonly shieldText: HTMLElement;
  private readonly experienceFill: HTMLElement;
  private readonly experienceText: HTMLElement;
  private readonly heroName: HTMLElement;
  private readonly heroLevel: HTMLElement;
  private readonly heroElement: HTMLElement;
  private readonly attackStat: HTMLElement;
  private readonly speedStat: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly cameraViewButton: HTMLButtonElement;
  private readonly matchTime: HTMLElement;
  private readonly phaseName: HTMLElement;
  private readonly eventLine: HTMLElement;
  private readonly lives: HTMLElement;
  private readonly activeButton: HTMLButtonElement;
  private readonly activeIcon: HTMLImageElement;
  private readonly activeCooldownText: HTMLElement;
  private readonly interactButton: HTMLButtonElement;
  private readonly attackButton: HTMLButtonElement;
  private readonly defeatOverlay: HTMLElement;
  private readonly resultTitle: HTMLElement;
  private readonly connectionChip: HTMLElement;
  private readonly connectionLabel: HTMLElement;
  private readonly progressPanel: HTMLElement;
  private readonly progressToggle: HTMLButtonElement;
  private readonly buildPanelContext: HTMLElement;
  private readonly progressGold: HTMLElement;
  private readonly progressGems: HTMLElement;
  private readonly passiveList: HTMLElement;
  private readonly resourceGold: HTMLElement;
  private readonly resourceGems: HTMLElement;
  private readonly populationAlive: HTMLElement;
  private readonly populationNearby: HTMLElement;
  private readonly stormRadius: HTMLElement;
  private readonly stormNext: HTMLElement;
  private readonly stormVisual: HTMLElement;
  private readonly stormVisualTitle: HTMLElement;
  private readonly stormDangerLevel: HTMLElement;
  private readonly stormVisualCopy: HTMLElement;
  private readonly stormDistanceCopy: HTMLElement;
  private readonly stormStrikeCopy: HTMLElement;
  private readonly stormDamageCopy: HTMLElement;
  private readonly stormDirectionCopy: HTMLElement;
  private readonly motionIcon: HTMLElement;
  private readonly motionState: HTMLElement;
  private readonly motionDetail: HTMLElement;
  private readonly targetFrame: HTMLElement;
  private readonly targetAvatar: HTMLImageElement;
  private readonly targetSymbol: HTMLElement;
  private readonly targetName: HTMLElement;
  private readonly targetRange: HTMLElement;
  private readonly targetState: HTMLElement;
  private readonly targetHpFill: HTMLElement;
  private readonly targetAttackRange: HTMLElement;
  private readonly targetActiveRange: HTMLElement;
  private readonly passiveSlots: HTMLElement;
  private readonly equipmentSlots: HTMLElement;
  private readonly handSlots: HTMLElement;
  private readonly activeSlot: HTMLElement;
  private readonly shopPanel: HTMLElement;
  private readonly shopTitle: HTMLElement;
  private readonly shopContent: HTMLElement;
  private readonly worldSheet: HTMLElement;
  private readonly worldSheetKicker: HTMLElement;
  private readonly worldSheetTitle: HTMLElement;
  private readonly worldSheetBody: HTMLElement;
  private readonly airdropBanner: HTMLElement;
  private readonly airdropTitle: HTMLElement;
  private readonly airdropMeta: HTMLElement;
  private readonly interactProgress: HTMLElement;
  private readonly interactProgressText: HTMLElement;
  private nearbyAirdropId: string | null = null;
  private dismissedShopId: string | null = null;
  private dismissedLootKey: string | null = null;
  private focusedLootEntityId: EntityId | null = null;
  private lootPageIndex = 0;
  private eventExpiresAt = 0;
  private buildSignature = '';
  private progressSignature = '';
  private shopSignature = '';
  private worldSheetSignature = '';
  private selectedBuildKey: string | null = null;

  constructor(
    root: HTMLElement,
    input: InputController,
    onRestart: () => void,
    restartAvailable = true,
    private readonly host: WorldHost,
    private readonly onCycleCameraView: () => CameraViewState,
    private readonly onCombatRangePreview: (mode: CombatRangePreviewMode) => void,
  ) {
    this.root = root;
    this.input = input;
    this.onRestart = onRestart;
    this.root.innerHTML = `
      <section class="storm-hud battle-panel">
        <span class="phase-name"></span>
        <b class="match-time">00:00</b>
        <small>安全区 <i class="storm-radius">--</i> · <i class="storm-next">发育中</i></small>
      </section>
      <aside class="storm-visual" hidden>
        <strong class="storm-visual-title">天劫圈外</strong>
        <span class="storm-danger-level"></span>
        <p class="storm-visual-copy"></p>
        <dl class="storm-visual-stats">
          <div><dt>距安全区</dt><dd class="storm-distance-copy">--</dd></div>
          <div><dt>下次雷击</dt><dd class="storm-strike-copy">--</dd></div>
          <div><dt>预计伤害</dt><dd class="storm-damage-copy">--</dd></div>
        </dl>
        <small class="storm-direction-copy"></small>
      </aside>
      <section class="resource-hud battle-panel" aria-label="本局资源">
        <span>金 <b class="resource-gold">0</b></span>
        <span>宝石 <b class="resource-gems">0</b></span>
      </section>
      <section class="population-hud battle-panel" aria-label="对局存活状态">
        <b class="population-alive">0</b>
        <small>存活</small>
        <span class="population-nearby">附近 0</span>
      </section>
      <div class="connection-chip battle-panel">
        <span class="connection-icon"></span>
        <span class="connection-label">本地权威</span>
      </div>
      <button
        class="camera-view-button"
        type="button"
        aria-label="切换视角"
        title="标准视角"
      >
        <span class="camera-view-icon"></span>
      </button>
      <div class="airdrop-banner" hidden>
        <span class="airdrop-icon"></span>
        <span class="airdrop-copy">
          <strong class="airdrop-title"></strong>
          <span class="airdrop-meta"></span>
        </span>
      </div>
      <div class="event-feed battle-announcement"><div class="event-line" hidden></div></div>
      <section class="target-frame battle-panel" hidden aria-label="最近敌对目标">
        <span class="target-avatar-shell">
          <img class="target-avatar" alt="" />
          <span class="target-symbol">妖</span>
        </span>
        <span class="target-copy">
          <span class="target-heading">
            <b class="target-name"></b>
            <em class="target-range"></em>
          </span>
          <span class="target-health"><i class="target-health-fill"></i></span>
          <small class="target-state"></small>
          <span class="target-range-feedback">
            <i class="target-attack-range">普攻</i>
            <i class="target-active-range">主动</i>
          </span>
        </span>
      </section>
      <section class="player-status player-hud battle-panel">
        <img class="hero-portrait" alt="" />
        <span class="status-data">
          <span class="status-row">
            <span class="hero-identity">
              <b class="hero-name"></b>
              <small><i class="hero-level">Lv.1</i><i class="hero-element">金</i></small>
            </span>
            <span class="lives" aria-label="剩余生命"></span>
          </span>
          <span class="meter-line health-meter-line">
            <small>生命</small>
            <span class="meter health-track">
              <i class="health-fill"></i><span class="health-text"></span>
            </span>
          </span>
          <span class="meter-line shield-meter-line">
            <small>护盾</small>
            <span class="meter shield-track">
              <i class="shield-fill"></i><span class="shield-text">0</span>
            </span>
          </span>
          <span class="meter-line experience-meter-line">
            <small>经验</small>
            <span class="meter experience-track">
              <i class="experience-fill"></i><span class="experience-text"></span>
            </span>
          </span>
          <span class="hud-stats">
            <b class="attack-stat">攻击 0</b>
            <b class="speed-stat">移速 0.00m/s</b>
          </span>
        </span>
      </section>
      <section class="motion-hud battle-panel" aria-label="当前动作状态">
        <i class="motion-icon">行</i>
        <span><b class="motion-state">自由移动</b><small class="motion-detail">等待输入</small></span>
      </section>
      <section class="build-strip battle-panel" aria-label="本局构筑">
        <span class="build-group passives"><label>被动</label><span class="passive-slots"></span></span>
        <span class="build-group equipment"><label>装备</label><span class="equipment-slots"></span></span>
        <span class="build-group hand"><label>手牌</label><span class="hand-slots"></span></span>
        <span class="build-group active"><label>主动</label><span class="active-slot"></span></span>
      </section>
      <div class="progress-panel is-collapsed">
        <div class="progress-header">
          <span class="progress-currency">
            <span class="gold-value"></span>
            <span class="gem-value"></span>
          </span>
          <button
            class="progress-toggle"
            type="button"
            aria-label="展开资源与装备"
            aria-expanded="false"
            title="展开资源与装备"
          >
            <span class="progress-toggle-icon"></span>
          </button>
        </div>
        <div class="build-panel-context" role="status">点击底部构筑槽查看详情与可用操作</div>
        <div class="passive-list"></div>
      </div>
      <div class="shop-panel" hidden>
        <div class="shop-panel-title"><span class="shop-icon"></span><span class="shop-title"></span></div>
        <div class="shop-content"></div>
      </div>
      <aside class="world-sheet" hidden>
        <header class="world-sheet-header">
          <span>
            <small class="world-sheet-kicker"></small>
            <b class="world-sheet-title"></b>
          </span>
          <button class="world-sheet-close" type="button" aria-label="关闭地面弹窗">关闭</button>
        </header>
        <div class="world-sheet-body"></div>
      </aside>
      <div class="joystick" aria-label="移动">
        <div class="joystick-knob"></div>
      </div>
      <div class="action-cluster">
        <button class="action-button interact-button" type="button" aria-label="拾取或交互">
          <span class="interact-icon"></span>
          <span class="interaction-progress"></span>
          <span class="interaction-progress-text"></span>
        </button>
        <button class="action-button active-skill" type="button" aria-label="主动技能">
          <img class="active-skill-icon" alt="" />
          <span class="cooldown-mask"></span>
          <span class="cooldown-text"></span>
        </button>
        <button class="action-button primary attack-button" type="button" aria-label="普攻">
          <span class="attack-icon"></span>
        </button>
      </div>
      <div class="defeat-overlay">
        <div class="defeat-content">
          <h2 class="defeat-title">三命已尽</h2>
          <button class="restart-button" type="button" aria-label="重新开始">
            <span class="restart-icon"></span>
          </button>
        </div>
      </div>
      <div class="webgl-message">WebGL 上下文已中断，正在等待浏览器恢复。</div>
    `;

    this.healthFill = requiredElement(root, '.health-fill');
    this.healthText = requiredElement(root, '.health-text');
    this.shieldFill = requiredElement(root, '.shield-fill');
    this.shieldText = requiredElement(root, '.shield-text');
    this.experienceFill = requiredElement(root, '.experience-fill');
    this.experienceText = requiredElement(root, '.experience-text');
    this.heroName = requiredElement(root, '.hero-name');
    this.heroLevel = requiredElement(root, '.hero-level');
    this.heroElement = requiredElement(root, '.hero-element');
    this.attackStat = requiredElement(root, '.attack-stat');
    this.speedStat = requiredElement(root, '.speed-stat');
    this.portrait = requiredElement(root, '.hero-portrait');
    this.cameraViewButton = requiredElement(root, '.camera-view-button');
    this.matchTime = requiredElement(root, '.match-time');
    this.phaseName = requiredElement(root, '.phase-name');
    this.eventLine = requiredElement(root, '.event-line');
    this.lives = requiredElement(root, '.lives');
    this.activeButton = requiredElement(root, '.active-skill');
    this.activeIcon = requiredElement(root, '.active-skill-icon');
    this.activeCooldownText = requiredElement(root, '.cooldown-text');
    this.interactButton = requiredElement(root, '.interact-button');
    this.attackButton = requiredElement(root, '.attack-button');
    this.defeatOverlay = requiredElement(root, '.defeat-overlay');
    this.resultTitle = requiredElement(root, '.defeat-title');
    this.connectionChip = requiredElement(root, '.connection-chip');
    this.connectionLabel = requiredElement(root, '.connection-label');
    this.progressPanel = requiredElement(root, '.progress-panel');
    this.progressToggle = requiredElement(root, '.progress-toggle');
    this.buildPanelContext = requiredElement(root, '.build-panel-context');
    this.progressGold = requiredElement(root, '.gold-value');
    this.progressGems = requiredElement(root, '.gem-value');
    this.passiveList = requiredElement(root, '.passive-list');
    this.resourceGold = requiredElement(root, '.resource-gold');
    this.resourceGems = requiredElement(root, '.resource-gems');
    this.populationAlive = requiredElement(root, '.population-alive');
    this.populationNearby = requiredElement(root, '.population-nearby');
    this.stormRadius = requiredElement(root, '.storm-radius');
    this.stormNext = requiredElement(root, '.storm-next');
    this.stormVisual = requiredElement(root, '.storm-visual');
    this.stormVisualTitle = requiredElement(root, '.storm-visual-title');
    this.stormDangerLevel = requiredElement(root, '.storm-danger-level');
    this.stormVisualCopy = requiredElement(root, '.storm-visual-copy');
    this.stormDistanceCopy = requiredElement(root, '.storm-distance-copy');
    this.stormStrikeCopy = requiredElement(root, '.storm-strike-copy');
    this.stormDamageCopy = requiredElement(root, '.storm-damage-copy');
    this.stormDirectionCopy = requiredElement(root, '.storm-direction-copy');
    this.motionIcon = requiredElement(root, '.motion-icon');
    this.motionState = requiredElement(root, '.motion-state');
    this.motionDetail = requiredElement(root, '.motion-detail');
    this.targetFrame = requiredElement(root, '.target-frame');
    this.targetAvatar = requiredElement(root, '.target-avatar');
    this.targetSymbol = requiredElement(root, '.target-symbol');
    this.targetName = requiredElement(root, '.target-name');
    this.targetRange = requiredElement(root, '.target-range');
    this.targetState = requiredElement(root, '.target-state');
    this.targetHpFill = requiredElement(root, '.target-health-fill');
    this.targetAttackRange = requiredElement(root, '.target-attack-range');
    this.targetActiveRange = requiredElement(root, '.target-active-range');
    this.passiveSlots = requiredElement(root, '.passive-slots');
    this.equipmentSlots = requiredElement(root, '.equipment-slots');
    this.handSlots = requiredElement(root, '.hand-slots');
    this.activeSlot = requiredElement(root, '.active-slot');
    this.shopPanel = requiredElement(root, '.shop-panel');
    this.shopTitle = requiredElement(root, '.shop-title');
    this.shopContent = requiredElement(root, '.shop-content');
    this.worldSheet = requiredElement(root, '.world-sheet');
    this.worldSheetKicker = requiredElement(root, '.world-sheet-kicker');
    this.worldSheetTitle = requiredElement(root, '.world-sheet-title');
    this.worldSheetBody = requiredElement(root, '.world-sheet-body');
    this.airdropBanner = requiredElement(root, '.airdrop-banner');
    this.airdropTitle = requiredElement(root, '.airdrop-title');
    this.airdropMeta = requiredElement(root, '.airdrop-meta');
    this.interactProgress = requiredElement(root, '.interaction-progress');
    this.interactProgressText = requiredElement(root, '.interaction-progress-text');
    requiredElement<HTMLButtonElement>(root, '.restart-button').hidden = !restartAvailable;

    requiredElement(root, '.progress-toggle-icon').append(
      createElement(ChevronDown, { width: 16, height: 16 }),
    );
    this.progressToggle.addEventListener('click', () => {
      const isCollapsed = this.progressPanel.classList.toggle('is-collapsed');
      const expanded = !isCollapsed;
      const label = expanded ? '收起资源与装备' : '展开资源与装备';
      this.progressToggle.setAttribute('aria-expanded', String(expanded));
      this.progressToggle.setAttribute('aria-label', label);
      this.progressToggle.title = label;
    });
    requiredElement<HTMLButtonElement>(root, '.world-sheet-close').addEventListener('click', () => {
      this.dismissWorldSheet();
    });

    requiredElement(root, '.connection-icon').append(
      createElement(Wifi, { width: 16, height: 16 }),
    );
    requiredElement(root, '.camera-view-icon').append(
      createElement(Camera, { width: 18, height: 18 }),
    );
    requiredElement(root, '.interact-icon').append(createElement(Hand, { width: 25, height: 25 }));
    requiredElement(root, '.attack-icon').append(createElement(Sword, { width: 30, height: 30 }));
    requiredElement(root, '.restart-icon').append(
      createElement(RotateCcw, { width: 26, height: 26 }),
    );
    requiredElement(root, '.shop-icon').append(
      createElement(ShoppingBag, { width: 15, height: 15 }),
    );
    requiredElement(root, '.airdrop-icon').append(createElement(MapPin, { width: 18, height: 18 }));
    for (let index = 0; index < 3; index += 1) {
      const icon = createElement(Heart, { width: 15, height: 15 });
      icon.classList.add('life-icon');
      this.lives.append(icon);
    }

    this.input.setContextualInteract(this.handleContextualInteract);
    this.bindActions();
    this.bindJoystick();
    this.cameraViewButton.addEventListener('click', () => {
      this.setCameraViewState(this.onCycleCameraView());
    });
  }

  setCameraViewState(state: CameraViewState): void {
    this.cameraViewButton.title = `${state.label} · 点击切换，滚轮缩放`;
    this.cameraViewButton.setAttribute('aria-label', `切换视角，当前${state.label}`);
    this.cameraViewButton.dataset.viewMode = state.mode;
  }

  setConnectionState(state: WorldConnectionState): void {
    const labels: Record<WorldConnectionState, string> = {
      local: '本地权威',
      connecting: '连接中',
      reconnecting: '正在重连',
      online: '在线权威',
      disconnected: '连接中断',
      error: '连接失败',
    };
    this.connectionLabel.textContent = labels[state];
    this.connectionChip.classList.toggle('is-online', state === 'online');
    this.connectionChip.classList.toggle(
      'is-offline',
      state === 'reconnecting' || state === 'disconnected' || state === 'error',
    );
  }

  dismissCurrentInterface(): boolean {
    if (!this.worldSheet.hidden) {
      this.dismissWorldSheet();
      return true;
    }
    if (!this.shopPanel.hidden) {
      this.dismissedShopId = this.shopPanel.dataset.shopId ?? null;
      this.shopPanel.hidden = true;
      return true;
    }
    if (!this.progressPanel.classList.contains('is-collapsed')) {
      this.progressPanel.classList.add('is-collapsed');
      this.progressToggle.setAttribute('aria-expanded', 'false');
      this.progressToggle.setAttribute('aria-label', '展开资源与装备');
      this.progressToggle.title = '展开资源与装备';
      return true;
    }
    return false;
  }

  update(
    snapshot: WorldSnapshot,
    events: readonly SimEvent[],
    localEntityId: EntityId,
    nowMs: number,
    transactionResults: readonly WorldTransactionResult[] = [],
  ): void {
    const player = snapshot.players.find((candidate) => candidate.entityId === localEntityId);
    if (!player) {
      return;
    }

    const hero = getHeroDefinition(player.heroId);
    const active = getActiveDefinition(player.activeAbilityId);
    const activeRange = activePresentationRange(active);
    const healthRatio = player.maxHp > 0 ? player.hp / player.maxHp : 0;
    this.healthFill.style.transform = `scaleX(${healthRatio})`;
    this.healthText.textContent = `${player.hp} / ${player.maxHp}`;
    this.shieldFill.style.transform = `scaleX(${Math.min(
      1,
      player.totalShield / Math.max(1, player.maxHp),
    )})`;
    this.shieldText.textContent = player.totalShield.toString();
    const xpRatio = experienceProgress(player);
    this.experienceFill.style.transform = `scaleX(${xpRatio})`;
    const nextExperience =
      player.level >= 15 ? player.experience : (XP_CUMULATIVE[player.level] ?? player.experience);
    this.experienceText.textContent =
      player.level >= 15 ? '满级' : `${player.experience} / ${nextExperience}`;
    const stateLabel =
      player.lifeState === 'soul-flight'
        ? '灵魂飞行'
        : player.iceCoffinTicks > 0
          ? '冰棺'
          : player.invulnerableTicks > 0
            ? '金丹无敌'
            : player.b20ReviveBuffTicks > 0
              ? '复生强化'
              : null;
    this.heroName.textContent = stateLabel ? `${hero.name} · ${stateLabel}` : hero.name;
    this.heroLevel.textContent = `Lv.${player.level}`;
    this.heroElement.textContent = ELEMENT_LABELS[hero.element] ?? hero.element;
    this.attackStat.textContent = `攻击 ${player.attackPower}`;
    this.speedStat.textContent = `移速 ${(player.moveSpeedMmPerSecond / 1_000).toFixed(2)}m/s`;
    if (this.portrait.dataset.heroId !== player.heroId) {
      this.portrait.dataset.heroId = player.heroId;
      this.portrait.src = heroPortraitUrl(player.heroId);
    }
    if (this.activeIcon.dataset.activeId !== player.activeAbilityId) {
      this.activeIcon.dataset.activeId = player.activeAbilityId;
      this.activeIcon.src = activeIconUrl(player.activeAbilityId);
    }
    this.activeButton.title = activeRange
      ? `${active.name} · ${(activeRange.rangeMm / 1_000).toFixed(0)} 米`
      : `${active.name} · 自身效果`;
    this.activeButton.setAttribute('aria-label', this.activeButton.title);
    this.attackButton.title = `普攻 · ${(player.attackRangeMm / 1_000).toFixed(0)} 米`;
    this.matchTime.textContent = formatTime(snapshot.tick);
    const stormStatus = describeStormForPlayer(snapshot.stormZone, snapshot.tick, player.position);
    this.phaseName.textContent = stormStatus.phaseName;
    this.stormRadius.textContent = `${Math.max(0, Math.round(snapshot.stormZone.radiusMm / 1_000))}m`;
    this.stormNext.textContent = stormStatus.nextEventLabel;
    this.updateStormVisualHud(stormStatus, player);
    this.resourceGold.textContent = player.gold.toString();
    this.resourceGems.textContent = player.gems.toString();
    const alivePlayers = snapshot.players.filter(
      (candidate) => candidate.lifeState !== 'eliminated',
    ).length;
    const nearbyPlayers = snapshot.players.filter(
      (candidate) =>
        candidate.entityId !== localEntityId &&
        candidate.lifeState !== 'eliminated' &&
        distanceSquaredMm(player.position, candidate.position) <= 40_000 * 40_000,
    ).length;
    this.populationAlive.textContent = alivePlayers.toString();
    this.populationNearby.textContent = `附近 ${nearbyPlayers}`;
    this.updateMotionState(player);
    this.updateTargetFrame(snapshot, player, activeRange?.rangeMm ?? null);
    this.updateBuildStrip(player);
    this.updateLives(player);
    this.updateProgressPanel(snapshot, player);
    this.updateShopPanel(snapshot, player);
    this.updateWorldSheet(snapshot, player);
    this.updateAirdrop(snapshot, player);
    const matchFinished = snapshot.match.status === 'finished';
    const localWon = snapshot.match.winnerEntityId === localEntityId;
    this.updateActiveCooldown(player, active.cooldownTicks, matchFinished);
    this.resultTitle.textContent = localWon
      ? '大获全胜'
      : matchFinished && snapshot.match.winnerEntityId === null
        ? '同归于尽'
        : '三命已尽';
    this.defeatOverlay.classList.toggle(
      'is-visible',
      player.lifeState === 'eliminated' || matchFinished,
    );

    const latestTransaction = transactionResults.at(-1);
    let selectedEventText: string | null = latestTransaction
      ? transactionResultText(latestTransaction)
      : null;
    for (const event of events) {
      const text = eventText(event, localEntityId);
      if (text && (event.type !== 'active-cast' || selectedEventText === null)) {
        selectedEventText = text;
      }
    }
    if (selectedEventText) {
      this.eventLine.textContent = selectedEventText;
      this.eventLine.hidden = false;
      this.eventExpiresAt = nowMs + 1_800;
    }
    if (nowMs >= this.eventExpiresAt) {
      this.eventLine.hidden = true;
    }
  }

  private updateMotionState(player: PlayerSnapshot): void {
    const moving = player.intent.movement.x !== 0 || player.intent.movement.z !== 0;
    if (player.lifeState === 'soul-flight') {
      this.motionIcon.textContent = '魂';
      this.motionState.textContent = '灵魂飞行';
      this.motionDetail.textContent = '选择复活落点';
      return;
    }
    if (player.lifeState === 'eliminated') {
      this.motionIcon.textContent = '尽';
      this.motionState.textContent = '三命已尽';
      this.motionDetail.textContent = '等待权威结算';
      return;
    }
    if (player.hardControlTicks > 0 || player.polymorphTicks > 0) {
      this.motionIcon.textContent = '控';
      this.motionState.textContent = player.polymorphTicks > 0 ? '变羊中' : '受控制';
      this.motionDetail.textContent = `${Math.ceil(
        Math.max(player.hardControlTicks, player.polymorphTicks) / TICKS_PER_SECOND,
      )} 秒`;
      return;
    }
    if (player.iceCoffinTicks > 0) {
      this.motionIcon.textContent = '冰';
      this.motionState.textContent = '冰棺';
      this.motionDetail.textContent = '当前无法移动与施法';
      return;
    }
    if (player.intent.attack) {
      this.motionIcon.textContent = '战';
      this.motionState.textContent = '正在攻击';
      this.motionDetail.textContent = `普攻距离 ${(player.attackRangeMm / 1_000).toFixed(0)} 米`;
      return;
    }
    if (moving) {
      this.motionIcon.textContent = '行';
      this.motionState.textContent = '移动中';
      this.motionDetail.textContent = `${(player.moveSpeedMmPerSecond / 1_000).toFixed(2)}m/s`;
      return;
    }
    this.motionIcon.textContent = '行';
    this.motionState.textContent = '自由移动';
    this.motionDetail.textContent = '等待输入';
  }

  private updateTargetFrame(
    snapshot: WorldSnapshot,
    player: PlayerSnapshot,
    activeRangeMm: number | null,
  ): void {
    const maximumDistanceSquared = 50_000 * 50_000;
    let nearest: {
      readonly kind: 'player' | 'monster';
      readonly distanceSquared: number;
      readonly hp: number;
      readonly maxHp: number;
      readonly name: string;
      readonly state: string;
      readonly portrait: string | null;
    } | null = null;
    for (const candidate of snapshot.players) {
      if (candidate.entityId === player.entityId || candidate.lifeState === 'eliminated') {
        continue;
      }
      const distanceSquared = distanceSquaredMm(player.position, candidate.position);
      if (
        distanceSquared > maximumDistanceSquared ||
        (nearest && distanceSquared >= nearest.distanceSquared)
      ) {
        continue;
      }
      const hero = getHeroDefinition(candidate.heroId);
      nearest = {
        kind: 'player',
        distanceSquared,
        hp: candidate.hp,
        maxHp: candidate.maxHp,
        name: `${hero.name} · Lv.${candidate.level}`,
        state: `${ELEMENT_LABELS[hero.element] ?? hero.element} · 敌方玩家`,
        portrait: heroPortraitUrl(candidate.heroId),
      };
    }
    for (const monster of snapshot.monsters) {
      if (monster.hp <= 0) {
        continue;
      }
      const distanceSquared = distanceSquaredMm(player.position, monster.position);
      if (
        distanceSquared > maximumDistanceSquared ||
        (nearest && distanceSquared >= nearest.distanceSquared)
      ) {
        continue;
      }
      nearest = {
        kind: 'monster',
        distanceSquared,
        hp: monster.hp,
        maxHp: monster.maxHp,
        name: monsterDisplayName(monster.kind),
        state: `${monster.element ? (ELEMENT_LABELS[monster.element] ?? monster.element) : '无'} · 敌对妖物`,
        portrait: null,
      };
    }
    if (!nearest) {
      this.targetFrame.hidden = true;
      return;
    }
    const distanceMm = Math.sqrt(nearest.distanceSquared);
    const attackInRange = distanceMm <= player.attackRangeMm;
    const activeInRange = activeRangeMm !== null && distanceMm <= activeRangeMm;
    this.targetFrame.hidden = false;
    this.targetName.textContent = nearest.name;
    this.targetRange.textContent = `${(distanceMm / 1_000).toFixed(1)}m`;
    this.targetState.textContent = nearest.state;
    this.targetHpFill.style.transform = `scaleX(${nearest.hp / Math.max(1, nearest.maxHp)})`;
    this.targetAttackRange.textContent = attackInRange ? '普攻 可达' : '普攻 超距';
    this.targetAttackRange.classList.toggle('is-in-range', attackInRange);
    this.targetActiveRange.hidden = activeRangeMm === null;
    this.targetActiveRange.textContent = activeInRange ? '主动 可达' : '主动 超距';
    this.targetActiveRange.classList.toggle('is-in-range', activeInRange);
    this.targetAvatar.hidden = nearest.portrait === null;
    this.targetSymbol.hidden = nearest.portrait !== null;
    if (nearest.portrait && this.targetAvatar.src !== nearest.portrait) {
      this.targetAvatar.src = nearest.portrait;
    }
    this.targetFrame.dataset.targetKind = nearest.kind;
  }

  private updateBuildStrip(player: PlayerSnapshot): void {
    const signature = [
      ...player.passives.map((passive) => `${passive.passiveId}:${passive.level}`),
      '|',
      ...player.equipment.map((instance) => `${instance.instanceId}:${instance.equipmentId}`),
      '|',
      ...player.inventoryEquipment.map(
        (instance) => `${instance.instanceId}:${instance.equipmentId}`,
      ),
      '|',
      player.activeAbilityId,
    ].join(',');
    if (signature === this.buildSignature) {
      this.updateActiveSlotCooldown(player);
      return;
    }
    this.buildSignature = signature;
    this.passiveSlots.replaceChildren();
    this.equipmentSlots.replaceChildren();
    this.handSlots.replaceChildren();
    this.activeSlot.replaceChildren();

    for (const passive of player.passives) {
      const definition = getAuthoritativePassive(passive.passiveId);
      this.passiveSlots.append(
        this.createBuildSlot({
          url: passiveIconUrl(passive.passiveId),
          name: definition.name,
          buildKey: `passive:${passive.passiveId}`,
          context: `${definition.name} Lv.${passive.level}：可在资源面板消耗宝石升级`,
          titleMeta: `Lv.${passive.level}`,
          level: passive.level,
        }),
      );
    }
    for (let index = player.passives.length; index < 4; index += 1) {
      this.passiveSlots.append(
        this.createEmptyBuildSlot(
          'empty:passive',
          '被动空位',
          '被动空位：靠近并拾取技能书后会自动学习；满四个后可选择替换',
        ),
      );
    }

    for (const instance of player.equipment) {
      const definition = getEquipmentDefinition(instance.equipmentId);
      this.equipmentSlots.append(
        this.createBuildSlot({
          url: equipmentIconUrl(instance.equipmentId),
          name: definition.name,
          buildKey: `equipped:${instance.instanceId}`,
          context: `${definition.name}：可卸下到手牌或丢弃`,
          titleMeta: '身穿',
          rarity: definition.rarity,
        }),
      );
    }
    for (let index = player.equipment.length; index < 3; index += 1) {
      this.equipmentSlots.append(
        this.createEmptyBuildSlot(
          'empty:equipment',
          '装备空位',
          '装备空位：可在商店购买并直接穿戴，或拾取地面装备',
        ),
      );
    }

    const handCapacity = player.equipment.some(
      (instance) => instance.equipmentId === EQUIPMENT_IDS.clothBag,
    )
      ? 2
      : 1;
    for (const instance of player.inventoryEquipment) {
      const definition = getEquipmentDefinition(instance.equipmentId);
      this.handSlots.append(
        this.createBuildSlot({
          url: equipmentIconUrl(instance.equipmentId),
          name: definition.name,
          buildKey: `inventory:${instance.instanceId}`,
          context: `${definition.name}：可穿戴、替换身上装备或丢弃`,
          titleMeta: '手牌',
          rarity: definition.rarity,
        }),
      );
    }
    for (let index = player.inventoryEquipment.length; index < handCapacity; index += 1) {
      this.handSlots.append(
        this.createEmptyBuildSlot(
          'empty:hand',
          '手牌空位',
          '手牌空位：购买或拾取装备时可选择放入手牌',
        ),
      );
    }

    const active = getActiveDefinition(player.activeAbilityId);
    this.activeSlot.append(
      this.createBuildSlot({
        url: activeIconUrl(player.activeAbilityId),
        name: active.name,
        buildKey: `active:${player.activeAbilityId}`,
        context: `${active.name}：靠近地面主动技能后可确认替换`,
        titleMeta: '主动',
      }),
    );
    this.updateActiveSlotCooldown(player);
  }

  private updateActiveSlotCooldown(player: PlayerSnapshot): void {
    const slot = this.activeSlot.querySelector<HTMLElement>('.build-slot');
    if (!slot) {
      return;
    }
    const seconds = Math.ceil(player.activeCooldownTicks / TICKS_PER_SECOND);
    const overlay = slot.querySelector<HTMLElement>('.cooldown');
    if (seconds <= 0) {
      overlay?.remove();
      return;
    }
    if (overlay) {
      overlay.textContent = String(seconds);
      return;
    }
    const cooldown = document.createElement('span');
    cooldown.className = 'cooldown';
    cooldown.textContent = String(seconds);
    slot.append(cooldown);
  }

  private createBuildSlot(options: {
    url: string;
    name: string;
    buildKey: string;
    context: string;
    titleMeta: string;
    rarity?: ReturnType<typeof getEquipmentDefinition>['rarity'];
    level?: number;
  }): HTMLButtonElement {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = options.rarity
      ? `build-slot is-filled rarity-${options.rarity}`
      : 'build-slot is-filled';
    slot.title = `${options.name} · ${options.titleMeta}`;
    slot.setAttribute('aria-label', `管理 ${options.name}，${options.titleMeta}`);
    slot.dataset.buildKey = options.buildKey;
    const image = document.createElement('img');
    image.src = options.url;
    image.alt = '';
    slot.append(image);
    if (options.level !== undefined) {
      const level = document.createElement('span');
      level.className = 'lv';
      level.textContent = `Lv${options.level}`;
      slot.append(level);
    }
    slot.addEventListener('click', (event) => {
      event.stopPropagation();
      this.focusBuildItem(options.buildKey, options.context);
    });
    return slot;
  }

  private createEmptyBuildSlot(
    buildKey: string,
    label: string,
    context: string,
  ): HTMLButtonElement {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'build-slot is-empty';
    slot.title = label;
    slot.setAttribute('aria-label', label);
    slot.dataset.buildKey = buildKey;
    slot.addEventListener('click', (event) => {
      event.stopPropagation();
      this.focusBuildItem(buildKey, context);
    });
    return slot;
  }

  private focusBuildItem(buildKey: string, context: string): void {
    this.selectedBuildKey = buildKey;
    this.buildPanelContext.textContent = context;
    this.progressPanel.classList.remove('is-collapsed');
    this.progressToggle.setAttribute('aria-expanded', 'true');
    this.applySelectedBuildFocus();
  }

  private applySelectedBuildFocus(): void {
    for (const slot of this.root.querySelectorAll<HTMLElement>('.build-slot[data-build-key]')) {
      slot.classList.toggle('is-active', slot.dataset.buildKey === this.selectedBuildKey);
    }
    for (const row of this.passiveList.querySelectorAll<HTMLElement>('[data-build-key]')) {
      row.classList.toggle('is-focused', row.dataset.buildKey === this.selectedBuildKey);
    }
    if (this.selectedBuildKey === null) {
      return;
    }
    const focused = [...this.passiveList.querySelectorAll<HTMLElement>('[data-build-key]')].find(
      (row) => row.dataset.buildKey === this.selectedBuildKey,
    );
    focused?.scrollIntoView({ block: 'nearest' });
  }

  private createBuildInfoRow(buildKey: string, text: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'passive-row build-info-row';
    row.dataset.buildKey = buildKey;
    row.textContent = text;
    return row;
  }

  private updateLives(player: PlayerSnapshot): void {
    [...this.lives.children].forEach((element, index) => {
      element.classList.toggle('is-spent', index >= player.livesRemaining);
    });
  }

  private updateStormVisualHud(status: StormPlayerStatus, player: PlayerSnapshot): void {
    this.stormVisual.hidden = !status.outside || player.lifeState === 'eliminated';
    this.stormVisual.classList.toggle('is-final', status.apocalypse);
    this.root.classList.toggle('is-storm-outside', status.outside);
    if (this.stormVisual.hidden) {
      return;
    }
    const estimate = Math.max(1, Math.trunc((player.maxHp * status.damagePercent) / 100));
    this.stormVisualTitle.textContent = status.apocalypse ? '灭世雷暴 · 无安全点' : '天劫圈外';
    this.stormDangerLevel.textContent =
      player.hp / Math.max(1, player.maxHp) <= 0.25
        ? '致命 · 生命危急'
        : status.apocalypse
          ? '终局威胁'
          : '高危区域';
    this.stormDistanceCopy.textContent = status.apocalypse
      ? '无安全区'
      : `${status.toSafeMeters.toFixed(1)}米`;
    this.stormStrikeCopy.textContent = status.apocalypse
      ? `${status.nextStrikeSeconds}秒`
      : `${status.nextStrikeSeconds}秒 · ${status.hitChancePercent}%`;
    this.stormDamageCopy.textContent = `${status.damagePercent}%生命`;
    this.stormDirectionCopy.textContent = status.apocalypse
      ? '持续移动并争夺最终生存空间'
      : `向${status.directionLabel}移动 · 沿最短路径返回安全区`;
    this.stormVisualCopy.textContent = status.apocalypse
      ? `每秒确定雷击 · 每5秒增强1%最大生命 · 本次预计${estimate}点`
      : `圈外每3秒独立判定${status.hitChancePercent}% · 命中预计${estimate}点并眩晕0.5秒`;
  }

  private dismissWorldSheet(): void {
    const lootKey = this.worldSheet.dataset.lootKey;
    if (lootKey) {
      this.dismissedLootKey = lootKey;
    }
    this.worldSheet.hidden = true;
    this.worldSheetSignature = '';
    this.worldSheetBody.replaceChildren();
  }

  private updateWorldSheet(snapshot: WorldSnapshot, player: PlayerSnapshot): void {
    const nearby = nearbyLootDrops(snapshot, player);
    const heaps = clusterLootHeaps(nearby);
    const heap = heaps[0];
    if (!heap || player.lifeState !== 'alive') {
      this.dismissedLootKey = null;
      this.focusedLootEntityId = null;
      this.lootPageIndex = 0;
      this.worldSheetSignature = '';
      this.worldSheet.hidden = true;
      this.worldSheet.dataset.lootKey = '';
      this.worldSheetBody.replaceChildren();
      return;
    }

    if (this.dismissedLootKey === heap.key) {
      this.worldSheet.hidden = true;
      return;
    }
    this.dismissedLootKey = null;

    const availableIds = new Set(heap.drops.map((entry) => entry.drop.entityId));
    if (this.focusedLootEntityId === null || !availableIds.has(this.focusedLootEntityId)) {
      this.focusedLootEntityId = heap.drops[0]?.drop.entityId ?? null;
    }
    const focused =
      heap.drops.find((entry) => entry.drop.entityId === this.focusedLootEntityId) ?? heap.drops[0];
    if (!focused) {
      this.worldSheet.hidden = true;
      return;
    }

    const pendingActive = snapshot.pendingActiveReplacements.find(
      (pending) => pending.playerEntityId === player.entityId,
    );
    const pendingEquipment = snapshot.pendingEquipmentPickups.find(
      (pending) => pending.playerEntityId === player.entityId,
    );
    const pageCount = Math.max(1, Math.ceil(heap.drops.length / WORLD_SHEET_PAGE_SIZE));
    this.lootPageIndex = Math.min(this.lootPageIndex, pageCount - 1);
    const signature = heapFocusKey(heap, focused.drop.entityId);
    const combatLock = player.pvpCombatTicks > 0;
    const fullSignature = [
      signature,
      this.lootPageIndex,
      player.gold,
      player.activeAbilityId,
      combatLock ? 'lock' : 'open',
      pendingActive?.lootEntityId ?? '',
      pendingEquipment?.lootEntityId ?? '',
      ...player.passives.map((passive) => `${passive.passiveId}:${passive.level}`),
      ...player.equipment.map((instance) => instance.instanceId),
      ...player.inventoryEquipment.map((instance) => instance.instanceId),
    ].join('|');
    this.worldSheet.hidden = false;
    this.worldSheet.dataset.lootKey = heap.key;
    const isHeap = heap.drops.length > 1;
    this.worldSheetKicker.textContent = isHeap ? '秘宝堆' : lootDropKindLabel(focused.drop);
    this.worldSheetTitle.textContent = isHeap
      ? `${heap.drops.length}件地面物`
      : lootDropTitle(focused.drop);
    if (fullSignature === this.worldSheetSignature) {
      return;
    }
    this.worldSheetSignature = fullSignature;
    this.worldSheetBody.replaceChildren();

    if (combatLock) {
      const lock = document.createElement('p');
      lock.className = 'world-sheet-note';
      lock.textContent = `脱离战斗后可拾取 · 还需 ${Math.ceil(player.pvpCombatTicks / TICKS_PER_SECOND)} 秒`;
      this.worldSheetBody.append(lock);
    }

    if (isHeap) {
      const list = document.createElement('div');
      list.className = 'world-sheet-heap';
      const start = this.lootPageIndex * WORLD_SHEET_PAGE_SIZE;
      const page = heap.drops.slice(start, start + WORLD_SHEET_PAGE_SIZE);
      for (const entry of page) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'world-sheet-heap-item';
        button.classList.toggle('is-active', entry.drop.entityId === focused.drop.entityId);
        button.textContent = lootDropTitle(entry.drop);
        button.addEventListener('click', () => {
          this.focusedLootEntityId = entry.drop.entityId;
          this.worldSheetSignature = '';
          this.updateWorldSheet(snapshot, player);
        });
        list.append(button);
      }
      this.worldSheetBody.append(list);
      if (pageCount > 1) {
        const pager = document.createElement('div');
        pager.className = 'world-sheet-pager';
        pager.append(
          this.createShopButton('上一页', '上一页', () => {
            this.lootPageIndex = Math.max(0, this.lootPageIndex - 1);
            this.worldSheetSignature = '';
            this.updateWorldSheet(snapshot, player);
          }),
          this.createShopButton(
            `${this.lootPageIndex + 1}/${pageCount}`,
            '当前页',
            () => undefined,
          ),
          this.createShopButton('下一页', '下一页', () => {
            this.lootPageIndex = Math.min(pageCount - 1, this.lootPageIndex + 1);
            this.worldSheetSignature = '';
            this.updateWorldSheet(snapshot, player);
          }),
        );
        this.worldSheetBody.append(pager);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'world-sheet-actions';
    const drop = focused.drop;
    if (drop.bookPassiveId) {
      const incoming = getAuthoritativePassive(drop.bookPassiveId);
      const already = player.passives.find((passive) => passive.passiveId === drop.bookPassiveId);
      if (already || player.passives.length < 4) {
        actions.append(
          this.createShopButton(
            already ? `升级 ${incoming.name}` : `拾取 ${incoming.name}`,
            already ? `升级技能书 ${incoming.name}` : `学习 ${incoming.name}`,
            () => {
              this.host.replaceSkillBook(drop.entityId, drop.bookPassiveId!);
            },
          ),
        );
      } else {
        const note = document.createElement('p');
        note.className = 'world-sheet-note';
        note.textContent = `被动已满，选择要遗忘的技能以学习 ${incoming.name}`;
        this.worldSheetBody.append(note);
        for (const passive of player.passives) {
          const current = getAuthoritativePassive(passive.passiveId);
          actions.append(
            this.createShopButton(`换${current.name}`, `遗忘 ${current.name}，学习 ${incoming.name}`, () => {
              this.host.replaceSkillBook(drop.entityId, passive.passiveId);
            }),
          );
        }
      }
    } else if (drop.activeId) {
      const incoming = getActiveDefinition(drop.activeId);
      if (pendingActive?.lootEntityId === drop.entityId) {
        actions.append(
          this.createShopButton('替换', `替换为 ${incoming.name}`, () => {
            this.host.replaceActiveLoot(drop.entityId, true);
          }),
          this.createShopButton('保留', '保留当前主动技能', () => {
            this.host.replaceActiveLoot(drop.entityId, false);
          }),
        );
      } else {
        actions.append(
          this.createShopButton(`拾取 ${incoming.name}`, `准备替换为 ${incoming.name}`, () => {
            this.input.queueInteract();
          }),
        );
      }
    } else if (drop.equipmentId) {
      const incoming = getEquipmentDefinition(drop.equipmentId);
      const canEquipWithoutReplacement =
        player.equipment.length < 3 &&
        !player.equipment.some((instance) => instance.equipmentId === drop.equipmentId);
      if (canEquipWithoutReplacement) {
        actions.append(
          this.createShopButton('穿戴', `直接穿戴 ${incoming.name}`, () => {
            this.host.pickupEquipmentLoot(drop.entityId, 'equipped', null);
          }),
        );
      }
      if (player.inventoryEquipment.length === 0 || pendingEquipment?.lootEntityId === drop.entityId) {
        actions.append(
          this.createShopButton('入手牌', `拾取 ${incoming.name} 到手牌`, () => {
            this.host.pickupEquipmentLoot(drop.entityId, 'inventory', null);
          }),
        );
      }
      for (const instance of player.inventoryEquipment) {
        actions.append(
          this.createShopButton(
            `换手牌${getEquipmentDefinition(instance.equipmentId).name}`,
            `丢弃手牌并拾取 ${incoming.name}`,
            () => {
              this.host.pickupEquipmentLoot(drop.entityId, 'inventory', instance.instanceId);
            },
          ),
        );
      }
      for (const instance of player.equipment) {
        const legalAfterReplacement = player.equipment
          .filter((candidate) => candidate.instanceId !== instance.instanceId)
          .every((candidate) => candidate.equipmentId !== drop.equipmentId);
        if (!legalAfterReplacement) {
          continue;
        }
        actions.append(
          this.createShopButton(
            `换${getEquipmentDefinition(instance.equipmentId).name}`,
            `替换身穿并拾取 ${incoming.name}`,
            () => {
              this.host.pickupEquipmentLoot(drop.entityId, 'equipped', instance.instanceId);
            },
          ),
        );
      }
      if (pendingEquipment?.lootEntityId === drop.entityId) {
        actions.append(
          this.createShopButton('取消', '取消拾取并保留地面装备', () => {
            this.host.pickupEquipmentLoot(drop.entityId, 'cancel', null);
          }),
        );
      }
    } else {
      actions.append(
        this.createShopButton('拾取', lootDropTitle(drop), () => {
          this.input.queueInteract();
        }),
      );
    }
    if (actions.childElementCount > 0) {
      this.worldSheetBody.append(actions);
    }
  }

  private updateProgressPanel(snapshot: WorldSnapshot, player: PlayerSnapshot): void {
    this.progressGold.textContent = `Gold ${player.gold}`;
    this.progressGems.textContent = `Gems ${player.gems}`;

    const nearbyBook = snapshot.lootDrops.find(
      (drop) =>
        drop.bookPassiveId !== null &&
        distanceSquaredMm(player.position, drop.position) <= 2_500 * 2_500 &&
        !player.passives.some((passive) => passive.passiveId === drop.bookPassiveId),
    );
    const pendingActiveReplacement = snapshot.pendingActiveReplacements.find(
      (pending) => pending.playerEntityId === player.entityId,
    );
    const pendingActiveLoot = pendingActiveReplacement
      ? snapshot.lootDrops.find((drop) => drop.entityId === pendingActiveReplacement.lootEntityId)
      : undefined;
    const pendingEquipmentPickup = snapshot.pendingEquipmentPickups.find(
      (pending) => pending.playerEntityId === player.entityId,
    );
    const pendingEquipmentLoot = pendingEquipmentPickup
      ? snapshot.lootDrops.find((drop) => drop.entityId === pendingEquipmentPickup.lootEntityId)
      : undefined;
    const signature = [
      player.gems,
      player.lifeState,
      ...player.passives.map((passive) => `${passive.passiveId}:${passive.level}`),
      '|',
      ...player.equipment.map((instance) => `${instance.instanceId}:${instance.equipmentId}`),
      '|',
      ...player.inventoryEquipment.map(
        (instance) => `${instance.instanceId}:${instance.equipmentId}`,
      ),
      '|',
      player.activeAbilityId,
      '|',
      nearbyBook ? `${nearbyBook.entityId}:${nearbyBook.bookPassiveId ?? ''}` : '',
      pendingActiveReplacement
        ? `${pendingActiveReplacement.lootEntityId}:${pendingActiveReplacement.activeId}`
        : '',
      pendingEquipmentPickup
        ? `${pendingEquipmentPickup.lootEntityId}:${pendingEquipmentLoot?.equipmentId ?? ''}`
        : '',
    ].join(',');
    if (signature === this.progressSignature) {
      return;
    }
    this.progressSignature = signature;
    this.passiveList.replaceChildren();
    for (const passive of player.passives) {
      const row = document.createElement('div');
      row.className = 'passive-row';
      row.dataset.buildKey = `passive:${passive.passiveId}`;
      const label = document.createElement('span');
      label.textContent = `${getAuthoritativePassive(passive.passiveId).name} Lv.${passive.level}`;
      row.append(label);
      const upgrade = document.createElement('button');
      upgrade.type = 'button';
      upgrade.className = 'mini-action';
      upgrade.title = `升级 ${getAuthoritativePassive(passive.passiveId).name}`;
      upgrade.setAttribute('aria-label', upgrade.title);
      upgrade.disabled = player.gems <= 0 || passive.level >= 5 || player.lifeState !== 'alive';
      upgrade.append(createElement(ArrowUp, { width: 14, height: 14 }));
      upgrade.addEventListener('click', () => {
        this.host.spendGem(passive.passiveId);
      });
      row.append(upgrade);
      this.passiveList.append(row);
    }
    if (player.passives.length < 4) {
      this.passiveList.append(
        this.createBuildInfoRow('empty:passive', '被动空位：拾取技能书可学习新被动'),
      );
    }

    const activeDefinition = getActiveDefinition(player.activeAbilityId);
    const activeRange = activePresentationRange(activeDefinition);
    this.passiveList.append(
      this.createBuildInfoRow(
        `active:${player.activeAbilityId}`,
        activeRange
          ? `当前主动 ${activeDefinition.name} · 作用距离 ${(activeRange.rangeMm / 1_000).toFixed(0)} 米`
          : `当前主动 ${activeDefinition.name} · 自身效果`,
      ),
    );

    if (nearbyBook?.bookPassiveId && player.passives.length >= 4) {
      const incomingPassive = getAuthoritativePassive(nearbyBook.bookPassiveId);
      const prompt = document.createElement('div');
      prompt.className = 'book-prompt';
      const label = document.createElement('span');
      label.textContent = `技能书 ${incomingPassive.name}`;
      prompt.append(label);
      const choices = document.createElement('span');
      choices.className = 'shop-actions';
      for (const passive of player.passives) {
        const currentPassive = getAuthoritativePassive(passive.passiveId);
        choices.append(
          this.createShopButton(
            `换${currentPassive.name}`,
            `遗忘 ${currentPassive.name}，学习 ${incomingPassive.name}`,
            () => {
              this.host.replaceSkillBook(nearbyBook.entityId, passive.passiveId);
            },
          ),
        );
      }
      prompt.append(choices);
      this.passiveList.append(prompt);
    }

    if (pendingActiveReplacement && pendingActiveLoot) {
      const incomingActive = getActiveDefinition(pendingActiveReplacement.activeId);
      const prompt = document.createElement('div');
      prompt.className = 'book-prompt';
      const label = document.createElement('span');
      label.textContent = `主动技能 ${incomingActive.name}`;
      prompt.append(label);
      const choices = document.createElement('span');
      choices.className = 'shop-actions';
      choices.append(
        this.createShopButton('替换', `替换为 ${incomingActive.name}`, () => {
          this.host.replaceActiveLoot(pendingActiveLoot.entityId, true);
        }),
        this.createShopButton('保留', '保留当前主动技能', () => {
          this.host.replaceActiveLoot(pendingActiveLoot.entityId, false);
        }),
      );
      prompt.append(choices);
      this.passiveList.append(prompt);
    }

    if (pendingEquipmentPickup && pendingEquipmentLoot?.equipmentId) {
      const incomingDefinition = getEquipmentDefinition(pendingEquipmentLoot.equipmentId);
      const prompt = document.createElement('div');
      prompt.className = 'book-prompt';
      const label = document.createElement('span');
      label.textContent = `拾取 ${incomingDefinition.name}`;
      prompt.append(label);
      const choices = document.createElement('span');
      choices.className = 'shop-actions';

      for (const instance of player.inventoryEquipment) {
        choices.append(
          this.createShopButton(
            `丢手牌${getEquipmentDefinition(instance.equipmentId).name}`,
            `丢弃手牌 ${getEquipmentDefinition(instance.equipmentId).name}，拾取 ${incomingDefinition.name}`,
            () => {
              this.host.pickupEquipmentLoot(
                pendingEquipmentLoot.entityId,
                'inventory',
                instance.instanceId,
              );
            },
          ),
        );
      }

      const canEquipWithoutReplacement =
        player.equipment.length < 3 &&
        !player.equipment.some(
          (instance) => instance.equipmentId === pendingEquipmentLoot.equipmentId,
        );
      if (canEquipWithoutReplacement) {
        choices.append(
          this.createShopButton('直接穿戴', `直接穿戴 ${incomingDefinition.name}`, () => {
            this.host.pickupEquipmentLoot(pendingEquipmentLoot.entityId, 'equipped', null);
          }),
        );
      }

      for (const instance of player.equipment) {
        const legalAfterReplacement = player.equipment
          .filter((candidate) => candidate.instanceId !== instance.instanceId)
          .every((candidate) => candidate.equipmentId !== pendingEquipmentLoot.equipmentId);
        if (!legalAfterReplacement) {
          continue;
        }
        choices.append(
          this.createShopButton(
            `换${getEquipmentDefinition(instance.equipmentId).name}`,
            `替换身穿 ${getEquipmentDefinition(instance.equipmentId).name}，旧装落地`,
            () => {
              this.host.pickupEquipmentLoot(
                pendingEquipmentLoot.entityId,
                'equipped',
                instance.instanceId,
              );
            },
          ),
        );
      }

      choices.append(
        this.createShopButton('取消', '取消拾取并保留地面装备', () => {
          this.host.pickupEquipmentLoot(pendingEquipmentLoot.entityId, 'cancel', null);
        }),
      );
      prompt.append(choices);
      this.passiveList.append(prompt);
    }

    for (const instance of player.equipment) {
      const row = document.createElement('div');
      row.className = 'passive-row';
      row.dataset.buildKey = `equipped:${instance.instanceId}`;
      const label = document.createElement('span');
      label.textContent = `身穿 ${getEquipmentDefinition(instance.equipmentId).name}`;
      row.append(label);
      const actions = document.createElement('span');
      actions.className = 'shop-actions';
      actions.append(
        this.createShopButton('收回', `卸下 ${label.textContent}`, () => {
          this.host.unequipEquipment(instance.instanceId);
        }),
        this.createShopButton('丢弃', `丢弃 ${label.textContent}`, () => {
          this.host.discardEquipment(instance.instanceId);
        }),
      );
      row.append(actions);
      this.passiveList.append(row);
    }
    if (player.equipment.length < 3) {
      this.passiveList.append(
        this.createBuildInfoRow('empty:equipment', '装备空位：可购买或拾取装备并直接穿戴'),
      );
    }
    for (const instance of player.inventoryEquipment) {
      const row = document.createElement('div');
      row.className = 'passive-row';
      row.dataset.buildKey = `inventory:${instance.instanceId}`;
      const label = document.createElement('span');
      label.textContent = `手牌 ${getEquipmentDefinition(instance.equipmentId).name}`;
      row.append(label);
      const actions = document.createElement('span');
      actions.className = 'shop-actions';
      if (player.equipment.length < 3) {
        actions.append(
          this.createShopButton('穿戴', `穿戴 ${label.textContent}`, () => {
            this.host.equipInventoryEquipment(instance.instanceId);
          }),
        );
      } else {
        for (const equipped of player.equipment) {
          actions.append(
            this.createShopButton(
              `换${getEquipmentDefinition(equipped.equipmentId).name}`,
              `替换 ${getEquipmentDefinition(equipped.equipmentId).name}`,
              () => {
                this.host.equipInventoryEquipment(instance.instanceId, equipped.instanceId);
              },
            ),
          );
        }
      }
      actions.append(
        this.createShopButton('丢弃', `丢弃 ${label.textContent}`, () => {
          this.host.discardEquipment(instance.instanceId);
        }),
      );
      row.append(actions);
      this.passiveList.append(row);
    }
    if (player.inventoryEquipment.length === 0) {
      this.passiveList.append(
        this.createBuildInfoRow('empty:hand', '手牌空位：可暂存一件未穿戴装备'),
      );
    }
    this.applySelectedBuildFocus();
  }

  private updateAirdrop(snapshot: WorldSnapshot, player: PlayerSnapshot): void {
    const localChannel = snapshot.airdropChannels.find(
      (channel) => channel.playerEntityId === player.entityId,
    );
    const publicAirdrops = snapshot.airdrops
      .filter((airdrop) => airdrop.phase === 'warning' || airdrop.phase === 'available')
      .sort((left, right) => {
        const leftPriority = left.phase === 'available' ? 0 : 1;
        const rightPriority = right.phase === 'available' ? 0 : 1;
        const leftDistance = left.position
          ? distanceSquaredMm(player.position, left.position)
          : Number.MAX_SAFE_INTEGER;
        const rightDistance = right.position
          ? distanceSquaredMm(player.position, right.position)
          : Number.MAX_SAFE_INTEGER;
        return (
          leftPriority - rightPriority ||
          leftDistance - rightDistance ||
          left.sequence - right.sequence
        );
      });
    const focused = localChannel
      ? snapshot.airdrops.find((airdrop) => airdrop.id === localChannel.airdropId)
      : publicAirdrops[0];

    this.nearbyAirdropId = null;
    this.interactButton.classList.remove('has-airdrop-target', 'is-channeling');
    this.interactProgress.hidden = true;
    this.interactProgressText.textContent = '';
    this.interactButton.setAttribute('aria-label', '拾取或交互');
    this.interactButton.title = '';

    if (!focused?.position) {
      this.airdropBanner.hidden = true;
      this.root.classList.remove('has-airdrop');
      return;
    }

    this.airdropBanner.hidden = false;
    this.root.classList.add('has-airdrop');
    const distanceSquared = distanceSquaredMm(player.position, focused.position);
    const distanceMeters = Math.round(Math.sqrt(distanceSquared) / 1_000);

    if (localChannel) {
      const duration = Math.max(1, localChannel.completesAtTick - localChannel.startedAtTick);
      const remainingTicks = Math.max(0, localChannel.completesAtTick - snapshot.tick);
      const elapsedTicks = duration - remainingTicks;
      const progressDegrees = Math.round((elapsedTicks / duration) * 360);
      this.airdropTitle.textContent = '正在开启空投';
      this.airdropMeta.textContent = `${(remainingTicks / TICKS_PER_SECOND).toFixed(1)} 秒 · ${distanceMeters} 米`;
      this.interactButton.classList.add('is-channeling');
      this.interactProgress.hidden = false;
      this.interactProgress.style.setProperty('--interaction-angle', `${progressDegrees}deg`);
      this.interactProgressText.textContent = Math.ceil(
        remainingTicks / TICKS_PER_SECOND,
      ).toString();
      return;
    }

    if (focused.phase === 'warning') {
      const scheduledAtTick = (snapshot.match.startedAtTick ?? 0) + focused.scheduledElapsedTick;
      const remainingTicks = Math.max(0, scheduledAtTick - snapshot.tick);
      this.airdropTitle.textContent = '空投即将落地';
      this.airdropMeta.textContent = `${Math.ceil(
        remainingTicks / TICKS_PER_SECOND,
      )} 秒 · ${distanceMeters} 米`;
      return;
    }

    const remainingTicks = Math.max(0, (focused.expiresAtTick ?? snapshot.tick) - snapshot.tick);
    this.airdropTitle.textContent = '空投已落地';
    this.airdropMeta.textContent = `${Math.ceil(
      remainingTicks / TICKS_PER_SECOND,
    )} 秒 · ${distanceMeters} 米`;
    const canOpen =
      distanceSquared <= 2_500 * 2_500 &&
      player.lifeState === 'alive' &&
      player.pvpCombatTicks <= 0 &&
      player.worldInteractionLockTicks <= 0;
    if (canOpen) {
      this.nearbyAirdropId = focused.id;
      this.interactButton.classList.add('has-airdrop-target');
      this.interactButton.setAttribute('aria-label', '开启空投');
      this.interactButton.title = '开启空投';
    }
  }

  private updateShopPanel(snapshot: WorldSnapshot, player: PlayerSnapshot): void {
    const shop = nearbyShop(snapshot, player);

    if (!shop) {
      this.dismissedShopId = null;
      this.shopSignature = '';
      this.shopPanel.hidden = true;
      return;
    }

    if (this.dismissedShopId === shop.shopId) {
      this.shopPanel.hidden = true;
      return;
    }
    this.dismissedShopId = null;
    this.shopPanel.dataset.shopId = shop.shopId;
    this.shopPanel.hidden = false;
    const relocationSeconds =
      shop.status === 'relocating'
        ? Math.ceil(Math.max(0, shop.nextRelocationAttemptTick - snapshot.tick) / TICKS_PER_SECOND)
        : 0;
    const taibaiChannelSeconds = Math.ceil(player.taibaiChannelTicks / TICKS_PER_SECOND);
    const taibaiCooldownSeconds = Math.ceil(player.taibaiCooldownTicks / TICKS_PER_SECOND);
    const combatLockSeconds = Math.ceil(player.pvpCombatTicks / TICKS_PER_SECOND);
    const signature = [
      shop.shopId,
      shop.kind,
      shop.version,
      shop.status,
      relocationSeconds,
      combatLockSeconds,
      ...shop.inventory.map(
        (listing) =>
          `${listing.listingId}:${listing.kind}:${listing.equipmentId ?? ''}:${
            listing.consumableId ?? ''
          }:${listing.price}`,
      ),
      '|',
      player.gold,
      player.lifeState,
      taibaiChannelSeconds,
      taibaiCooldownSeconds,
      player.heishanGambleCount,
      player.activeAbilityId,
      ...player.passives.map((passive) => `${passive.passiveId}:${passive.level}`),
      '|',
      ...player.equipment.map((instance) => `${instance.instanceId}:${instance.equipmentId}`),
      '|',
      ...player.inventoryEquipment.map(
        (instance) => `${instance.instanceId}:${instance.equipmentId}`,
      ),
    ].join(',');
    if (signature === this.shopSignature) {
      return;
    }
    this.shopSignature = signature;
    this.shopTitle.textContent = `${shopDisplayName(shop)} · ${shopStatusLabel(shop, relocationSeconds)}`;
    this.shopContent.replaceChildren();
    const locked = player.pvpCombatTicks > 0 || player.lifeState !== 'alive';
    if (locked) {
      const status = document.createElement('div');
      status.className = 'shop-row';
      status.textContent =
        player.lifeState !== 'alive'
          ? '存活后才能交易'
          : `脱离战斗后可交易 · 还需 ${combatLockSeconds} 秒`;
      this.shopContent.append(status);
    }
    if (shop.status === 'relocating') {
      const status = document.createElement('div');
      status.className = 'shop-row';
      status.textContent = `正在迁移 · ${relocationSeconds}秒后重试落点`;
      this.shopContent.append(status);
      return;
    }
    for (const listing of shop.inventory) {
      const row = document.createElement('div');
      row.className = 'shop-row';
      const label = document.createElement('span');
      const name =
        listing.kind === 'gem'
          ? '宝石'
          : listing.kind === 'consumable'
            ? listing.consumableId === 'clairvoyance-talisman'
              ? '千里符'
              : '照妖镜'
            : listing.equipmentId
              ? getEquipmentDefinition(listing.equipmentId).name
              : '装备';
      label.textContent = `${name}  ${listing.price}金`;
      row.append(label);
      const actions = document.createElement('span');
      actions.className = 'shop-actions';
      if (listing.kind === 'gem' || listing.kind === 'consumable') {
        const button = this.createShopButton('购买', `购买 ${name}`, () => {
          this.host.purchaseShopListing(shop.shopId, listing.listingId, shop.version, 'inventory');
        });
        button.disabled = locked || player.gold < listing.price;
        actions.append(button);
      } else if (listing.equipmentId !== null) {
        const equip = this.createShopButton('穿戴', `购买并穿戴 ${name}`, () => {
          this.host.purchaseShopListing(shop.shopId, listing.listingId, shop.version, 'equipped');
        });
        const hand = this.createShopButton('入手牌', `购买 ${name} 到手牌`, () => {
          this.host.purchaseShopListing(shop.shopId, listing.listingId, shop.version, 'inventory');
        });
        equip.disabled = locked || player.gold < listing.price;
        hand.disabled = locked || player.gold < listing.price;
        actions.append(equip, hand);
      }
      row.append(actions);
      this.shopContent.append(row);
    }

    if (shop.kind === 'taibai') {
      const status = document.createElement('div');
      status.className = 'shop-row';
      status.textContent =
        player.taibaiChannelTicks > 0
          ? `转命引导中 ${taibaiChannelSeconds}秒`
          : player.taibaiCooldownTicks > 0
            ? `转命冷却 ${taibaiCooldownSeconds}秒`
            : '本店提供 5 名转命候选 · 1500金';
      this.shopContent.append(status);
      for (const candidate of stableTaibaiOffers(shop.shopId, shop.version, player.heroId)) {
        const candidateId = heroId(candidate.id);
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.dataset.heroId = candidate.id;
        const label = document.createElement('span');
        label.textContent = `${candidate.id} ${candidate.name}`;
        row.append(label);
        const button = this.createShopButton('转命', `转命为 ${candidate.name}`, () => {
          this.host.startHeroSwap(shop.shopId, shop.version, candidateId);
        });
        button.disabled =
          locked ||
          player.gold < 1_500 ||
          player.taibaiCooldownTicks > 0 ||
          player.taibaiChannelTicks > 0;
        row.append(button);
        this.shopContent.append(row);
      }
    }

    if (shop.kind === 'heishan') {
      const gambleHeader = document.createElement('div');
      gambleHeader.className = 'shop-row';
      gambleHeader.textContent = `黑山赌命 ${player.heishanGambleCount}/3`;
      this.shopContent.append(gambleHeader);

      for (const passive of player.passives) {
        const row = document.createElement('div');
        row.className = 'shop-row';
        const current = getAuthoritativePassive(passive.passiveId);
        const label = document.createElement('span');
        label.textContent = `被动 ${current.name} Lv.${passive.level}`;
        row.append(label);
        const button = this.createShopButton('赌命', `赌 ${current.name}`, () => {
          this.host.gamblePassive(shop.shopId, shop.version, passive.passiveId);
        });
        button.disabled = locked || player.heishanGambleCount >= 3;
        row.append(button);
        this.shopContent.append(row);
      }

      for (const instance of [...player.equipment, ...player.inventoryEquipment]) {
        const row = document.createElement('div');
        row.className = 'shop-row';
        const name = getEquipmentDefinition(instance.equipmentId).name;
        const label = document.createElement('span');
        label.textContent = `装备 ${name}`;
        row.append(label);
        const button = this.createShopButton('赌命', `赌 ${name}`, () => {
          this.host.gambleEquipment(shop.shopId, shop.version, instance.instanceId);
        });
        button.disabled = locked || player.heishanGambleCount >= 3;
        row.append(button);
        this.shopContent.append(row);
      }

      const activeDefinition = getActiveDefinition(player.activeAbilityId);
      const activeRow = document.createElement('div');
      activeRow.className = 'shop-row';
      const activeLabel = document.createElement('span');
      activeLabel.textContent = `主动 ${activeDefinition.name}`;
      activeRow.append(activeLabel);
      const activeButton = this.createShopButton('赌命', '赌当前主动', () => {
        this.host.gambleActive(shop.shopId, shop.version);
      });
      activeButton.disabled = locked || player.heishanGambleCount >= 3;
      activeRow.append(activeButton);
      this.shopContent.append(activeRow);

      const goldRow = document.createElement('div');
      goldRow.className = 'shop-row';
      goldRow.textContent = '金币翻倍';
      for (const wager of [500, 1_000, 2_000, 5_000]) {
        const button = this.createShopButton(`${wager}金`, `押 ${wager} 金翻倍`, () => {
          this.host.gambleGold(shop.shopId, shop.version, wager, 'double');
        });
        button.disabled = locked || player.heishanGambleCount >= 3 || player.gold < wager;
        goldRow.append(button);
      }
      this.shopContent.append(goldRow);

      const purpleRow = document.createElement('div');
      purpleRow.className = 'shop-row';
      purpleRow.textContent = '赌紫装';
      const purpleButton = this.createShopButton('2000金', '押 2000 金赌紫装', () => {
        this.host.gambleGold(shop.shopId, shop.version, 2_000, 'purple');
      });
      purpleButton.disabled = locked || player.heishanGambleCount >= 3 || player.gold < 2_000;
      purpleRow.append(purpleButton);
      this.shopContent.append(purpleRow);
    }

    if (shop.kind !== 'taibai' && shop.kind !== 'heishan') {
      for (const instance of [...player.equipment, ...player.inventoryEquipment]) {
        const row = document.createElement('div');
        row.className = 'shop-row';
        const name = getEquipmentDefinition(instance.equipmentId).name;
        const label = document.createElement('span');
        label.textContent = `出售 ${name}`;
        row.append(label);
        const button = this.createShopButton('出售', `出售 ${name}`, () => {
          this.host.sellShopEquipment(shop.shopId, instance.instanceId, shop.version);
        });
        button.disabled = locked;
        row.append(button);
        this.shopContent.append(row);
      }
    }
  }

  private createShopButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-action';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private updateActiveCooldown(
    player: PlayerSnapshot,
    totalTicks: number,
    matchFinished: boolean,
  ): void {
    const remaining = player.activeCooldownTicks;
    const iceCoffinLocked = player.iceCoffinTicks > 0;
    const angle = totalTicks > 0 ? Math.round((remaining / totalTicks) * 360) : 0;
    this.activeButton.style.setProperty('--cooldown-angle', `${angle}deg`);
    this.activeButton.disabled =
      matchFinished || remaining > 0 || player.lifeState !== 'alive' || iceCoffinLocked;
    this.attackButton.disabled = matchFinished || player.lifeState !== 'alive' || iceCoffinLocked;
    this.interactButton.disabled =
      matchFinished ||
      player.lifeState !== 'alive' ||
      iceCoffinLocked ||
      player.hardControlTicks > 0 ||
      player.polymorphTicks > 0 ||
      player.worldInteractionLockTicks > 0;
    this.activeCooldownText.textContent =
      remaining > 0 ? Math.ceil(remaining / TICKS_PER_SECOND).toString() : '';
  }

  private readonly handleContextualInteract = (): boolean => {
    if (this.nearbyAirdropId !== null) {
      const airdropId = this.nearbyAirdropId;
      this.nearbyAirdropId = null;
      this.interactButton.classList.remove('has-airdrop-target');
      this.host.openAirdrop(airdropId);
      return true;
    }
    if (this.dismissedShopId !== null) {
      this.dismissedShopId = null;
      return true;
    }
    return false;
  };

  private bindActions(): void {
    this.interactButton.addEventListener('click', (event) => {
      event.preventDefault();
      this.input.queueInteract();
    });
    const releaseAttack = (): void => {
      this.attackButton.classList.remove('is-pressed');
      this.input.setAttackPressed(false);
      this.onCombatRangePreview('none');
    };
    this.attackButton.addEventListener('pointerenter', () => {
      this.onCombatRangePreview('attack');
    });
    this.attackButton.addEventListener('pointerleave', () => {
      if (!this.attackButton.classList.contains('is-pressed')) {
        this.onCombatRangePreview('none');
      }
    });
    this.attackButton.addEventListener('focus', () => {
      this.onCombatRangePreview('attack');
    });
    this.attackButton.addEventListener('blur', () => {
      this.onCombatRangePreview('none');
    });
    this.attackButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      tryCapturePointer(this.attackButton, event.pointerId);
      this.attackButton.classList.add('is-pressed');
      this.onCombatRangePreview('attack');
      this.input.setAttackPressed(true);
    });
    this.attackButton.addEventListener('pointerup', releaseAttack);
    this.attackButton.addEventListener('pointercancel', releaseAttack);
    this.attackButton.addEventListener('lostpointercapture', releaseAttack);
    const clearActivePreview = (): void => {
      this.onCombatRangePreview('none');
    };
    this.activeButton.addEventListener('pointerenter', () => {
      this.onCombatRangePreview('active');
    });
    this.activeButton.addEventListener('pointerleave', clearActivePreview);
    this.activeButton.addEventListener('focus', () => {
      this.onCombatRangePreview('active');
    });
    this.activeButton.addEventListener('blur', clearActivePreview);
    this.activeButton.addEventListener('pointerdown', () => {
      this.onCombatRangePreview('active');
    });
    this.activeButton.addEventListener('pointercancel', clearActivePreview);
    this.activeButton.addEventListener('click', (event) => {
      event.preventDefault();
      this.input.queueActive();
      clearActivePreview();
    });
    requiredElement<HTMLButtonElement>(this.root, '.restart-button').addEventListener(
      'click',
      this.onRestart,
    );
  }

  private bindJoystick(): void {
    const joystick = requiredElement<HTMLElement>(this.root, '.joystick');
    const knob = requiredElement<HTMLElement>(this.root, '.joystick-knob');
    let activePointerId: number | null = null;

    const update = (event: PointerEvent): void => {
      const bounds = joystick.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      const maximum = bounds.width * 0.31;
      const rawX = event.clientX - centerX;
      const rawY = event.clientY - centerY;
      const length = Math.hypot(rawX, rawY);
      const scale = length > maximum ? maximum / length : 1;
      const x = rawX * scale;
      const y = rawY * scale;
      knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      this.input.setJoystick(x / maximum, y / maximum, true);
    };

    const release = (event: PointerEvent): void => {
      if (event.pointerId !== activePointerId) {
        return;
      }
      activePointerId = null;
      knob.style.transform = 'translate(-50%, -50%)';
      this.input.setJoystick(0, 0, false);
    };

    joystick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      activePointerId = event.pointerId;
      tryCapturePointer(joystick, event.pointerId);
      update(event);
    });
    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId === activePointerId) {
        update(event);
      }
    });
    joystick.addEventListener('pointerup', release);
    joystick.addEventListener('pointercancel', release);
    joystick.addEventListener('lostpointercapture', release);
  }
}
