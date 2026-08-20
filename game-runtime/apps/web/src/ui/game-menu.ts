import { BookOpen, createElement, Gauge, Keyboard, Settings, X } from 'lucide';
import type { RenderPerformanceDiagnostics } from '../render/arena-renderer';
import type { WebAudioCue } from '../runtime/web-audio';
import type {
  WebCameraViewMode,
  WebGameSettings,
  WebGraphicsPreference,
} from '../runtime/web-settings';

type GameMenuTab = 'settings' | 'controls' | 'guide';
type AudioSettingKey = 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'uiVolume';

export interface GameMenuDiagnostics {
  readonly open: boolean;
  readonly activeTab: GameMenuTab;
  readonly graphicsPreference: WebGraphicsPreference;
  readonly cameraView: WebCameraViewMode;
  readonly showPerformance: boolean;
  readonly masterVolume: number;
  readonly musicVolume: number;
  readonly sfxVolume: number;
  readonly uiVolume: number;
}

interface GameMenuOptions {
  readonly initialSettings: WebGameSettings;
  readonly onSettingsChange: (settings: WebGameSettings) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSound?: (cue: WebAudioCue) => void;
}

function requiredElement<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing game menu element: ${selector}`);
  }
  return element;
}

const TAB_LABELS: Readonly<Record<GameMenuTab, string>> = {
  settings: '设置',
  controls: '操作',
  guide: '玩法',
};

const CAMERA_LABELS: Readonly<Record<WebCameraViewMode, string>> = {
  standard: '标准',
  close: '近景',
  tactical: '战术',
};

export class GameMenu {
  private readonly overlay: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly performanceMeter: HTMLElement;
  private readonly performanceText: HTMLElement;
  private settings: WebGameSettings;
  private activeTab: GameMenuTab = 'settings';
  private lastPerformanceUpdate = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: GameMenuOptions,
  ) {
    this.settings = options.initialSettings;
    this.root.innerHTML = `
      <button
        class="game-menu-button"
        type="button"
        aria-label="打开游戏菜单"
        title="游戏菜单"
      >
        <span class="game-menu-button-icon"></span>
      </button>
      <div class="performance-meter" hidden>
        <span class="performance-meter-icon"></span>
        <span class="performance-meter-text"></span>
      </div>
      <div class="game-menu-overlay" hidden>
        <section
          class="game-menu-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-menu-title"
        >
          <header class="game-menu-header">
            <div>
              <h2 id="game-menu-title">三命无常</h2>
              <p class="game-menu-section-name">设置</p>
            </div>
            <button class="game-menu-close" type="button" aria-label="关闭游戏菜单" title="关闭">
              <span class="game-menu-close-icon"></span>
            </button>
          </header>
          <nav class="game-menu-tabs" aria-label="游戏菜单">
            <button type="button" data-menu-tab="settings" aria-selected="true">
              <span class="menu-tab-settings-icon"></span><span>设置</span>
            </button>
            <button type="button" data-menu-tab="controls" aria-selected="false">
              <span class="menu-tab-controls-icon"></span><span>操作</span>
            </button>
            <button type="button" data-menu-tab="guide" aria-selected="false">
              <span class="menu-tab-guide-icon"></span><span>玩法</span>
            </button>
          </nav>
          <div class="game-menu-content">
            <section class="game-menu-panel" data-menu-panel="settings">
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>画质策略</strong>
                  <span>自动模式会在帧时持续偏高时关闭阴影并降低像素比。</span>
                </div>
                <div class="segmented-control" aria-label="画质策略">
                  <button type="button" data-graphics="auto">自动</button>
                  <button type="button" data-graphics="quality">画质</button>
                  <button type="button" data-graphics="performance">性能</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>镜头距离</strong>
                  <span>只改变显示构图，不扩大索敌、小地图或战斗视野。</span>
                </div>
                <div class="segmented-control" aria-label="镜头距离">
                  <button type="button" data-camera="standard">标准</button>
                  <button type="button" data-camera="close">近景</button>
                  <button type="button" data-camera="tactical">战术</button>
                </div>
              </div>
              <label class="setting-row setting-toggle">
                <span class="setting-copy">
                  <strong>性能数据显示</strong>
                  <span>显示实时 FPS、P95 帧时间和当前渲染档。</span>
                </span>
                <input class="performance-toggle" type="checkbox" />
              </label>
              <div class="audio-settings" aria-label="音量设置">
                <div class="audio-setting">
                  <label class="audio-setting-label" for="master-volume">
                    <strong>总音量</strong>
                    <output data-audio-value="masterVolume">80%</output>
                  </label>
                  <input
                    id="master-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    data-audio="masterVolume"
                    aria-label="总音量"
                  />
                </div>
                <div class="audio-setting">
                  <label class="audio-setting-label" for="music-volume">
                    <strong>音乐与环境</strong>
                    <output data-audio-value="musicVolume">60%</output>
                  </label>
                  <input
                    id="music-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    data-audio="musicVolume"
                    aria-label="音乐与环境音量"
                  />
                </div>
                <div class="audio-setting">
                  <label class="audio-setting-label" for="sfx-volume">
                    <strong>战斗反馈</strong>
                    <output data-audio-value="sfxVolume">80%</output>
                  </label>
                  <input
                    id="sfx-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    data-audio="sfxVolume"
                    aria-label="战斗反馈音量"
                  />
                </div>
                <div class="audio-setting">
                  <label class="audio-setting-label" for="ui-volume">
                    <strong>界面音效</strong>
                    <output data-audio-value="uiVolume">70%</output>
                  </label>
                  <input
                    id="ui-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    data-audio="uiVolume"
                    aria-label="界面音效音量"
                  />
                </div>
              </div>
              <div class="settings-runtime-status" aria-live="polite">
                当前渲染状态将在游戏运行后显示。
              </div>
            </section>
            <section class="game-menu-panel" data-menu-panel="controls" hidden>
              <div class="control-layout">
                <section class="control-group">
                  <h3>键鼠战斗</h3>
                  <dl class="control-list">
                    <div><dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>移动</dd></div>
                    <div><dt><kbd>鼠标左键</kbd></dt><dd>普攻，按住连续攻击</dd></div>
                    <div><dt><kbd>鼠标右键短按</kbd></dt><dd>释放当前主动技能</dd></div>
                    <div><dt><kbd>E</kbd></dt><dd>拾取或执行情境交互</dd></div>
                    <div><dt><kbd>Esc</kbd></dt><dd>取消或关闭当前界面</dd></div>
                  </dl>
                </section>
                <section class="control-group">
                  <h3>镜头</h3>
                  <dl class="control-list">
                    <div><dt><kbd>右键拖动</kbd></dt><dd>环绕旋转并调整俯仰</dd></div>
                    <div><dt><kbd>中键拖动</kbd></dt><dd>平移镜头；短按重新锁定角色</dd></div>
                    <div><dt><kbd>滚轮</kbd></dt><dd>连续拉近或拉远</dd></div>
                    <div><dt><kbd>Shift</kbd><kbd>滚轮</kbd></dt><dd>单独调整镜头俯仰</dd></div>
                    <div><dt><kbd>Alt</kbd><kbd>左键拖动</kbd></dt><dd>备用环绕操作</dd></div>
                    <div><dt><kbd>V</kbd><kbd>Shift+V</kbd></dt><dd>正向或反向切换视角</dd></div>
                    <div><dt><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></dt><dd>近景、标准、战术视角</dd></div>
                    <div><dt><kbd>Z</kbd><kbd>C</kbd></dt><dd>键盘向左或向右旋转</dd></div>
                    <div><dt><kbd>I</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd></dt><dd>键盘平移镜头</dd></div>
                    <div><dt><kbd>+</kbd><kbd>-</kbd></dt><dd>键盘拉近或拉远</dd></div>
                    <div><dt><kbd>F</kbd><kbd>Home</kbd></dt><dd>复位并回到本地角色</dd></div>
                  </dl>
                </section>
                <section class="control-group">
                  <h3>触控</h3>
                  <dl class="control-list">
                    <div><dt>左摇杆</dt><dd>移动并更新瞄准方向</dd></div>
                    <div><dt>剑</dt><dd>普攻，按住连续攻击</dd></div>
                    <div><dt>闪电</dt><dd>释放当前主动技能</dd></div>
                    <div><dt>手掌</dt><dd>拾取、商店或开启空投</dd></div>
                  </dl>
                </section>
              </div>
              <p class="compatibility-note">
                兼容键：方向键移动，空格普攻。核心战斗参数与触控端一致。
              </p>
            </section>
            <section class="game-menu-panel" data-menu-panel="guide" hidden>
              <div class="guide-intro">
                <strong>30 人单人乱斗，保住三条命，成为最后未淘汰者。</strong>
                <span>移动、普攻、一个主动技能和情境交互构成全部核心操作。</span>
              </div>
              <ol class="match-timeline">
                <li><time>0:00-5:00</time><span>全图发育，刷怪、争商店和技能书。</span></li>
                <li><time>5:00-12:00</time><span>天劫收缩，龙王、首领和空投制造冲突。</span></li>
                <li><time>12:00</time><span>公布三个万劫庭之一作为决赛庭。</span></li>
                <li><time>18:00-20:00</time><span>安全区收至庭内并最终归零。</span></li>
                <li><time>20:00+</time><span>灭世雷暴每秒增强，直到决出结果。</span></li>
              </ol>
              <div class="guide-rules">
                <section>
                  <h3>三条命</h3>
                  <p>真死后消耗一条命并满生命复活；第三次真死后正式淘汰。</p>
                </section>
                <section>
                  <h3>公开资源</h3>
                  <p>怪物、商店、技能书、装备、空投和 BOSS 掉落均可被其他玩家争夺。</p>
                </section>
                <section>
                  <h3>五行与构筑</h3>
                  <p>克制伤害、英雄主动、被动、装备和路线共同决定战斗结果。</p>
                </section>
                <section>
                  <h3>公平规则</h3>
                  <p>服务端权威结算；宽屏和镜头距离不会增加索敌、小地图或锁定范围。</p>
                </section>
              </div>
            </section>
          </div>
        </section>
      </div>
    `;

    this.overlay = requiredElement(this.root, '.game-menu-overlay');
    this.trigger = requiredElement(this.root, '.game-menu-button');
    this.closeButton = requiredElement(this.root, '.game-menu-close');
    this.performanceMeter = requiredElement(this.root, '.performance-meter');
    this.performanceText = requiredElement(this.root, '.performance-meter-text');

    requiredElement(this.root, '.game-menu-button-icon').append(
      createElement(Settings, { width: 19, height: 19 }),
    );
    requiredElement(this.root, '.game-menu-close-icon').append(
      createElement(X, { width: 21, height: 21 }),
    );
    requiredElement(this.root, '.menu-tab-settings-icon').append(
      createElement(Settings, { width: 17, height: 17 }),
    );
    requiredElement(this.root, '.menu-tab-controls-icon').append(
      createElement(Keyboard, { width: 18, height: 18 }),
    );
    requiredElement(this.root, '.menu-tab-guide-icon').append(
      createElement(BookOpen, { width: 17, height: 17 }),
    );
    requiredElement(this.root, '.performance-meter-icon').append(
      createElement(Gauge, { width: 15, height: 15 }),
    );

    this.trigger.addEventListener('click', () => {
      this.options.onSound?.('confirm');
      this.open('settings');
    });
    this.closeButton.addEventListener('click', () => {
      this.options.onSound?.('cancel');
      this.close();
    });
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.options.onSound?.('cancel');
        this.close();
      }
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-menu-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        this.options.onSound?.('confirm');
        this.setActiveTab(button.dataset.menuTab as GameMenuTab);
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-graphics]').forEach((button) => {
      button.addEventListener('click', () => {
        this.patchSettings({
          graphicsPreference: button.dataset.graphics as WebGraphicsPreference,
        });
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((button) => {
      button.addEventListener('click', () => {
        this.patchSettings({ cameraView: button.dataset.camera as WebCameraViewMode });
      });
    });
    requiredElement<HTMLInputElement>(this.root, '.performance-toggle').addEventListener(
      'change',
      (event) => {
        this.patchSettings({
          showPerformance: (event.currentTarget as HTMLInputElement).checked,
        });
      },
    );
    this.root.querySelectorAll<HTMLInputElement>('[data-audio]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.audio as AudioSettingKey;
        this.patchSettings({ [key]: Number(input.value) } as Partial<WebGameSettings>, false);
      });
    });
    this.syncSettings();
  }

  open(tab: GameMenuTab = this.activeTab): void {
    this.setActiveTab(tab);
    if (!this.overlay.hidden) {
      return;
    }
    this.trigger.hidden = true;
    this.performanceMeter.hidden = true;
    this.overlay.hidden = false;
    this.options.onOpenChange(true);
    this.closeButton.focus({ preventScroll: true });
  }

  close(): void {
    if (this.overlay.hidden) {
      return;
    }
    this.overlay.hidden = true;
    this.trigger.hidden = false;
    this.performanceMeter.hidden = !this.settings.showPerformance;
    this.options.onOpenChange(false);
    this.trigger.focus({ preventScroll: true });
  }

  isOpen(): boolean {
    return !this.overlay.hidden;
  }

  setCameraView(cameraView: WebCameraViewMode): void {
    if (this.settings.cameraView === cameraView) {
      return;
    }
    this.settings = { ...this.settings, cameraView };
    this.syncSettings();
  }

  shouldSamplePerformance(nowMs: number): boolean {
    return (
      this.settings.showPerformance && !this.isOpen() && nowMs - this.lastPerformanceUpdate >= 400
    );
  }

  updatePerformance(diagnostics: RenderPerformanceDiagnostics, nowMs: number): void {
    if (this.isOpen() || !this.settings.showPerformance) {
      this.performanceMeter.hidden = true;
      return;
    }
    this.performanceMeter.hidden = false;
    this.lastPerformanceUpdate = nowMs;
    const tier = diagnostics.graphicsTier === 'balanced' ? '均衡' : '性能';
    this.performanceText.textContent =
      `${diagnostics.averageFps.toFixed(0)} FPS · ` +
      `P95 ${diagnostics.p95FrameMs.toFixed(1)} ms · ${tier}`;
    requiredElement(this.root, '.settings-runtime-status').textContent =
      `当前 ${tier}档，像素比 ${diagnostics.pixelRatio.toFixed(2)}，` +
      `${diagnostics.drawCalls} draw calls，` +
      `${diagnostics.shadowsEnabled ? '阴影开启' : '阴影关闭'}。`;
  }

  getDiagnostics(): GameMenuDiagnostics {
    return {
      open: this.isOpen(),
      activeTab: this.activeTab,
      graphicsPreference: this.settings.graphicsPreference,
      cameraView: this.settings.cameraView,
      showPerformance: this.settings.showPerformance,
      masterVolume: this.settings.masterVolume,
      musicVolume: this.settings.musicVolume,
      sfxVolume: this.settings.sfxVolume,
      uiVolume: this.settings.uiVolume,
    };
  }

  dispose(): void {
    this.root.replaceChildren();
  }

  private patchSettings(patch: Partial<WebGameSettings>, playSound = true): void {
    this.settings = { ...this.settings, ...patch };
    this.syncSettings();
    this.options.onSettingsChange(this.settings);
    if (playSound) {
      this.options.onSound?.('confirm');
    }
  }

  private syncSettings(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-graphics]').forEach((button) => {
      const selected = button.dataset.graphics === this.settings.graphicsPreference;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((button) => {
      const selected = button.dataset.camera === this.settings.cameraView;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      if (selected) {
        button.title = `当前${CAMERA_LABELS[this.settings.cameraView]}视角`;
      } else {
        button.removeAttribute('title');
      }
    });
    requiredElement<HTMLInputElement>(this.root, '.performance-toggle').checked =
      this.settings.showPerformance;
    const audioValues: Readonly<Record<AudioSettingKey, number>> = {
      masterVolume: this.settings.masterVolume,
      musicVolume: this.settings.musicVolume,
      sfxVolume: this.settings.sfxVolume,
      uiVolume: this.settings.uiVolume,
    };
    this.root.querySelectorAll<HTMLInputElement>('[data-audio]').forEach((input) => {
      const key = input.dataset.audio as AudioSettingKey;
      const value = audioValues[key];
      input.value = String(value);
      const output = this.root.querySelector<HTMLOutputElement>(`[data-audio-value="${key}"]`);
      if (output) {
        output.value = `${Math.round(value * 100)}%`;
        output.textContent = output.value;
      }
    });
    this.performanceMeter.hidden = !this.settings.showPerformance;
  }

  private setActiveTab(tab: GameMenuTab): void {
    this.activeTab = tab;
    requiredElement(this.root, '.game-menu-section-name').textContent = TAB_LABELS[tab];
    this.root.querySelectorAll<HTMLButtonElement>('[data-menu-tab]').forEach((button) => {
      const selected = button.dataset.menuTab === tab;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    this.root.querySelectorAll<HTMLElement>('[data-menu-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.menuPanel !== tab;
    });
  }
}
