import {
  AUTHORITATIVE_EQUIPMENT,
  AUTHORITATIVE_HEROES,
  AUTHORITATIVE_PASSIVES,
} from '@jwgb/content';
import type { PlayerId } from '@jwgb/core';
import { equipmentIconUrl, heroPortraitUrl, passiveIconUrl } from '../runtime/asset-url';
import { CULTIVATION_REALMS, CULTIVATION_TRACK, rewardMark } from './cultivation-track';
import { type MatchRecord, playerTag, summariseHistory } from './lobby-session';

/**
 * 成长 / 个人 / 排行榜 as full screens.
 *
 * The prototype gives each of these its own screen, and its geometry is
 * followed here: a full-width header carrying a back control, centred tabs
 * under it, and a content area inset 5% a side. What is not followed is its
 * palette — this build keeps its dark lacquer panels and rounded corners.
 *
 * Progress is read as zero throughout. The 修为 ladder and its rewards are
 * design content and are shown in full, but where a player sits on that ladder
 * is account state that no service provides yet, so every level renders locked
 * rather than borrowing the prototype's hard-coded level 35.
 */

export type MetaScreenKind = 'growth' | 'profile' | 'ranking';

export interface MetaScreenContext {
  readonly playerId: PlayerId | null;
  readonly history: readonly MatchRecord[];
  readonly backdropUrl: string;
}

const GROWTH_TABS = [
  { id: 'cultivation', label: '修为' },
  { id: 'codex', label: '图鉴' },
] as const;

const RANK_TABS = [
  { id: 'wins', label: '总胜场' },
  { id: 'rate', label: '胜率' },
] as const;

const CODEX_CATEGORIES = [
  { id: 'heroes', label: '英雄' },
  { id: 'passives', label: '被动' },
  { id: 'equipment', label: '装备' },
] as const;

type CodexCategory = (typeof CODEX_CATEGORIES)[number]['id'];

export function renderMetaScreen(
  host: HTMLElement,
  kind: MetaScreenKind,
  context: MetaScreenContext,
  onBack: () => void,
): void {
  host.innerHTML = shellMarkup(kind, context);
  host.querySelector<HTMLButtonElement>('.meta-back')?.addEventListener('click', onBack);

  if (kind === 'growth') {
    bindTabs(host, GROWTH_TABS[0].id, (tab) => {
      const content = host.querySelector<HTMLElement>('.meta-content');
      if (!content) {
        return;
      }
      if (tab === 'codex') {
        renderCodex(content);
      } else {
        content.innerHTML = cultivationMarkup();
      }
    });
  } else if (kind === 'ranking') {
    bindTabs(host, RANK_TABS[0].id, (tab) => {
      const content = host.querySelector<HTMLElement>('.meta-content');
      if (content) {
        content.innerHTML = rankingMarkup(tab);
      }
    });
  }
}

function shellMarkup(kind: MetaScreenKind, context: MetaScreenContext): string {
  const head = {
    growth: { eyebrow: '成长', title: '修为与图鉴', tabs: GROWTH_TABS, note: '' },
    profile: { eyebrow: '个人', title: '身份与最近对局', tabs: null, note: '' },
    ranking: {
      eyebrow: '全球单人竞技',
      title: '排行榜',
      tabs: RANK_TABS,
      note: '尚未接入账号服务',
    },
  }[kind];

  const body =
    kind === 'growth'
      ? cultivationMarkup()
      : kind === 'profile'
        ? profileMarkup(context)
        : rankingMarkup('wins');

  return `
    <section class="meta-screen" style="--meta-backdrop: url('${context.backdropUrl}')">
      <header class="meta-header flow-panel">
        <button class="meta-back" type="button">‹ 大厅</button>
        <div>
          <p class="flow-eyebrow">${escapeHtml(head.eyebrow)}</p>
          <h2>${escapeHtml(head.title)}</h2>
        </div>
        ${head.note ? `<span>${escapeHtml(head.note)}</span>` : ''}
      </header>
      ${
        head.tabs
          ? `<div class="meta-tabs">${head.tabs
              .map(
                (tab, index) =>
                  `<button type="button" data-meta-tab="${tab.id}"${
                    index === 0 ? ' class="is-active"' : ''
                  }>${escapeHtml(tab.label)}</button>`,
              )
              .join('')}</div>`
          : ''
      }
      <div class="meta-content">${body}</div>
    </section>
  `;
}

