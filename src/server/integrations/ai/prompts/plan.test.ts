// Prompt builder snapshot tests (docs/TESTING.md §3: "prompt builders: snapshot tests
// so prompt changes are visible in diffs"; docs/workpackages/WP-06-planner-v2.md §Tests:
// "season string, promotions block with discount, recently-planned exclusions,
// proteinSplit on/off").
import { describe, expect, it } from 'vitest';
import {
  amsterdamDateKey,
  buildPlanPrompt,
  buildReplacePrompt,
  deriveDateAndSeason,
  formatEuroCents,
  type BuildPlanPromptInput,
} from './plan';

const BASE_INPUT: BuildPlanPromptInput = {
  now: new Date('2026-07-09T10:00:00+02:00'), // summer, Europe/Amsterdam
  mealCount: 2,
  servings: 4,
  recipeTypes: ['vegetarisch', 'vis', 'kip'],
  mealStyles: ['makkelijk', 'gezin'],
  allergies: 'geen noten',
  libraryIndex: [
    { number: 1, title: 'Orzosalade met feta', type: 'vegetarisch', rating: 4, lastPlannedDaysAgo: 14 },
    { number: 2, title: 'Kipsaté met rijst', type: 'kip', rating: 5, lastPlannedDaysAgo: null },
  ],
  recentlyPlanned: [{ title: 'Vegan chili sin carne', daysAgo: 5 }],
  repeatWindowDays: 21,
  promotions: [
    { id: 'p1', name: 'Kipfilet 500g', priceCents: 599, promoPriceCents: 399, promoLabel: '2 voor 6' },
    { id: 'p2', name: 'Broccoli', priceCents: 129 },
  ],
  targetCostPerServingCents: 350,
  pantryList: ['Olijfolie', 'Zout', 'Zwarte peper'],
  useUpProducts: 'Restje kokosmelk uit de koelkast',
  proteinSplit: null,
  preferences: 'Graag iets met pasta',
};

describe('deriveDateAndSeason', () => {
  it('derives the Dutch weekday/date label and season for a summer date', () => {
    const result = deriveDateAndSeason(new Date('2026-07-09T10:00:00+02:00'));
    expect(result.season).toBe('zomer');
    expect(result.dateLabel).toContain('juli');
    expect(result.dateLabel).toContain('2026');
  });

  it.each([
    ['2026-01-15T10:00:00+01:00', 'winter'],
    ['2026-03-21T10:00:00+01:00', 'lente'],
    ['2026-07-09T10:00:00+02:00', 'zomer'],
    ['2026-10-15T10:00:00+02:00', 'herfst'],
    ['2026-12-24T10:00:00+01:00', 'winter'],
  ])('maps %s to season %s', (iso, expectedSeason) => {
    expect(deriveDateAndSeason(new Date(iso)).season).toBe(expectedSeason);
  });

  it('uses the Europe/Amsterdam wall-clock date, not UTC (near-midnight boundary)', () => {
    // 23:30 UTC on Feb 28 is already March 1st, 00:30 in Amsterdam (CET, UTC+1) — spring,
    // even though the UTC calendar date is still in February (winter).
    const result = deriveDateAndSeason(new Date('2026-02-28T23:30:00Z'));
    expect(result.season).toBe('lente');
  });
});

describe('amsterdamDateKey', () => {
  it('formats as YYYY-MM-DD in the Amsterdam timezone', () => {
    expect(amsterdamDateKey(new Date('2026-07-09T10:00:00+02:00'))).toBe('2026-07-09');
  });
});

describe('formatEuroCents', () => {
  it('formats cents as Dutch-formatted euros', () => {
    expect(formatEuroCents(350)).toBe('€ 3,50');
    expect(formatEuroCents(599)).toBe('€ 5,99');
    expect(formatEuroCents(0)).toBe('€ 0,00');
  });
});

