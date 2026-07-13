import { describe, expect, it } from 'vitest';
import { buildImagePrompt, keyIngredientsForPhoto } from './image';

describe('buildImagePrompt (docs/PROMPTS.md §5, normative)', () => {
  it('matches the normative prompt text exactly (snapshot)', () => {
    const prompt = buildImagePrompt({
      title: 'Romige tomatensoep met basilicum',
      ingredients: [
        { display: 'Tomaten', pantry: false },
        { display: 'Room', pantry: false },
        { display: 'Basilicum', pantry: false },
        { display: 'Ui', pantry: false },
        { display: 'Knoflook', pantry: false },
        { display: 'Bouillon', pantry: false }, // 6th non-pantry — dropped, top-5 only
        { display: 'Zout', pantry: true }, // pantry — never counted/shown
      ],
    });
    expect(prompt).toMatchInlineSnapshot(`
      "Overhead 3/4 top-down food photography of Romige tomatensoep met basilicum: Tomaten, Room, Basilicum, Ui, Knoflook.
      Plated home-style on a ceramic plate, warm natural daylight, fresh garnish,
      shallow depth of field, appetizing, realistic home cooking (not restaurant plating),
      neutral light background, no text, no hands, no packaging. Square 1:1."
    `);
  });

  it('falls back to the title when every ingredient is pantry (never an empty ingredient list in the prompt)', () => {
    const prompt = buildImagePrompt({ title: 'Boterham met kaas', ingredients: [{ display: 'Boter', pantry: true }] });
    expect(prompt).toContain('Boterham met kaas: Boterham met kaas.');
  });

  it('falls back to the title when there are no ingredients at all', () => {
    const prompt = buildImagePrompt({ title: 'Geheim recept', ingredients: [] });
    expect(prompt).toContain('Geheim recept: Geheim recept.');
  });
});

describe('keyIngredientsForPhoto', () => {
  it('filters out pantry ingredients and caps at 5, preserving order', () => {
    const ingredients = [
      { display: 'A', pantry: false },
      { display: 'Zout', pantry: true },
      { display: 'B', pantry: false },
      { display: 'C', pantry: false },
      { display: 'D', pantry: false },
      { display: 'E', pantry: false },
      { display: 'F', pantry: false },
    ];
    expect(keyIngredientsForPhoto(ingredients)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('returns an empty array when there are no non-pantry ingredients', () => {
    expect(keyIngredientsForPhoto([{ display: 'Zout', pantry: true }])).toEqual([]);
  });
});
