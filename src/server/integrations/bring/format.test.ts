// Unit layer (docs/TESTING.md §1, docs/workpackages/WP-11-bring-v2.md "Tests: item
// formatting") — pure Dutch quantity-spec formatting for the Bring send path.
import { describe, expect, it } from 'vitest';
import { formatBringItem, formatBringSpec } from './format';

describe('formatBringSpec', () => {
  it('formats whole amounts plainly', () => {
    expect(formatBringSpec(400, 'g')).toBe('400 g');
    expect(formatBringSpec(2, 'stuks')).toBe('2 stuks');
  });

  it('formats decimals with a Dutch comma', () => {
    expect(formatBringSpec(1.5, 'kg')).toBe('1,5 kg');
    expect(formatBringSpec(0.5, 'l')).toBe('0,5 l');
  });

  it('rounds to one decimal (same rounding as the boodschappen screen)', () => {
    expect(formatBringSpec(1.25, 'kg')).toBe('1,3 kg');
    expect(formatBringSpec(1.04, 'kg')).toBe('1 kg');
  });

  it('handles a missing/blank unit without a trailing space', () => {
    expect(formatBringSpec(3, '')).toBe('3');
    expect(formatBringSpec(3, '  ')).toBe('3');
  });
});

describe('formatBringItem', () => {
  it("maps display + amount + unit onto Bring's name/spec pair with the '{display} — {amount} {unit}' label", () => {
    expect(formatBringItem('Kipfilet', 600, 'g')).toEqual({ name: 'Kipfilet', spec: '600 g', label: 'Kipfilet — 600 g' });
  });

  it('formats decimal amounts Dutch-style in both spec and label', () => {
    expect(formatBringItem('Aardappelen', 1.5, 'kg')).toEqual({
      name: 'Aardappelen',
      spec: '1,5 kg',
      label: 'Aardappelen — 1,5 kg',
    });
  });

  it('trims the display name', () => {
    expect(formatBringItem('  Broccoli ', 500, 'g').name).toBe('Broccoli');
  });
});
