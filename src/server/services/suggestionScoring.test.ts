// Pure unit tests (docs/TESTING.md §1) — no DB, no AI, fixed injectable clock.
import { describe, expect, it } from 'vitest';
import { pickTopSuggestions, scoreCandidate, type SuggestionCandidate } from './suggestionScoring';

const NOW = new Date('2026-07-09T12:00:00Z'); // Amsterdam July -> month 7

function candidate(overrides: Partial<SuggestionCandidate> = {}): SuggestionCandidate {
  return {
    id: 1,
    type: 'vegetarisch',
    rating: 0,
    favorite: false,
    source: 'ai',
    bestMonths: null,
    lastPlannedAt: null,
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('card-source ranks above an equal-rated AI recipe', () => {
    const card = scoreCandidate(candidate({ id: 1, source: 'card', rating: 4 }), NOW);
    const ai = scoreCandidate(candidate({ id: 2, source: 'ai', rating: 4 }), NOW);
    expect(card).not.toBeNull();
    expect(ai).not.toBeNull();
    expect(card!).toBeGreaterThan(ai!);
  });

  it('excludes a recipe planned within the recency window', () => {
    const plannedRecently = candidate({ lastPlannedAt: new Date('2026-07-01T12:00:00Z') }); // 8 days ago
    expect(scoreCandidate(plannedRecently, NOW)).toBeNull();
  });

  it('does not exclude a recipe planned outside the recency window', () => {
    const plannedLongAgo = candidate({ lastPlannedAt: new Date('2026-05-01T12:00:00Z') }); // > 21 days ago
    expect(scoreCandidate(plannedLongAgo, NOW)).not.toBeNull();
  });

  it('boosts a seasonal match for the current (fixed-clock) month', () => {
    const inSeason = scoreCandidate(candidate({ bestMonths: [7, 8] }), NOW);
    const outOfSeason = scoreCandidate(candidate({ bestMonths: [1, 2] }), NOW);
    const noSeasonData = scoreCandidate(candidate({ bestMonths: null }), NOW);
    expect(inSeason!).toBeGreaterThan(outOfSeason!);
    expect(outOfSeason).toBe(noSeasonData);
  });

  it('favorite adds a bonus on top of rating', () => {
    const fav = scoreCandidate(candidate({ rating: 3, favorite: true }), NOW);
    const notFav = scoreCandidate(candidate({ rating: 3, favorite: false }), NOW);
    expect(fav!).toBeGreaterThan(notFav!);
  });
});

describe('pickTopSuggestions', () => {
  it('returns the top 6 by score, highest first', () => {
    const candidates = [
      candidate({ id: 1, rating: 1 }),
      candidate({ id: 2, rating: 5 }),
      candidate({ id: 3, rating: 3 }),
      candidate({ id: 4, rating: 4, type: 'vis' }),
      candidate({ id: 5, rating: 2, type: 'kip' }),
      candidate({ id: 6, rating: 0, type: 'rund' }),
      candidate({ id: 7, rating: 0, type: 'varken' }),
    ];
    // maxPerType disabled here (7, >= candidate count) — isolates plain score-sort +
    // truncate-to-6 behavior from the variety cap, which has its own tests below.
    const picked = pickTopSuggestions(candidates, NOW, { maxPerType: 7 });
    expect(picked).toHaveLength(6);
    expect(picked.map((p) => p.id)).toEqual([2, 4, 3, 5, 1, 6]);
  });

  it('excludes recently-planned candidates from the pick entirely', () => {
    const candidates = [
      candidate({ id: 1, rating: 5, lastPlannedAt: new Date('2026-07-05T12:00:00Z') }), // 4 days ago -> excluded
      candidate({ id: 2, rating: 1 }),
    ];
    const picked = pickTopSuggestions(candidates, NOW);
    expect(picked.map((p) => p.id)).toEqual([2]);
  });

  it('caps at max 2 of the same type in the top 6, filling remaining slots from leftovers', () => {
    const candidates = [
      candidate({ id: 1, type: 'vegetarisch', rating: 5 }),
      candidate({ id: 2, type: 'vegetarisch', rating: 4 }),
      candidate({ id: 3, type: 'vegetarisch', rating: 3 }), // would rank #3 but type cap excludes it from pass 1
      candidate({ id: 4, type: 'vis', rating: 2 }),
      candidate({ id: 5, type: 'kip', rating: 1 }),
    ];
    const picked = pickTopSuggestions(candidates, NOW, { limit: 6, maxPerType: 2 });
    // Only 5 candidates exist total, so all 5 are picked (pass 2 backfills #3's slot),
    // but never more than 2 vegetarisch in a row from pass 1's cap logic.
    expect(picked.map((p) => p.id)).toEqual([1, 2, 4, 5, 3]);
    const vegCountInFirstThree = picked.slice(0, 3).filter((p) => p.type === 'vegetarisch').length;
    expect(vegCountInFirstThree).toBeLessThanOrEqual(2);
  });

  it('strictly enforces the cap when there are enough other-typed candidates to avoid backfill', () => {
    const candidates = [
      candidate({ id: 1, type: 'vegetarisch', rating: 5 }),
      candidate({ id: 2, type: 'vegetarisch', rating: 4 }),
      candidate({ id: 3, type: 'vegetarisch', rating: 3 }),
      candidate({ id: 4, type: 'vis', rating: 2 }),
      candidate({ id: 5, type: 'kip', rating: 1 }),
      candidate({ id: 6, type: 'rund', rating: 1 }),
      candidate({ id: 7, type: 'varken', rating: 1 }),
    ];
    const picked = pickTopSuggestions(candidates, NOW, { limit: 6, maxPerType: 2 });
    expect(picked.filter((p) => p.type === 'vegetarisch')).toHaveLength(2);
    expect(picked.map((p) => p.id)).not.toContain(3);
  });
});
