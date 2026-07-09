import { describe, expect, it } from 'vitest';
import { allDerivativeKeys, deriveImageKey, IMAGE_VARIANTS, mimeForVariant } from './imageKeys';

describe('deriveImageKey', () => {
  it('nests each variant under the base key with a fixed filename', () => {
    expect(deriveImageKey('recipe-12-abc', '640w')).toBe('recipe-12-abc/640w.webp');
    expect(deriveImageKey('recipe-12-abc', '1280w')).toBe('recipe-12-abc/1280w.webp');
    expect(deriveImageKey('recipe-12-abc', 'blur')).toBe('recipe-12-abc/blur.webp');
  });
});

describe('allDerivativeKeys', () => {
  it('returns one key per known variant, all under the same base key', () => {
    const keys = allDerivativeKeys('recipe-1-xyz');
    expect(keys).toHaveLength(IMAGE_VARIANTS.length);
    for (const key of keys) {
      expect(key.startsWith('recipe-1-xyz/')).toBe(true);
    }
  });
});

describe('mimeForVariant', () => {
  it('reports webp for every variant (all derivatives are webp per WP-04 scope)', () => {
    for (const variant of IMAGE_VARIANTS) {
      expect(mimeForVariant(variant)).toBe('image/webp');
    }
  });
});