function bindTabs(host: HTMLElement, initial: string, onSelect: (tab: string) => void): void {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-meta-tab]')];
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const tab = button.dataset.metaTab ?? initial;
      for (const other of buttons) {
        other.classList.toggle('is-active', other === button);
      }
      onSelect(tab);
    });
  }
}

function cultivationMarkup(): string {
  // Level 1 with nothing earned. The prototype ships a populated level 35, but
  // that number belongs to an account service this client cannot reach.
  const current = CULTIVATION_TRACK[0];
  const next = CULTIVATION_TRACK[1];
  const earned = 0;
  const target = next?.required ?? 0;
  const percent = target > 0 ? Math.min(100, (earned / target) * 100) : 0;
  const currentRealm = (current?.realm ?? '').split('·')[0] ?? '';

  return `
    <div class="cultivation-layout">
      <article class="meta-card flow-panel">
        <p class="flow-eyebrow">当前修为 · LV.${current?.level ?? 1}</p>
        <h3 class="cultivation-realm">${escapeHtml(current?.realm ?? '')}</h3>
        <p class="cultivation-count">${earned.toLocaleString()} / ${target.toLocaleString()}</p>
        <div class="cultivation-bar"><i style="width: ${percent}%"></i></div>
        <p class="cultivation-note">
          修为只增不减，单局最多 200。挂机与 BOT 托管时段不获得活跃修为；全部奖励仅改变外观与身份表达。
        </p>
        <div class="realm-chips">
          ${CULTIVATION_REALMS.map(
            (realm) =>
              `<span${realm === currentRealm ? ' class="is-current"' : ''}>${escapeHtml(realm)}</span>`,
          ).join('')}
        </div>
        <p class="cultivation-note">
          进度与领取状态需要账号服务返回。当前未接入，因此保持真实的 0 进度，不预先点亮任何奖励。
        </p>
      </article>
      <article class="meta-card flow-panel">
        <div class="track-head">
          <div>
            <h3>50 级外观轨道</h3>
            <p>全部为纯外观奖励，按等级排列</p>
          </div>
          <span class="track-level">LV.${current?.level ?? 1} / ${CULTIVATION_TRACK.length}</span>
        </div>
        <div class="track-rail">
          ${CULTIVATION_TRACK.map(
            (step) => `
              <div class="track-card">
                <span class="track-mark">${step.level}<em>${escapeHtml(rewardMark(step.reward))}</em></span>
                <b>Lv.${step.level} · ${escapeHtml(step.realm)}</b>
                <small>${escapeHtml(step.reward)}</small>
                <i>累计 ${step.cumulative.toLocaleString()}</i>
              </div>
            `,
          ).join('')}
        </div>
      </article>
    </div>
  `;
}

function renderCodex(content: HTMLElement): void {
  content.innerHTML = `
    <div class="codex-layout">
      <nav class="codex-rail flow-panel" aria-label="图鉴分类">
        ${CODEX_CATEGORIES.map(
          (category, index) =>
            `<button type="button" data-codex="${category.id}"${index === 0 ? ' class="is-active"' : ''}>
              <span>${escapeHtml(category.label)}</span><b>${codexCount(category.id)}</b>
            </button>`,
        ).join('')}
      </nav>
      <div class="codex-grid flow-panel"></div>
    </div>
  `;
  const grid = content.querySelector<HTMLElement>('.codex-grid');
  const buttons = [...content.querySelectorAll<HTMLButtonElement>('[data-codex]')];
  const show = (category: CodexCategory): void => {
    if (grid) {
      grid.innerHTML = codexCards(category);
    }
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const other of buttons) {
        other.classList.toggle('is-active', other === button);
      }
      show(button.dataset.codex as CodexCategory);
    });
  }
  show('heroes');
}

function codexCount(category: CodexCategory): number {
  if (category === 'heroes') {
    return AUTHORITATIVE_HEROES.length;
  }
  if (category === 'passives') {
    return AUTHORITATIVE_PASSIVES.length;
  }
  return AUTHORITATIVE_EQUIPMENT.length;
}