describe('buildPlanPrompt', () => {
  it('matches the full system+user prompt snapshot', () => {
    const result = buildPlanPrompt(BASE_INPUT);
    expect(result).toMatchSnapshot();
  });

  it('includes the season string in the SEIZOEN & DATUM section', () => {
    const result = buildPlanPrompt(BASE_INPUT);
    expect(result.system).toContain('Vandaag is');
    expect(result.system).toContain('(zomer)');
  });

  it('renders promotions with discount depth (regular price, promo price, promo label)', () => {
    const result = buildPlanPrompt(BASE_INPUT);
    expect(result.system).toContain('Kipfilet 500g · € 5,99 · € 3,99 · 2 voor 6');
    expect(result.system).toContain('Broccoli · € 1,29 · — · —');
  });

  it('renders "Geen aanbiedingen beschikbaar." when there are no promotions', () => {
    const result = buildPlanPrompt({ ...BASE_INPUT, promotions: [] });
    expect(result.system).toContain('Geen aanbiedingen beschikbaar.');
  });

  it('lists recently-planned dishes with their days-ago so the model excludes them', () => {
    const result = buildPlanPrompt(BASE_INPUT);
    expect(result.system).toContain('Vegan chili sin carne (5 dgn geleden)');
  });

  it('renders "geen" for recently-planned when the window is empty', () => {
    const result = buildPlanPrompt({ ...BASE_INPUT, recentlyPlanned: [] });
    expect(result.system).toMatch(/gepland was: geen\./);
  });

  it('omits the PROTEIN_SPLIT_BLOCK when proteinSplit is null', () => {
    const result = buildPlanPrompt({ ...BASE_INPUT, proteinSplit: null });
    expect(result.system).not.toContain('GESPLITSTE EIWITTEN');
  });

  it('includes the PROTEIN_SPLIT_BLOCK with meat/vega counts when proteinSplit is set', () => {
    const result = buildPlanPrompt({ ...BASE_INPUT, proteinSplit: { meatServings: 3, vegaServings: 1 } });
    expect(result.system).toContain('GESPLITSTE EIWITTEN');
    expect(result.system).toContain('3 porties');
    expect(result.system).toContain('1 porties');
  });

  it('falls back to the default "verras ons" user message when no preferences are given', () => {
    const result = buildPlanPrompt({ ...BASE_INPUT, preferences: undefined });
    expect(result.prompt).toBe('Verras ons met een gevarieerde week.');
  });

  it('renders the user preferences message verbatim when given', () => {
    const result = buildPlanPrompt(BASE_INPUT);
    expect(result.prompt).toBe('Wensen van het gezin deze week: Graag iets met pasta');
  });
});

describe('buildReplacePrompt', () => {
  const replaceInput = {
    ...BASE_INPUT,
    oldTitle: 'Kip tikka masala',
    otherMeals: [
      { title: 'Orzosalade met feta', type: 'vegetarisch' as const, keyIngredients: ['Feta', 'Orzo', 'Cherrytomaatjes'] },
    ],
    avoidTitles: ['Orzosalade met feta'],
  };

  it('matches the full system+user prompt snapshot', () => {
    expect(buildReplacePrompt(replaceInput)).toMatchSnapshot();
  });

  it('reuses the same static/dynamic system sections as buildPlanPrompt', () => {
    const result = buildReplacePrompt(replaceInput);
    expect(result.system).toContain('SEIZOEN & DATUM');
    expect(result.system).toContain('BIBLIOTHEEK EERST');
    expect(result.system).toContain('ECONOMISCH KOKEN');
  });

  it('appends a VERVANGING block naming the old title and preserving the other meals', () => {
    const result = buildReplacePrompt(replaceInput);
    expect(result.system).toContain('VERVANGING');
    expect(result.system).toContain('Vervang alleen "Kip tikka masala"');
    expect(result.system).toContain('Orzosalade met feta (vegetarisch) — kerningrediënten: Feta, Orzo, Cherrytomaatjes');
    expect(result.system).toContain('Vermijd: Orzosalade met feta');
  });
});
