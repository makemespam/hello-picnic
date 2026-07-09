import { describe, expect, it } from 'vitest';
import { titleSimilarity } from './titleSimilarity';

describe('titleSimilarity', () => {
  it('scores an exact match as 1', () => {
    expect(titleSimilarity('Romige kippastei met prei', 'Romige kippastei met prei')).toBe(1);
  });

  it('is case- and diacritics-insensitive', () => {
    expect(titleSimilarity('Romige Kippastei!', 'romige kippastei')).toBe(1);
    expect(titleSimilarity('Kruidige linzensoep met gember', 'kruidige linzensoep met gember')).toBe(1);
  });

  it('scores a near-duplicate above the 0.85 warning threshold', () => {
    expect(titleSimilarity('Zalm met broccoli en citroen', 'Zalm met broccoli en citroenen')).toBeGreaterThanOrEqual(0.85);
  });

  it('scores unrelated titles well below the threshold', () => {
    expect(titleSimilarity('Zalm met broccoli en citroen', 'Vegan chili sin carne')).toBeLessThan(0.85);
  });

  it('treats two empty titles as identical and one empty as maximally different', () => {
    expect(titleSimilarity('', '')).toBe(1);
    expect(titleSimilarity('', 'Iets')).toBe(0);
  });
});
