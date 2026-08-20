import {
  AUTHORITATIVE_EQUIPMENT,
  AUTHORITATIVE_HEROES,
  AUTHORITATIVE_PASSIVES,
  getHeroDefinition,
} from '@jwgb/content';
import { heroId, type PlayerId, playerId, TICKS_PER_SECOND } from '@jwgb/core';
import type { ServerMessage } from '@jwgb/protocol';
import { createElement, HelpCircle, Play, RefreshCw, Settings, Swords, X } from 'lucide';
import {
  activeIconUrl,
  equipmentIconUrl,
  flowAssetUrl,
  heroCardUrl,
  heroPortraitUrl,
  passiveIconUrl,
} from '../runtime/asset-url';
import { MatchmakingClient } from '../runtime/matchmaking-client';
import { resolveOnlineServerUrl } from '../runtime/online-server-url';
import { WebAudioRuntime } from '../runtime/web-audio';
import {
  loadWebGameSettings,
  saveWebGameSettings,
  type WebGameSettings,
} from '../runtime/web-settings';
import { GameMenu } from '../ui/game-menu';
import type { GameApp, GameAppReadyState } from './game-app';
import {
  cancelMatchmaking,
  completeBoot,
  createInitialGameFlowState,
  finishBattle,
  type GameFlowResult,
  type GameFlowState,
  markBattleReady,
  returnToLobby,
  selectHero,
  startMatchmaking,
} from './game-flow';

type AuthoritativeHeroRecord = (typeof AUTHORITATIVE_HEROES)[number];
type LobbyCatalogKind = 'heroes' | 'passives' | 'equipment' | 'runtime';

const HERO_RECORDS: ReadonlyMap<string, AuthoritativeHeroRecord> = new Map(
  AUTHORITATIVE_HEROES.map((hero) => [hero.id, hero]),
);
const BOOT_MINIMUM_MS = 650;
const BOOT_ASSET_TIMEOUT_MS = 2_500;
type MatchmakingQueuedMessage = Extract<ServerMessage, { readonly type: 'matchmaking-queued' }>;
type MatchmakingSelectionMessage = Extract<
  ServerMessage,
  { readonly type: 'matchmaking-selection' }
>;
type MatchmakingAssignedMessage = Extract<ServerMessage, { readonly type: 'matchmaking-assigned' }>;
type MatchmakingCancelledMessage = Extract<
  ServerMessage,
  { readonly type: 'matchmaking-cancelled' }
>;
type MatchmakingErrorMessage = Extract<ServerMessage, { readonly type: 'error' }>;

declare global {
  interface Window {
    __JWGB_FLOW__?: {
      getState: () => GameFlowState;
      getRuntimeCreationCount: () => number;
      getRuntimeHeroId: () => string | null;
      startMatch: () => void;
      cancelMatch: () => void;
      selectHero: (heroId: string) => void;
      confirmHero: () => void;
      returnToLobby: () => void;
    };
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function formatSurvival(seconds: number): string {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (): void => resolve();
    const timeout = window.setTimeout(finish, BOOT_ASSET_TIMEOUT_MS);
    image.addEventListener(
      'load',
      () => {
        window.clearTimeout(timeout);
        finish();
      },
      { once: true },
    );
    image.addEventListener(
      'error',
      () => {
        window.clearTimeout(timeout);
        finish();
      },
      { once: true },
    );
    image.src = url;
  });
}

export class GameShell {
  private readonly runtimeRoot: HTMLElement;
  private readonly flowLayer: HTMLElement;
  private readonly flowMenuRoot: HTMLElement;
  private state = createInitialGameFlowState();
  private settings: WebGameSettings;
  private flowAudio: WebAudioRuntime | null = null;
  private flowMenu: GameMenu | null = null;
  private gameApp: GameApp | null = null;
  private matchmakingClient: MatchmakingClient | null = null;
  private matchmakingPlayerId: PlayerId | null = null;
  private matchmakingCancelPending = false;
  private selectionSubmitPending = false;
  private runtimeLoadGeneration = 0;
  private runtimeCreationCount = 0;
  private runtimeHeroId: string | null = null;
  private animationFrame = 0;
  private previousFrameTime = performance.now();
  private disposed = false;

