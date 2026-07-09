// Single source for label/copy maps used across the design system
// (docs/DESIGN_PRINCIPLES.md §3: "TYPE_LABEL-style maps live in src/shared/labels.ts only").
//
// `RecipeType` / `Difficulty` mirror the enums in docs/ARCHITECTURE.md §3. The formal Zod
// schema for the `recipes` table lands in WP-04 — until then this file is the provisional
// source of truth for the design system and must be kept in sync.

export type RecipeType = 'vegan' | 'vegetarisch' | 'vis' | 'kip' | 'rund' | 'varken';

export type Difficulty = 'makkelijk' | 'gemiddeld' | 'uitdagend';

export const TYPE_LABEL: Record<RecipeType, string> = {
  vegan: 'Vegan',
  vegetarisch: 'Vegetarisch',
  vis: 'Vis',
  kip: 'Kip',
  rund: 'Rund',
  varken: 'Varken',
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  makkelijk: 'Makkelijk',
  gemiddeld: 'Gemiddeld',
  uitdagend: 'Uitdagend',
};

// Recipe-type badge palette — defined ONCE here, consumed by RecipeTypeBadge.
// Colors always come from the `badge` tokens in tailwind.config.ts, never ad-hoc classes.
export const TYPE_BADGE_CLASSES: Record<RecipeType, string> = {
  vegan: 'bg-badge-vegan-bg text-badge-vegan-fg',
  vegetarisch: 'bg-badge-vegetarisch-bg text-badge-vegetarisch-fg',
  vis: 'bg-badge-vis-bg text-badge-vis-fg',
  kip: 'bg-badge-kip-bg text-badge-kip-fg',
  rund: 'bg-badge-rund-bg text-badge-rund-fg',
  varken: 'bg-badge-varken-bg text-badge-varken-fg',
};

export interface NavItem {
  href: string;
  label: string;
  emoji: string;
}

// Bottom nav (mobile) + sidebar (desktop) share this single source (docs/DESIGN_PRINCIPLES.md §4).
// TopBar also reads this list to resolve the current section's page title from the pathname.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Vandaag', emoji: '🏠' },
  { href: '/plan', label: 'Weekplan', emoji: '📅' },
  { href: '/recepten', label: 'Recepten', emoji: '📖' },
  { href: '/boodschappen', label: 'Boodschappen', emoji: '🛒' },
  { href: '/meer', label: 'Meer', emoji: '⚙️' },
];
