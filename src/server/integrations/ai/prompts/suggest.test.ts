import { describe, expect, it } from 'vitest';
import { buildSeasonBatchPrompt, buildSuggestRankPrompt } from './suggest';

describe('buildSuggestRankPrompt (docs/PROMPTS.md §6)', () => {
  it('lists candidates with a 1-based volgnummer and instructs ≤90-char Dutch teasers', () => {
    const { system, prompt } = buildSuggestRankPrompt([
      { title: 'Orzosalade', type: 'vegetarisch', rating: 5, timeMin: 25 },
      { title: 'Kipsaté', type: 'kip', rating: 4, timeMin: 40 },
    ]);

    expect(system).toContain('Nederlandse');
    expect(system).toContain('index');
    expect(system).toContain('90');

    expect(prompt).toContain('#1 · Orzosalade · vegetarisch · ★5 · 25 min');
    expect(prompt).toContain('#2 · Kipsaté · kip · ★4 · 40 min');
  });
});

describe('buildSeasonBatchPrompt (docs/workpackages/WP-13 §2)', () => {
  it('lists candidates with a 1-based volgnummer and asks for month numbers', () => {
    const { system, prompt } = buildSeasonBatchPrompt([
      { title: 'Winterstoof', type: 'rund', description: 'Stevige stoofpot.' },
      { title: 'Zomersalade', type: 'vegetarisch', description: '' },
    ]);

    expect(system).toContain('bestMonths');
    expect(system).toContain('1 = januari');
    expect(system).toContain('index');

    expect(prompt).toContain('#1 · Winterstoof · rund · Stevige stoofpot.');
    expect(prompt).toContain('#2 · Zomersalade · vegetarisch');
  });
});
