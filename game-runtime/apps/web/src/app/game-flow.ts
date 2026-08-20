export type GameFlowScreen =
  | 'boot'
  | 'lobby'
  | 'matching'
  | 'select'
  | 'loading'
  | 'battle'
  | 'result';

export interface GameFlowResult {
  readonly outcome: 'victory' | 'defeat' | 'draw';
  readonly placement: number | null;
  readonly kills: number | null;
  readonly damage: number | null;
  readonly survivalSeconds: number;
  readonly heroId: string;
  readonly level: number;
  readonly gold: number;
  readonly gems: number;
  readonly buildCount: number;
}

export interface GameFlowState {
  readonly screen: GameFlowScreen;
  readonly queueElapsedMs: number;
  readonly queuePosition: number | null;
  readonly selectionRemainingMs: number;
  readonly offerSeed: number;
  readonly offers: readonly string[];
  readonly recommendedHeroId: string | null;
  readonly selectedHeroId: string | null;
  readonly matchGold: number;
  readonly rerollCount: number;
  readonly matchId: string | null;
  readonly matchTicket: string | null;
  readonly ticketExpiresAtMs: number | null;
  readonly matchmakingError: string | null;
  readonly result: GameFlowResult | null;
}

export const MATCHMAKING_DURATION_MS = 1_400;
export const HERO_SELECTION_DURATION_MS = 15_000;
export const HERO_REROLL_COST = 250;
export const INITIAL_MATCH_GOLD = 500;

export function createInitialGameFlowState(): GameFlowState {
  return {
    screen: 'boot',
    queueElapsedMs: 0,
    queuePosition: null,
    selectionRemainingMs: HERO_SELECTION_DURATION_MS,
    offerSeed: 1,
    offers: [],
    recommendedHeroId: null,
    selectedHeroId: null,
    matchGold: INITIAL_MATCH_GOLD,
    rerollCount: 0,
    matchId: null,
    matchTicket: null,
    ticketExpiresAtMs: null,
    matchmakingError: null,
    result: null,
  };
}

function hashOfferKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function offerScore(heroId: string, seed: number): number {
  let value = hashOfferKey(heroId) ^ Math.imul(seed + 1, 0x9e3779b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function generateHeroOffers(
  heroIds: readonly string[],
  seed: number,
  count = 3,
): readonly string[] {
  if (count <= 0 || heroIds.length === 0) {
    return [];
  }
  return [...new Set(heroIds)]
    .sort((left, right) => {
      const difference = offerScore(left, seed) - offerScore(right, seed);
      return difference || left.localeCompare(right);
    })
    .slice(0, count);
}

export function recommendedHeroForOffers(offers: readonly string[]): string | null {
  if (offers.length === 0) {
    return null;
  }
  return (
    [...offers].sort((left, right) => {
      const difference = hashOfferKey(`recommended:${right}`) - hashOfferKey(`recommended:${left}`);
      return difference || left.localeCompare(right);
    })[0] ?? null
  );
}

export function completeBoot(state: GameFlowState): GameFlowState {
  return state.screen === 'boot' ? { ...state, screen: 'lobby' } : state;
}

export function startMatchmaking(state: GameFlowState): GameFlowState {
  if (state.screen !== 'lobby' && state.screen !== 'result') {
    return state;
  }
  return {
    ...state,
    screen: 'matching',
    queueElapsedMs: 0,
    queuePosition: null,
    selectionRemainingMs: HERO_SELECTION_DURATION_MS,
    offers: [],
    recommendedHeroId: null,
    selectedHeroId: null,
    matchGold: INITIAL_MATCH_GOLD,
    rerollCount: 0,
    matchId: null,
    matchTicket: null,
    ticketExpiresAtMs: null,
    matchmakingError: null,
    result: null,
  };
}

export function cancelMatchmaking(state: GameFlowState): GameFlowState {
  if (state.screen !== 'matching' && state.screen !== 'select') {
    return state;
  }
  return {
    ...state,
    screen: 'lobby',
    queueElapsedMs: 0,
    queuePosition: null,
    selectionRemainingMs: HERO_SELECTION_DURATION_MS,
    offers: [],
    recommendedHeroId: null,
    selectedHeroId: null,
    matchGold: INITIAL_MATCH_GOLD,
    rerollCount: 0,
    matchId: null,
    matchTicket: null,
    ticketExpiresAtMs: null,
    matchmakingError: null,
  };
}

export function advanceMatchmaking(
  state: GameFlowState,
  deltaMs: number,
  heroIds: readonly string[],
): GameFlowState {
  if (state.screen !== 'matching') {
    return state;
  }
  const queueElapsedMs = state.queueElapsedMs + Math.max(0, deltaMs);
  if (queueElapsedMs < MATCHMAKING_DURATION_MS) {
    return { ...state, queueElapsedMs };
  }
  const offers = generateHeroOffers(heroIds, state.offerSeed);
  return {
    ...state,
    screen: 'select',
    queueElapsedMs,
    queuePosition: null,
    selectionRemainingMs: HERO_SELECTION_DURATION_MS,
    offers,
    recommendedHeroId: recommendedHeroForOffers(offers),
    selectedHeroId: null,
    matchmakingError: null,
  };
}

export function selectHero(state: GameFlowState, selectedHeroId: string): GameFlowState {
  if (state.screen !== 'select' || !state.offers.includes(selectedHeroId)) {
    return state;
  }
  return { ...state, selectedHeroId };
}

export function rerollHeroOffers(state: GameFlowState, heroIds: readonly string[]): GameFlowState {
  if (state.screen !== 'select' || state.matchGold < HERO_REROLL_COST) {
    return state;
  }
  const offerSeed = state.offerSeed + 1;
  const offers = generateHeroOffers(heroIds, offerSeed);
  return {
    ...state,
    offerSeed,
    offers,
    recommendedHeroId: recommendedHeroForOffers(offers),
    selectedHeroId: null,
    matchGold: state.matchGold - HERO_REROLL_COST,
    rerollCount: state.rerollCount + 1,
    selectionRemainingMs: HERO_SELECTION_DURATION_MS,
    matchmakingError: null,
  };
}

export function confirmHeroSelection(state: GameFlowState): GameFlowState {
  if (state.screen !== 'select' || state.selectedHeroId === null) {
    return state;
  }
  return { ...state, screen: 'loading', matchmakingError: null };
}

export function advanceHeroSelection(state: GameFlowState, deltaMs: number): GameFlowState {
  if (state.screen !== 'select') {
    return state;
  }
  const selectionRemainingMs = Math.max(0, state.selectionRemainingMs - Math.max(0, deltaMs));
  if (selectionRemainingMs > 0) {
    return { ...state, selectionRemainingMs };
  }
  const selectedHeroId = state.selectedHeroId ?? state.recommendedHeroId ?? state.offers[0] ?? null;
  return selectedHeroId
    ? { ...state, screen: 'loading', selectionRemainingMs: 0, selectedHeroId }
    : { ...state, selectionRemainingMs: 0 };
}

export function markBattleReady(state: GameFlowState): GameFlowState {
  return state.screen === 'loading' ? { ...state, screen: 'battle' } : state;
}

export function finishBattle(state: GameFlowState, result: GameFlowResult): GameFlowState {
  return state.screen === 'battle' || state.screen === 'loading'
    ? { ...state, screen: 'result', result }
    : state;
}

export function returnToLobby(state: GameFlowState): GameFlowState {
  return {
    ...createInitialGameFlowState(),
    screen: 'lobby',
    offerSeed: state.offerSeed + 1,
  };
}

export function shouldCreateGameRuntime(state: GameFlowState): boolean {
  return state.screen === 'loading' || state.screen === 'battle';
}
