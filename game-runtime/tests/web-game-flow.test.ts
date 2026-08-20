import {
  advanceHeroSelection,
  advanceMatchmaking,
  cancelMatchmaking,
  completeBoot,
  confirmHeroSelection,
  createInitialGameFlowState,
  finishBattle,
  generateHeroOffers,
  HERO_SELECTION_DURATION_MS,
  markBattleReady,
  recommendedHeroForOffers,
  rerollHeroOffers,
  returnToLobby,
  selectHero,
  shouldCreateGameRuntime,
  startMatchmaking,
} from '../apps/web/src/app/game-flow';

const HERO_IDS = Array.from({ length: 38 }, (_, index) => `H${String(index + 1).padStart(3, '0')}`);

describe('web game flow', () => {
  it('enters the lobby after boot without requesting the battle runtime', () => {
    const state = completeBoot(createInitialGameFlowState());
    expect(state.screen).toBe('lobby');
    expect(shouldCreateGameRuntime(state)).toBe(false);
  });

  it('moves through matching, selection, loading and battle', () => {
    const matching = startMatchmaking(completeBoot(createInitialGameFlowState()));
    const selecting = advanceMatchmaking(matching, 2_000, HERO_IDS);
    expect(selecting.screen).toBe('select');
    expect(selecting.offers).toHaveLength(3);
    expect(new Set(selecting.offers).size).toBe(3);

    const selected = selectHero(selecting, selecting.offers[1] ?? '');
    const loading = confirmHeroSelection(selected);
    expect(loading.screen).toBe('loading');
    expect(loading.selectedHeroId).toBe(selecting.offers[1]);
    expect(shouldCreateGameRuntime(loading)).toBe(true);
    expect(markBattleReady(loading).screen).toBe('battle');
  });

  it('cancels from either queueing or hero selection without keeping stale offers', () => {
    const matching = startMatchmaking(completeBoot(createInitialGameFlowState()));
    expect(cancelMatchmaking(matching).screen).toBe('lobby');

    const selecting = advanceMatchmaking(matching, 2_000, HERO_IDS);
    const cancelled = cancelMatchmaking(selecting);
    expect(cancelled.screen).toBe('lobby');
    expect(cancelled.offers).toEqual([]);
    expect(cancelled.selectedHeroId).toBeNull();
    expect(cancelled.matchId).toBeNull();
    expect(cancelled.matchTicket).toBeNull();
  });

  it('generates stable offers and recommends one of them', () => {
    const first = generateHeroOffers(HERO_IDS, 19);
    const second = generateHeroOffers(HERO_IDS, 19);
    expect(first).toEqual(second);
    expect(first).not.toEqual(generateHeroOffers(HERO_IDS, 20));
    expect(first).toContain(recommendedHeroForOffers(first));
  });

  it('rerolls the whole offer set and charges match gold', () => {
    const selecting = advanceMatchmaking(
      startMatchmaking(completeBoot(createInitialGameFlowState())),
      2_000,
      HERO_IDS,
    );
    const rerolled = rerollHeroOffers(selecting, HERO_IDS);
    expect(rerolled.offers).not.toEqual(selecting.offers);
    expect(rerolled.matchGold).toBe(250);
    expect(rerolled.rerollCount).toBe(1);
  });

  it('auto-selects the recommendation when the countdown expires', () => {
    const selecting = advanceMatchmaking(
      startMatchmaking(completeBoot(createInitialGameFlowState())),
      2_000,
      HERO_IDS,
    );
    const loading = advanceHeroSelection(selecting, HERO_SELECTION_DURATION_MS);
    expect(loading.screen).toBe('loading');
    expect(loading.selectedHeroId).toBe(selecting.recommendedHeroId);
  });

  it('supports results, rematch and lobby return', () => {
    const selecting = advanceMatchmaking(
      startMatchmaking(completeBoot(createInitialGameFlowState())),
      2_000,
      HERO_IDS,
    );
    const battle = markBattleReady(
      confirmHeroSelection(selectHero(selecting, selecting.offers[0] ?? '')),
    );
    const result = finishBattle(battle, {
      outcome: 'victory',
      placement: 1,
      kills: null,
      damage: null,
      survivalSeconds: 420,
      heroId: battle.selectedHeroId ?? 'H009',
      level: 8,
      gold: 640,
      gems: 2,
      buildCount: 5,
    });
    expect(result.screen).toBe('result');
    expect(startMatchmaking(result).screen).toBe('matching');
    expect(returnToLobby(result).screen).toBe('lobby');
  });
});
