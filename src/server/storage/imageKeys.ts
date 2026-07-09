// Pure image-derivative key naming (docs/workpackages/WP-04 §Tests: "image derivative
// naming"). Deliberately has zero I/O so it's cheap to unit test and can be reused by
// both imageService (writing derivatives) and scripts/sweep-orphans.ts (computing the
// expected key set for a given `images` row without touching sharp/StorageAdapter).

export type ImageVariant = '640w' | '1280w' | 'blur';

export const IMAGE_VARIANTS: ImageVariant[] = ['640w', '1280w', 'blur'];

const VARIANT_MIME: Record<ImageVariant, string> = {
  '640w': 'image/webp',
  '1280w': 'image/webp',
  blur: 'image/webp',
};

/**
 * Derives the storage key for one size variant of a logical image. `baseKey` is the
 * `images.filePath` column value — a per-image key prefix (e.g. `img-<uuid>`)
 * that every derivative for that image lives under.
 */
export function deriveImageKey(baseKey: string, variant: ImageVariant): string {
  return `${baseKey}/${variant}.webp`;
}

export function mimeForVariant(variant: ImageVariant): string {
  return VARIANT_MIME[variant];
}

/** All derivative keys for a given base key — used by scripts/sweep-orphans.ts. */
export function allDerivativeKeys(baseKey: string): string[] {
  return IMAGE_VARIANTS.map((variant) => deriveImageKey(baseKey, variant));
}