function codexCards(category: CodexCategory): string {
  if (category === 'heroes') {
    return AUTHORITATIVE_HEROES.map((hero) =>
      card(heroPortraitUrl(hero.id), `${hero.id} · ${hero.element}`, hero.name, hero.active.name),
    ).join('');
  }
  if (category === 'passives') {
    return AUTHORITATIVE_PASSIVES.map((passive) =>
      card(passiveIconUrl(passive.id), `${passive.id} · ${passive.category}`, passive.name, ''),
    ).join('');
  }
  return AUTHORITATIVE_EQUIPMENT.map((item) =>
    card(equipmentIconUrl(item.id), `${item.id} · ${item.rarity}`, item.name, item.summary),
  ).join('');
}

function card(icon: string, meta: string, name: string, extra: string): string {
  return `
    <article class="lobby-catalog-item">
      <img src="${icon}" alt="" />
      <span>
        <small>${escapeHtml(meta)}</small>
        <b>${escapeHtml(name)}</b>
        ${extra ? `<em>${escapeHtml(extra)}</em>` : ''}
      </span>
    </article>
  `;
}

function profileMarkup(context: MetaScreenContext): string {
  const summary = summariseHistory(context.history);
  const favourite = summary.favouriteHeroId
    ? (AUTHORITATIVE_HEROES.find((hero) => hero.id === summary.favouriteHeroId)?.name ??
      summary.favouriteHeroId)
    : '暂无';

  return `
    <div class="profile-layout">
      <article class="meta-card flow-panel">
        <p class="flow-eyebrow">身份</p>
        <h3 class="cultivation-realm">无常客</h3>
        <p class="cultivation-count">${escapeHtml(playerTag(context.playerId))}</p>
        <p class="cultivation-note">
          玩家编号由匹配服务下发的真实标识派生，同一浏览器保持不变。境界、等级与胜率属于账号服务，
          当前未接入，因此不在此展示。
        </p>
        <div class="lobby-metric-row">
          <span><b>${summary.matches}</b><small>本机对局</small></span>
          <span><b>${summary.victories}</b><small>获胜</small></span>
          <span><b>${summary.bestPlacement ?? '—'}</b><small>最佳名次</small></span>
          <span><b>${escapeHtml(favourite)}</b><small>常用英雄</small></span>
        </div>
      </article>
      <article class="meta-card flow-panel">
        <p class="flow-eyebrow">最近对局</p>
        <h3 class="track-head">本机记录</h3>
        ${
          context.history.length === 0
            ? `<section class="lobby-unavailable">
                <i aria-hidden="true">录</i>
                <b>还没有已完成的对局</b>
                <p>打完一局后，名次、存活时间与所用英雄会记录在这台设备上。跨设备的战绩需要账号服务。</p>
              </section>`
            : `<div class="match-log">
                ${context.history
                  .slice(0, 20)
                  .map(
                    (record) => `
                      <article>
                        <span>
                          <b>${escapeHtml(heroName(record.heroId))}</b>
                          <small>${formatDate(record.finishedAtMs)} · 存活 ${formatDuration(record.survivalSeconds)}</small>
                        </span>
                        <strong>${record.placement === null ? outcomeLabel(record.outcome) : `#${record.placement}`}</strong>
                      </article>
                    `,
                  )
                  .join('')}
              </div>`
        }
      </article>
    </div>
  `;
}

function rankingMarkup(tab: string): string {
  const label = tab === 'rate' ? '胜率' : '总胜场';
  return `
    <div class="rank-shell">
      <article class="meta-card flow-panel">
        <section class="lobby-unavailable">
          <i aria-hidden="true">榜</i>
          <b>${escapeHtml(label)}榜尚未接入</b>
          <p>
            权威服务器目前只提供对局撮合与战斗结算，没有跨局排名接口。等账号与结算服务上线后，
            这里会显示真实名次，而不是先摆一份占位榜单。
          </p>
        </section>
      </article>
      <article class="meta-card flow-panel">
        <p class="flow-eyebrow">榜单规则</p>
        <p class="cultivation-note">
          排行榜只统计单人竞技的完赛对局。作废局不计入胜负，BOT 托管时段不计入活跃。
        </p>
        <p class="cultivation-note">
          名次快照由服务端定时生成，客户端不参与排序，也不缓存他人成绩。
        </p>
      </article>
    </div>
  `;
}

function heroName(heroId: string): string {
  return AUTHORITATIVE_HEROES.find((hero) => hero.id === heroId)?.name ?? heroId;
}

function outcomeLabel(outcome: MatchRecord['outcome']): string {
  return outcome === 'victory' ? '胜' : outcome === 'draw' ? '平' : '负';
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