  constructor(private readonly root: HTMLElement) {
    this.settings = loadWebGameSettings(window.localStorage);
    root.innerHTML = `
      <div class="application-shell" data-flow-screen="boot">
        <div class="game-runtime-root" aria-hidden="true"></div>
        <div class="game-flow-layer"></div>
        <div class="flow-menu-host game-menu-host"></div>
      </div>
    `;
    const runtimeRoot = root.querySelector<HTMLElement>('.game-runtime-root');
    const flowLayer = root.querySelector<HTMLElement>('.game-flow-layer');
    const flowMenuRoot = root.querySelector<HTMLElement>('.flow-menu-host');
    if (!runtimeRoot || !flowLayer || !flowMenuRoot) {
      throw new Error('application shell initialization failed');
    }
    this.runtimeRoot = runtimeRoot;
    this.flowLayer = flowLayer;
    this.flowMenuRoot = flowMenuRoot;
    this.render();
    this.ensureFlowServices();
    window.addEventListener('pointerdown', this.handleAudioUnlock, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', this.handleAudioUnlock, true);
    window.__JWGB_FLOW__ = {
      getState: () => this.state,
      getRuntimeCreationCount: () => this.runtimeCreationCount,
      getRuntimeHeroId: () => this.runtimeHeroId,
      startMatch: this.startMatch,
      cancelMatch: this.cancelMatch,
      selectHero: this.selectHeroById,
      confirmHero: this.confirmHero,
      returnToLobby: this.returnToLobby,
    };
  }

  start(): void {
    this.animationFrame = requestAnimationFrame(this.frame);
    void this.completeBoot();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('pointerdown', this.handleAudioUnlock, true);
    window.removeEventListener('keydown', this.handleAudioUnlock, true);
    this.disposeMatchmaking();
    this.destroyGameRuntime();
    this.disposeFlowServices();
    delete window.__JWGB_FLOW__;
  }

  private async completeBoot(): Promise<void> {
    await Promise.all([
      delay(BOOT_MINIMUM_MS),
      Promise.all([
        loadImage(flowAssetUrl('lobby-environment')),
        loadImage(flowAssetUrl('lobby-wukong')),
        loadImage(heroCardUrl('H009')),
      ]),
    ]);
    if (this.disposed || this.state.screen !== 'boot') {
      return;
    }
    this.transition(completeBoot(this.state));
  }

  private transition(nextState: GameFlowState): void {
    const previousScreen = this.state.screen;
    this.state = nextState;
    if (nextState.screen === 'loading' && previousScreen !== 'loading') {
      this.disposeMatchmaking();
      this.disposeFlowServices();
    }
    if (nextState.screen === 'result' && previousScreen !== 'result') {
      this.destroyGameRuntime();
      this.ensureFlowServices();
    }
    if (
      (nextState.screen === 'lobby' ||
        nextState.screen === 'matching' ||
        nextState.screen === 'select') &&
      this.flowAudio === null
    ) {
      this.ensureFlowServices();
    }
    this.render();
    if (nextState.screen === 'loading') {
      void this.createGameRuntime();
    }
  }

  private render(): void {
    const applicationShell = this.root.querySelector<HTMLElement>('.application-shell');
    if (applicationShell) {
      applicationShell.dataset.flowScreen = this.state.screen;
    }

    switch (this.state.screen) {
      case 'boot':
        this.renderBoot();
        break;
      case 'lobby':
      case 'matching':
        this.renderLobby();
        break;
      case 'select':
        this.renderHeroSelection();
        break;
      case 'loading':
        this.renderLoading();
        break;
      case 'battle':
        this.flowLayer.replaceChildren();
        this.flowLayer.hidden = true;
        break;
      case 'result':
        this.renderResult();
        break;
    }
  }

  private setFlowBackground(element: HTMLElement, strength = 0.2): void {
    element.style.backgroundImage = `linear-gradient(
      90deg,
      rgb(2 24 26 / ${strength + 0.08}),
      rgb(3 33 32 / ${strength * 0.34}) 52%,
      rgb(2 24 26 / ${strength + 0.18})
    ), url("${flowAssetUrl('lobby-environment')}")`;
  }

  private renderBoot(): void {
    this.flowLayer.hidden = false;
    this.flowLayer.innerHTML = `
      <section class="flow-screen boot-flow-screen" data-screen="boot">
        <div class="boot-seal" aria-hidden="true">命</div>
        <h1>三命无常</h1>
        <p>正在校验规则与资源</p>
        <div class="flow-progress" aria-label="加载中"><i></i></div>
      </section>
    `;
    const screen = this.flowLayer.querySelector<HTMLElement>('.flow-screen');
    if (screen) {
      this.setFlowBackground(screen, 0.12);
    }
  }

  private renderLobby(): void {
    const matching = this.state.screen === 'matching';
    this.flowLayer.hidden = false;
    this.flowLayer.innerHTML = `
      <section class="flow-screen lobby-flow-screen" data-screen="${this.state.screen}">
        <header class="lobby-toolbar flow-panel">
          <button class="lobby-identity" type="button" aria-label="当前玩家">
            <img src="${heroPortraitUrl('H009')}" alt="" />
            <span><b>无常客</b><small>百眼迷城 · 在线</small></span>
          </button>
          <div class="lobby-tools">
            <button class="flow-icon-button lobby-help" type="button" aria-label="玩法帮助" title="玩法帮助">
              <span class="lobby-help-icon"></span>
            </button>
            <button class="flow-icon-button lobby-settings" type="button" aria-label="设置" title="设置">
              <span class="lobby-settings-icon"></span>
            </button>
          </div>
        </header>
        <div class="lobby-hero-stage" aria-hidden="true">
          <span class="lobby-hero-halo"></span>
          <img src="${flowAssetUrl('lobby-wukong')}" alt="" />
        </div>
        <article class="match-plaque flow-panel">
          <p class="flow-eyebrow">30 人 · 单人竞技 · 在线同池</p>
          <h1>百眼迷城</h1>
          <p class="match-mode-copy">三条命。搜集技能与装备，活到最后。</p>
          <button class="flow-primary-button start-match-button" type="button" ${matching ? 'disabled' : ''}>
            <span class="start-match-icon"></span>
            <span><b>开始对战</b><small>30 人单排</small></span>
          </button>
          <div class="match-tags"><span>三命制</span><span>无组队</span><span>权威服务器</span></div>
        </article>
        <nav class="lobby-nav flow-panel" aria-label="主导航">
          <button class="lobby-nav-button" type="button" data-catalog-kind="heroes">
            <b>${AUTHORITATIVE_HEROES.length}</b><small>英雄</small>
          </button>
          <button class="lobby-nav-button" type="button" data-catalog-kind="passives">
            <b>${AUTHORITATIVE_PASSIVES.length}</b><small>被动</small>
          </button>
          <button class="lobby-nav-button" type="button" data-catalog-kind="equipment">
            <b>${AUTHORITATIVE_EQUIPMENT.length}</b><small>装备</small>
          </button>
          <button class="lobby-nav-button" type="button" data-catalog-kind="runtime">
            <b>${TICKS_PER_SECOND} Hz</b><small>权威战斗</small>
          </button>
        </nav>
        <section
          class="lobby-catalog-overlay flow-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lobby-catalog-title"
          hidden
        >
          <header class="lobby-catalog-header">
            <span><small class="flow-eyebrow">资料库</small><h2 id="lobby-catalog-title"></h2></span>
            <button class="flow-icon-button lobby-catalog-close" type="button" aria-label="关闭资料库" title="关闭资料库">
              <span class="lobby-catalog-close-icon"></span>
            </button>
          </header>
          <div class="lobby-catalog-content"></div>
        </section>
        <aside class="queue-overlay flow-panel" ${matching ? '' : 'hidden'} aria-live="polite">
          <div class="queue-orbit" aria-hidden="true"></div>
          <div class="queue-copy">
            <b>正在寻找对局</b>
            <span>优先分配低延迟房间</span>
            <small>席位确认后进入英雄选择</small>
          </div>
          <strong class="queue-time">${formatClock(this.state.queueElapsedMs)}</strong>
          <small class="queue-position"></small>
          <small class="queue-error"></small>
          <button class="flow-secondary-button cancel-match-button" type="button" ${
            this.matchmakingCancelPending ? 'disabled' : ''
          }>
            <span class="cancel-match-icon"></span><span>取消</span>
          </button>
        </aside>
      </section>
    `;
    const screen = this.flowLayer.querySelector<HTMLElement>('.flow-screen');
    if (screen) {
      this.setFlowBackground(screen, 0.18);
    }
    this.flowLayer
      .querySelector('.lobby-help-icon')
      ?.append(createElement(HelpCircle, { width: 20, height: 20 }));
    this.flowLayer
      .querySelector('.lobby-settings-icon')
      ?.append(createElement(Settings, { width: 20, height: 20 }));
    this.flowLayer
      .querySelector('.start-match-icon')
      ?.append(createElement(Play, { width: 23, height: 23 }));
    this.flowLayer
      .querySelector('.cancel-match-icon')
      ?.append(createElement(X, { width: 17, height: 17 }));
    this.flowLayer
      .querySelector('.lobby-catalog-close-icon')
      ?.append(createElement(X, { width: 18, height: 18 }));
    this.flowLayer
      .querySelector<HTMLButtonElement>('.start-match-button')
      ?.addEventListener('click', this.startMatch);
    this.flowLayer
      .querySelector<HTMLButtonElement>('.cancel-match-button')
      ?.addEventListener('click', this.cancelMatch);
    this.flowLayer
      .querySelector<HTMLButtonElement>('.lobby-settings')
      ?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openFlowMenu('settings');
      });
    this.flowLayer
      .querySelector<HTMLButtonElement>('.lobby-help')
      ?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openFlowMenu('guide');
      });
    for (const button of this.flowLayer.querySelectorAll<HTMLButtonElement>(
      '.lobby-nav-button[data-catalog-kind]',
    )) {
      button.addEventListener('click', () => {
        this.openLobbyCatalog(button.dataset.catalogKind as LobbyCatalogKind);
      });
    }
    this.flowLayer
      .querySelector<HTMLButtonElement>('.lobby-catalog-close')
      ?.addEventListener('click', this.closeLobbyCatalog);
  }

  private openLobbyCatalog(kind: LobbyCatalogKind): void {
    const overlay = this.flowLayer.querySelector<HTMLElement>('.lobby-catalog-overlay');
    const title = this.flowLayer.querySelector<HTMLElement>('#lobby-catalog-title');
    const content = this.flowLayer.querySelector<HTMLElement>('.lobby-catalog-content');
    if (!overlay || !title || !content) {
      return;
    }

    for (const button of this.flowLayer.querySelectorAll<HTMLButtonElement>(
      '.lobby-nav-button[data-catalog-kind]',
    )) {
      button.classList.toggle('is-active', button.dataset.catalogKind === kind);
      button.setAttribute('aria-pressed', String(button.dataset.catalogKind === kind));
    }

    if (kind === 'heroes') {
      title.textContent = `英雄图鉴 · ${AUTHORITATIVE_HEROES.length}`;
      content.className = 'lobby-catalog-content is-grid';
      content.innerHTML = AUTHORITATIVE_HEROES.map(
        (hero) => `
          <article class="lobby-catalog-item">
            <img src="${heroPortraitUrl(hero.id)}" alt="" />
            <span>
              <small>${escapeHtml(hero.id)} · ${escapeHtml(hero.element)}</small>
              <b>${escapeHtml(hero.name)}</b>
              <em>${escapeHtml(hero.active.name)}</em>
            </span>
          </article>
        `,
      ).join('');
    } else if (kind === 'passives') {
      title.textContent = `被动技能 · ${AUTHORITATIVE_PASSIVES.length}`;
      content.className = 'lobby-catalog-content is-grid';
      content.innerHTML = AUTHORITATIVE_PASSIVES.map(
        (passive) => `
          <article class="lobby-catalog-item">
            <img src="${passiveIconUrl(passive.id)}" alt="" />
            <span>
              <small>${escapeHtml(passive.id)} · ${escapeHtml(passive.category)}</small>
              <b>${escapeHtml(passive.name)}</b>
              <em>技能书学习 · 宝石升级</em>
            </span>
          </article>
        `,
      ).join('');
    } else if (kind === 'equipment') {
      title.textContent = `装备图鉴 · ${AUTHORITATIVE_EQUIPMENT.length}`;
      content.className = 'lobby-catalog-content is-grid';
      content.innerHTML = AUTHORITATIVE_EQUIPMENT.map(
        (equipment) => `
          <article class="lobby-catalog-item" data-rarity="${equipment.rarity}">
            <img src="${equipmentIconUrl(equipment.id)}" alt="" />
            <span>
              <small>${escapeHtml(equipment.id)} · ${escapeHtml(equipment.rarity)}</small>
              <b>${escapeHtml(equipment.name)}</b>
              <em>${escapeHtml(equipment.summary)}</em>
            </span>
          </article>
        `,
      ).join('');
    } else {
      title.textContent = '权威战斗运行链路';
      content.className = 'lobby-catalog-content is-runtime';
      content.innerHTML = `
        <article><b>${TICKS_PER_SECOND} Hz</b><span>固定步长权威模拟</span></article>
        <article><b>输入</b><span>客户端提交移动、攻击、施法与交互意图</span></article>
        <article><b>结算</b><span>伤害、拾取、购买、出售与替换由同一模拟层确认</span></article>
        <article><b>同步</b><span>快照、事件和交易结果驱动战斗画面与 HUD</span></article>
      `;
    }

    overlay.hidden = false;
    this.flowAudio?.playCue('confirm');
    overlay.querySelector<HTMLButtonElement>('.lobby-catalog-close')?.focus();
  }

  private readonly closeLobbyCatalog = (): void => {
    const overlay = this.flowLayer.querySelector<HTMLElement>('.lobby-catalog-overlay');
    if (!overlay || overlay.hidden) {
      return;
    }
    overlay.hidden = true;
    for (const button of this.flowLayer.querySelectorAll<HTMLButtonElement>('.lobby-nav-button')) {
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
    }
    this.flowAudio?.playCue('cancel');
  };

  private renderHeroSelection(): void {
    this.flowLayer.hidden = false;
    const offerMarkup = this.state.offers
      .map((offeredHeroId) => {
        const record = HERO_RECORDS.get(offeredHeroId);
        if (!record) {
          return '';
        }
        const definition = getHeroDefinition(heroId(offeredHeroId));
        const selected = this.state.selectedHeroId === offeredHeroId;
        const recommended = this.state.recommendedHeroId === offeredHeroId;
        return `
          <button
            class="hero-offer${selected ? ' is-selected' : ''}"
            type="button"
            data-hero-id="${offeredHeroId}"
            aria-pressed="${selected}"
          >
            <img src="${heroCardUrl(offeredHeroId)}" alt="${escapeHtml(record.name)}" />
            ${recommended ? '<span class="recommended-badge">推荐</span>' : ''}
            <span class="offer-gradient"></span>
            <span class="offer-summary">
              <span class="offer-heading">
                <span><small>${escapeHtml(record.element)} · ${escapeHtml(record.template)}</small><b>${escapeHtml(record.name)}</b></span>
                <em>${offeredHeroId}</em>
              </span>
              <span class="offer-stats">
                <span><small>攻击</small><b>${definition.level1.attack}</b></span>
                <span><small>生命</small><b>${definition.level1.maxHp}</b></span>
                <span><small>移速</small><b>${(definition.level1.moveSpeedMmPerSecond / 1_000).toFixed(2)}</b></span>
              </span>
              <span class="offer-active">
                <img src="${activeIconUrl(record.active.id)}" alt="" />
                <span><small>专属主动</small><b>${escapeHtml(record.active.name)}</b></span>
              </span>
            </span>
          </button>
        `;
      })
      .join('');
    const selectedRecord = this.state.selectedHeroId
      ? HERO_RECORDS.get(this.state.selectedHeroId)
      : null;
    this.flowLayer.innerHTML = `
      <section class="flow-screen select-flow-screen" data-screen="select">
        <header class="select-toolbar flow-panel">
          <div><p class="flow-eyebrow">本局英雄</p><h1>三选一</h1></div>
          <div class="selection-wallet"><small>本局金币</small><b>${this.state.matchGold}</b></div>
          <div class="selection-actions">
            <button
              class="flow-icon-button select-cancel-button"
              type="button"
              aria-label="取消匹配"
              title="取消匹配"
              ${this.matchmakingCancelPending ? 'disabled' : ''}
            >
              <span class="select-cancel-icon"></span>
            </button>
            <strong class="selection-timer">${Math.ceil(this.state.selectionRemainingMs / 1_000)}</strong>
          </div>
        </header>
        <div class="hero-offer-grid">${offerMarkup}</div>
        <footer class="select-footer flow-panel">
          <button
            class="flow-secondary-button reroll-button"
            type="button"
            ${this.state.matchGold < 250 ? 'disabled' : ''}
          >
            <span class="reroll-icon"></span><span>整组重随 · 250 金</span>
          </button>
          <p class="selection-status">${
            selectedRecord
              ? `已选择 ${escapeHtml(selectedRecord.name)}`
              : `${Math.ceil(this.state.selectionRemainingMs / 1_000)} 秒后自动选择推荐英雄`
          }</p>
          <p class="selection-error"></p>
          <button
            class="flow-primary-button confirm-hero-button"
            type="button"
            ${this.state.selectedHeroId ? '' : 'disabled'}
          >
            <span class="confirm-hero-icon"></span><span>锁定英雄</span>
          </button>
        </footer>
      </section>
    `;
    const screen = this.flowLayer.querySelector<HTMLElement>('.flow-screen');
    if (screen) {
      this.setFlowBackground(screen, 0.32);
    }
    this.flowLayer
      .querySelector('.reroll-icon')
      ?.append(createElement(RefreshCw, { width: 18, height: 18 }));
    this.flowLayer
      .querySelector('.confirm-hero-icon')
      ?.append(createElement(Swords, { width: 19, height: 19 }));
    this.flowLayer
      .querySelector('.select-cancel-icon')
      ?.append(createElement(X, { width: 17, height: 17 }));
    for (const offer of this.flowLayer.querySelectorAll<HTMLButtonElement>('.hero-offer')) {
      offer.addEventListener('click', () => {
        const offeredHeroId = offer.dataset.heroId;
        if (offeredHeroId) {
          this.selectHeroById(offeredHeroId);
        }
      });
    }
    this.flowLayer
      .querySelector<HTMLButtonElement>('.reroll-button')
      ?.addEventListener('click', this.rerollHeroes);
    this.flowLayer
      .querySelector<HTMLButtonElement>('.confirm-hero-button')
      ?.addEventListener('click', this.confirmHero);
    this.flowLayer
      .querySelector<HTMLButtonElement>('.select-cancel-button')
      ?.addEventListener('click', this.cancelMatch);
  }

  private renderLoading(): void {
    const selectedHeroId = this.state.selectedHeroId ?? 'H009';
    const record = HERO_RECORDS.get(selectedHeroId) ?? HERO_RECORDS.get('H009');
    this.flowLayer.hidden = false;
    this.flowLayer.innerHTML = `
      <section class="flow-screen loading-flow-screen" data-screen="loading">
        <article class="loading-card flow-panel">
          <img src="${heroCardUrl(selectedHeroId)}" alt="${escapeHtml(record?.name ?? '所选英雄')}" />
          <div class="loading-copy">
            <p class="flow-eyebrow">席位已锁定</p>
            <h1>${escapeHtml(record?.name ?? selectedHeroId)}</h1>
            <span>专属主动 · ${escapeHtml(record?.active.name ?? '')}</span>
            <div class="flow-progress loading-progress"><i></i></div>
            <b>正在连接权威战斗并加载百眼迷城</b>
          </div>
        </article>
      </section>
    `;
    const screen = this.flowLayer.querySelector<HTMLElement>('.flow-screen');
    if (screen) {
      this.setFlowBackground(screen, 0.42);
    }
  }

  private renderResult(): void {
    const result = this.state.result;
    if (!result) {
      return;
    }
    const record = HERO_RECORDS.get(result.heroId);
    const outcomeTitle =
      result.outcome === 'victory'
        ? '天命所归'
        : result.outcome === 'draw'
          ? '同归于尽'
          : '本局结束';
    const placementCopy = result.placement ? `第 ${result.placement} 名` : '已淘汰';
    this.flowLayer.hidden = false;
    this.flowLayer.innerHTML = `
      <section class="flow-screen result-flow-screen" data-screen="result">
        <article class="result-card flow-panel">
          <div class="result-hero">
            <img src="${heroCardUrl(result.heroId)}" alt="${escapeHtml(record?.name ?? result.heroId)}" />
            <span class="result-hero-shade"></span>
            <div><p class="flow-eyebrow">权威结算</p><h1>${outcomeTitle}</h1><b>${placementCopy}</b></div>
          </div>
          <div class="result-body">
            <div class="result-name">
              <img src="${heroPortraitUrl(result.heroId)}" alt="" />
              <span><b>${escapeHtml(record?.name ?? result.heroId)}</b><small>Lv.${result.level}</small></span>
            </div>
            <div class="result-metrics">
              <span><b>${formatSurvival(result.survivalSeconds)}</b><small>存活时间</small></span>
              <span><b>${result.gold}</b><small>局内金币</small></span>
              <span><b>${result.gems}</b><small>技能宝石</small></span>
              <span><b>${result.buildCount}</b><small>最终构筑</small></span>
            </div>
            <div class="result-actions">
              <button class="flow-secondary-button result-lobby-button" type="button">返回大厅</button>
              <button class="flow-primary-button result-rematch-button" type="button">
                <span class="result-rematch-icon"></span><span>再次匹配</span>
              </button>
            </div>
          </div>
        </article>
      </section>
    `;
    const screen = this.flowLayer.querySelector<HTMLElement>('.flow-screen');
    if (screen) {
      this.setFlowBackground(screen, 0.48);
    }
    this.flowLayer
      .querySelector('.result-rematch-icon')
      ?.append(createElement(RefreshCw, { width: 18, height: 18 }));
    this.flowLayer
      .querySelector<HTMLButtonElement>('.result-lobby-button')
      ?.addEventListener('click', this.returnToLobby);
    this.flowLayer
      .querySelector<HTMLButtonElement>('.result-rematch-button')
      ?.addEventListener('click', this.startMatch);
  }

  private async createGameRuntime(): Promise<void> {
    if (
      this.gameApp ||
      !this.state.selectedHeroId ||
      !this.state.matchTicket ||
      !this.matchmakingPlayerId
    ) {
      return;
    }
    const selectedHeroId = this.state.selectedHeroId;
    const generation = ++this.runtimeLoadGeneration;
    const { GameApp } = await import('./game-app');
    if (
      this.disposed ||
      generation !== this.runtimeLoadGeneration ||
      this.state.screen !== 'loading' ||
      this.state.selectedHeroId !== selectedHeroId ||
      this.gameApp
    ) {
      return;
    }
    this.runtimeCreationCount += 1;
    this.runtimeHeroId = selectedHeroId;
    this.runtimeRoot.setAttribute('aria-hidden', 'false');
    this.gameApp = new GameApp(this.runtimeRoot, {
      mode: 'online',
      heroId: heroId(selectedHeroId),
      playerId: this.matchmakingPlayerId,
      matchTicket: this.state.matchTicket,
      resumeSession: false,
      onReady: this.handleGameReady,
      onResult: this.handleGameResult,
      onRestartRequested: this.restartOnlineMatch,
    });
    this.gameApp.start();
  }

  private destroyGameRuntime(): void {
    this.runtimeLoadGeneration += 1;
    this.gameApp?.dispose();
    this.gameApp = null;
    this.runtimeRoot.replaceChildren();
    this.runtimeRoot.setAttribute('aria-hidden', 'true');
  }

  private ensureFlowServices(): void {
    if (this.flowAudio === null) {
      this.flowAudio = new WebAudioRuntime();
      this.flowAudio.setMix(this.settings);
      this.flowAudio.setScene('lobby');
    }
    if (this.flowMenu === null) {
      this.flowMenu = new GameMenu(this.flowMenuRoot, {
        initialSettings: this.settings,
        onSettingsChange: this.handleSettingsChange,
        onOpenChange: () => {},
        onSound: (cue) => this.flowAudio?.playCue(cue),
      });
    }
  }

  private openFlowMenu(tab: 'settings' | 'guide'): void {
    // The lobby toolbar is rebuilt on every flow transition. Recreate the
    // shared menu on demand so a stale/null service cannot swallow a click.
    this.ensureFlowServices();
    this.flowMenu?.open(tab);
  }

  private disposeFlowServices(): void {
    this.flowMenu?.dispose();
    this.flowMenu = null;
    this.flowMenuRoot.replaceChildren();
    this.flowAudio?.dispose();
    this.flowAudio = null;
  }

  private startServerMatchmaking(): void {
    const playerIdForMatch = this.matchmakingPlayerId;
    if (!playerIdForMatch) {
      return;
    }
    const search = new URLSearchParams(window.location.search);
    const serverUrl = resolveOnlineServerUrl(window.location, search.get('server'));
    this.matchmakingCancelPending = false;
    this.matchmakingClient = new MatchmakingClient({
      url: serverUrl,
      playerId: playerIdForMatch,
      onQueued: this.handleMatchmakingQueued,
      onSelection: this.handleMatchmakingSelection,
      onAssigned: this.handleMatchmakingAssigned,
      onCancelled: this.handleMatchmakingCancelled,
      onError: this.handleMatchmakingError,
    });
    this.matchmakingClient.enqueue();
  }

  private disposeMatchmaking(): void {
    this.matchmakingClient?.dispose();
    this.matchmakingClient = null;
    this.matchmakingCancelPending = false;
    this.selectionSubmitPending = false;
  }

  private readonly handleMatchmakingQueued = (message: MatchmakingQueuedMessage): void => {
    if (this.matchmakingCancelPending || this.state.screen !== 'matching') {
      return;
    }
    this.state = {
      ...this.state,
      queuePosition: message.queuePosition,
      matchmakingError: null,
    };
    this.updateMatchmakingUi();
  };

  private readonly handleMatchmakingSelection = (message: MatchmakingSelectionMessage): void => {
    if (
      this.matchmakingCancelPending ||
      (this.state.screen !== 'matching' && this.state.screen !== 'select')
    ) {
      return;
    }
    const nextState: GameFlowState = {
      ...this.state,
      screen: 'select',
      selectionRemainingMs: message.selectionRemainingMs,
      offers: message.offers.map((value) => value),
      recommendedHeroId: message.recommendedHeroId,
      selectedHeroId: message.selectedHeroId,
      matchGold: message.matchGold,
      rerollCount: message.rerollCount,
      matchId: message.matchId,
      matchmakingError: null,
    };
    this.selectionSubmitPending = false;
    this.transition(nextState);
  };

  private readonly handleMatchmakingAssigned = (message: MatchmakingAssignedMessage): void => {
    if (this.matchmakingCancelPending || !this.matchmakingPlayerId) {
      return;
    }
    const nextState: GameFlowState = {
      ...this.state,
      screen: 'loading',
      selectedHeroId: message.heroId,
      matchId: message.matchId,
      matchTicket: message.matchTicket,
      ticketExpiresAtMs: message.ticketExpiresAtMs,
      selectionRemainingMs: 0,
      matchmakingError: null,
    };
    this.selectionSubmitPending = false;
    this.transition(nextState);
  };

  private readonly handleMatchmakingCancelled = (message: MatchmakingCancelledMessage): void => {
    if (this.state.screen !== 'matching' && this.state.screen !== 'select') {
      return;
    }
    this.disposeMatchmaking();
    this.matchmakingPlayerId = null;
    this.transition({
      ...cancelMatchmaking(this.state),
      matchmakingError: message.reason === 'expired' ? '匹配已过期，请重新开始' : '匹配已取消',
    });
  };

  private readonly handleMatchmakingError = (error: MatchmakingErrorMessage | Error): void => {
    const message = 'code' in error ? `${error.code}: ${error.message}` : error.message;
    if (this.state.screen === 'matching' || this.state.screen === 'select') {
      this.matchmakingCancelPending = false;
      this.state = {
        ...this.state,
        matchmakingError: message,
      };
      this.updateMatchmakingUi();
    }
  };

  private updateMatchmakingUi(): void {
    const status = this.matchmakingCancelPending ? '正在取消匹配...' : this.state.matchmakingError;
    const queueTime = this.flowLayer.querySelector<HTMLElement>('.queue-time');
    if (queueTime) {
      queueTime.textContent = formatClock(this.state.queueElapsedMs);
    }
    const queuePosition = this.flowLayer.querySelector<HTMLElement>('.queue-position');
    if (queuePosition) {
      queuePosition.textContent =
        this.state.queuePosition === null ? '' : `当前队列位：${this.state.queuePosition}`;
    }
    const queueError = this.flowLayer.querySelector<HTMLElement>('.queue-error');
    if (queueError) {
      queueError.textContent = status ?? '';
    }
    const selectionError = this.flowLayer.querySelector<HTMLElement>('.selection-error');
    if (selectionError) {
      selectionError.textContent = status ?? '';
    }
    for (const button of this.flowLayer.querySelectorAll<HTMLButtonElement>(
      '.cancel-match-button, .select-cancel-button',
    )) {
      button.disabled = this.matchmakingCancelPending;
    }
  }

  private readonly handleSettingsChange = (settings: WebGameSettings): void => {
    this.settings = settings;
    saveWebGameSettings(window.localStorage, settings);
    this.flowAudio?.setMix(settings);
  };

  private readonly handleAudioUnlock = (): void => {
    void this.flowAudio?.unlock();
  };

  private readonly startMatch = (): void => {
    const nextState = startMatchmaking(this.state);
    if (nextState === this.state) {
      return;
    }
    this.disposeMatchmaking();
    this.matchmakingPlayerId = playerId(`web-${crypto.randomUUID()}`);
    this.selectionSubmitPending = false;
    this.flowAudio?.playCue('confirm');
    this.transition(nextState);
    this.startServerMatchmaking();
  };

  private readonly cancelMatch = (): void => {
    if (
      (this.state.screen !== 'matching' && this.state.screen !== 'select') ||
      this.matchmakingCancelPending
    ) {
      return;
    }
    this.flowAudio?.playCue('cancel');
    if (!this.matchmakingClient?.cancel()) {
      this.disposeMatchmaking();
      this.matchmakingPlayerId = null;
      this.transition(cancelMatchmaking(this.state));
      return;
    }
    this.matchmakingCancelPending = true;
    this.updateMatchmakingUi();
  };

  private readonly selectHeroById = (selectedHeroId: string): void => {
    const nextState = selectHero(this.state, selectedHeroId);
    if (nextState !== this.state) {
      this.flowAudio?.playCue('confirm');
      this.transition(nextState);
    }
  };

  private readonly rerollHeroes = (): void => {
    if (
      this.state.screen !== 'select' ||
      this.state.matchId === null ||
      this.state.matchGold < 250 ||
      this.matchmakingCancelPending
    ) {
      return;
    }
    this.flowAudio?.playCue('confirm');
    this.matchmakingClient?.reroll(this.state.matchId);
  };

  private readonly confirmHero = (): void => {
    if (
      this.state.screen !== 'select' ||
      this.state.matchId === null ||
      this.state.selectedHeroId === null ||
      this.selectionSubmitPending ||
      this.matchmakingCancelPending
    ) {
      return;
    }
    this.selectionSubmitPending = true;
    this.flowAudio?.playCue('confirm');
    this.matchmakingClient?.select(this.state.matchId, heroId(this.state.selectedHeroId));
  };

  private readonly returnToLobby = (): void => {
    this.disposeMatchmaking();
    this.matchmakingPlayerId = null;
    this.transition(returnToLobby(this.state));
  };

  private readonly restartOnlineMatch = (): void => {
    if (this.state.screen !== 'battle') {
      return;
    }
    this.destroyGameRuntime();
    this.matchmakingPlayerId = null;
    this.transition(returnToLobby(this.state));
    this.startMatch();
  };

  private readonly handleGameReady = (): void => {
    if (this.state.screen === 'loading') {
      this.transition(markBattleReady(this.state));
    }
  };

  private readonly handleGameResult = ({
    snapshot,
    localEntityId,
    player,
  }: GameAppReadyState): void => {
    const placementIndex = snapshot.match.placements.indexOf(localEntityId);
    const placement = placementIndex >= 0 ? placementIndex + 1 : null;
    const outcome: GameFlowResult['outcome'] =
      snapshot.match.winnerEntityId === localEntityId
        ? 'victory'
        : snapshot.match.status === 'finished' && snapshot.match.winnerEntityId === null
          ? 'draw'
          : 'defeat';
    this.transition(
      finishBattle(this.state, {
        outcome,
        placement,
        kills: null,
        damage: null,
        survivalSeconds: Math.floor(snapshot.tick / TICKS_PER_SECOND),
        heroId: player.heroId,
        level: player.level,
        gold: player.gold,
        gems: player.gems,
        buildCount:
          player.passives.length + player.equipment.length + player.inventoryEquipment.length + 1,
      }),
    );
  };

  private readonly frame = (now: number): void => {
    if (this.disposed) {
      return;
    }
    const deltaMs = Math.min(250, Math.max(0, now - this.previousFrameTime));
    this.previousFrameTime = now;
    if (this.state.screen === 'matching') {
      this.state = {
        ...this.state,
        queueElapsedMs: this.state.queueElapsedMs + deltaMs,
      };
      this.updateMatchmakingUi();
    } else if (this.state.screen === 'select') {
      const selectionRemainingMs = Math.max(0, this.state.selectionRemainingMs - deltaMs);
      this.state = { ...this.state, selectionRemainingMs };
      const timer = this.flowLayer.querySelector<HTMLElement>('.selection-timer');
      if (timer) {
        timer.textContent = Math.ceil(selectionRemainingMs / 1_000).toString();
      }
    }
    this.animationFrame = requestAnimationFrame(this.frame);
  };
}
