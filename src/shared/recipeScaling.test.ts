import { describe, expect, it } from 'vitest';
import { formatAmountNl, scaleIngredientAmount, scaleIngredients } from './recipeScaling';

describe('scaleIngredientAmount', () => {
  it('returns the same amount when servings are unchanged', () => {
    expect(scaleIngredientAmount({ amount: 250, unit: 'g', fromServings: 4, toServings: 4 })).toBe(250);
  });

  it('rounds grams to the nearest 5', () => {
    // 125g for 4 -> 6 servings = 187.5g raw -> nearest 5 = 190
    expect(scaleIngredientAmount({ amount: 125, unit: 'g', fromServings: 4, toServings: 6 })).toBe(190);
  });

  it('rounds millilitres to the nearest 5', () => {
    // 100ml for 4 -> 3 servings = 75ml raw -> already a multiple of 5
    expect(scaleIngredientAmount({ amount: 100, unit: 'ml', fromServings: 4, toServings: 3 })).toBe(75);
  });

  it('rounds "stuks" to the nearest 0.5', () => {
    // 2 stuks for 4 -> 6 servings = 3 stuks exactly
    expect(scaleIngredientAmount({ amount: 2, unit: 'stuks', fromServings: 4, toServings: 6 })).toBe(3);
    // 1 stuk for 4 -> 3 servings = 0.75 raw -> nearest 0.5 = 1
    expect(scaleIngredientAmount({ amount: 1, unit: 'stuks', fromServings: 4, toServings: 3 })).toBe(1);
  });

  it('applies the 0.5-step rule to other non-weight units too (teen, bos, el, tl)', () => {
    expect(scaleIngredientAmount({ amount: 3, unit: 'teen', fromServings: 4, toServings: 2 })).toBe(1.5);
    expect(scaleIngredientAmount({ amount: 1, unit: 'bos', fromServings: 4, toServings: 8 })).toBe(2);
    expect(scaleIngredientAmount({ amount: 2, unit: 'el', fromServings: 2, toServings: 3 })).toBe(3);
  });

  it('never rounds a positive amount down to zero — floors to one rounding step', () => {
    expect(scaleIngredientAmount({ amount: 5, unit: 'g', fromServings: 8, toServings: 1 })).toBe(5);
    expect(scaleIngredientAmount({ amount: 1, unit: 'stuks', fromServings: 8, toServings: 1 })).toBe(0.5);
  });

  it('treats a zero amount as zero regardless of scaling', () => {
    expect(scaleIngredientAmount({ amount: 0, unit: 'g', fromServings: 4, toServings: 8 })).toBe(0);
  });

  it('is case/whitespace-insensitive for the weight/volume unit match', () => {
    expect(scaleIngredientAmount({ amount: 100, unit: 'ML', fromServings: 2, toServings: 4 })).toBe(200);
    expect(scaleIngredientAmount({ amount: 100, unit: ' g ', fromServings: 2, toServings: 4 })).toBe(200);
  });

  it('throws for non-positive servings', () => {
    expect(() => scaleIngredientAmount({ amount: 100, unit: 'g', fromServings: 0, toServings: 4 })).toThrow();
    expect(() => scaleIngredientAmount({ amount: 100, unit: 'g', fromServings: 4, toServings: 0 })).toThrow();
  });
});

describe('scaleIngredients', () => {
  it('scales a list while preserving other fields and order', () => {
    const result = scaleIngredients(
      [
        { name: 'ui', amount: 1, unit: 'stuks' },
        { name: 'bloem', amount: 100, unit: 'g' },
      ],
      2,
      4
    );
    expect(result).toEqual([
      { name: 'ui', amount: 2, unit: 'stuks' },
      { name: 'bloem', amount: 200, unit: 'g' },
    ]);
  });
});

describe('formatAmountNl', () => {
  it('formats with a Dutch comma decimal separator', () => {
    expect(formatAmountNl(1.5)).toBe('1,5');
  });

  it('trims trailing zeros / integral amounts', () => {
    expect(formatAmountNl(190)).toBe('190');
  });
});
