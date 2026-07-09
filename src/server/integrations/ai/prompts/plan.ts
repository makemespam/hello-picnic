// Prompt builders for purpose 'plan' and 'replace' (docs/PROMPTS.md §1-2). Pure
// functions — no I/O, no DB, no AI calls — so they stay snapshot-testable
// (docs/ARCHITECTURE.md §5: "Prompts are built by pure functions ... with snapshot
// tests"). planService gathers the dynamic inputs (library index, recently-planned,
// promotions, settings) and calls these; callStructured sends the result to the model.
//
// Static system blocks come first (cacheable), dynamic per-call data after
// (docs/ARCHITECTURE.md §5) — the section order below mirrors docs/PROMPTS.md §1 verbatim.

import type { MealStyle, RecipeType } from '@/shared/labels';
import type { PicnicPromotion } from '@/shared/dto';

export interface BuiltPrompt {
  system: string;
  prompt: string;
}

/** One line of the compact LIBRARY_INDEX (docs/PROMPTS.md §1: "send a compact index"). */
export interface LibraryIndexEntry {
  /** 1-based position — what the model refers back to via `libraryRef`. */
  number: number;
  title: string;
  type: RecipeType;
  rating: number;
  /** Days since last planned; null = never planned. */
  lastPlannedDaysAgo: number | null;
}

/** One RECENTLY_PLANNED entry — a library dish planned within the repeat window. */
export interface RecentlyPlannedEntry {
  title: string;
  daysAgo: number;
}

export interface ProteinSplitCounts {
  meatServings: number;
  vegaServings: number;
}

export interface BuildPlanPromptInput {
  /** Injectable clock (docs/workpackages/WP-06 §2: "date/season injection ... injectable for tests"). */
  now: Date;
  mealCount: number;
  servings: number;
  recipeTypes: RecipeType[];
  mealStyles: MealStyle[];
  allergies: string;
  libraryIndex: LibraryIndexEntry[];
  recentlyPlanned: RecentlyPlannedEntry[];
  repeatWindowDays: number;
  promotions: PicnicPromotion[];
  targetCostPerServingCents: number;
  /** Display labels of the household's pantry items (src/shared/pantry.ts). */
  pantryList: string[];
  /** Free-text "op te maken" products from household settings. */
  useUpProducts: string;
  /** Household proteinSplit feature flag + servings counts; omit/null to skip the block. */
  proteinSplit?: ProteinSplitCounts | null;
  preferences?: string;
}

const AMSTERDAM_TZ = 'Europe/Amsterdam';

const SEASON_BY_MONTH: Record<number, string> = {
  0: 'winter',
  1: 'winter',
  2: 'lente',
  3: 'lente',
  4: 'lente',
  5: 'zomer',
  6: 'zomer',
  7: 'zomer',
  8: 'herfst',
  9: 'herfst',
  10: 'herfst',
  11: 'winter',
};

/**
 * Europe/Amsterdam wall-clock date label + Dutch season name (docs/PROMPTS.md §1
 * SEIZOEN & DATUM). Never claims seasonality without a real date behind it — the
 * explicit lesson from v1 (docs/PROMPTS.md §1 "Never repeat v1's mistakes").
 */
export function deriveDateAndSeason(now: Date): { dateLabel: string; season: string } {
  const dateLabel = new Intl.DateTimeFormat('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: AMSTERDAM_TZ,
  }).format(now);

  // Month in the Amsterdam-local calendar, not the process's local/UTC month —
  // matters near midnight around a DST boundary or when the host runs in another TZ.
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: AMSTERDAM_TZ }).format(now);
  const monthIndex = Number(monthLabel) - 1;
  const season = SEASON_BY_MONTH[monthIndex] ?? 'onbekend';

  return { dateLabel, season };
}

/** Europe/Amsterdam wall-clock date as `YYYY-MM-DD` — used for `plans.week_start` / `plan_meals.cook_date`. */
export function amsterdamDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: AMSTERDAM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function formatEuroCents(cents: number): string {
  return `€ ${(cents / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatLibraryIndex(entries: LibraryIndexEntry[]): string {
  if (entries.length === 0) return 'Geen bibliotheekrecepten beschikbaar — genereer alles nieuw.';
  return entries
    .map((entry) => {
      const lastPlanned = entry.lastPlannedDaysAgo === null ? 'nog nooit gepland' : `${entry.lastPlannedDaysAgo} dgn geleden`;
      return `#${entry.number} · ${entry.title} · ${entry.type} · ★${entry.rating} · ${lastPlanned}`;
    })
    .join('\n');
}

function formatRecentlyPlanned(entries: RecentlyPlannedEntry[]): string {
  if (entries.length === 0) return 'geen';
  return entries.map((entry) => `${entry.title} (${entry.daysAgo} dgn geleden)`).join(', ');
}

function formatPromotions(promotions: PicnicPromotion[]): string {
  if (promotions.length === 0) return 'Geen aanbiedingen beschikbaar.';
  return promotions
    .map((promo) => {
      const price = formatEuroCents(promo.priceCents);
      const promoPrice = promo.promoPriceCents !== undefined ? formatEuroCents(promo.promoPriceCents) : '—';
      const label = promo.promoLabel ?? '—';
      return `${promo.name} · ${price} · ${promoPrice} · ${label}`;
    })
    .join('\n');
}

function formatPantryList(pantryList: string[]): string {
  return pantryList.length > 0 ? pantryList.join(', ') : 'geen';
}

function buildProteinSplitBlock(counts: ProteinSplitCounts | null | undefined): string {
  if (!counts) return '';
  return [
    'GESPLITSTE EIWITTEN',
    `Eén of meer gezinsleden eten vegetarisch. Maak waar passend gerechten met "proteinSplit": basisgerecht + twee bereidingen (bijv. blokjes kip voor ${counts.meatServings} porties, tofu/tempeh voor ${counts.vegaServings} porties), met gescheiden stap-instructies en beide eiwitten op de boodschappenlijst in de juiste hoeveelheden.`,
  ].join('\n');
}

/** Builds the static+dynamic system prompt shared by 'plan' and 'replace' (docs/PROMPTS.md §1-2). */
function buildSystemPrompt(input: BuildPlanPromptInput): string {
  const { dateLabel, season } = deriveDateAndSeason(input.now);

  return `Je bent de maaltijdplanner van een Nederlands gezin. Je stelt ${input.mealCount} avondmaaltijden samen voor ${input.servings} personen.

HARDE REGELS
- Toegestane basistypes: ${input.recipeTypes.join(', ')}. Elk recept krijgt precies één "type".
- Stijlvoorkeuren (richting, geen keurslijf): ${input.mealStyles.length > 0 ? input.mealStyles.join(', ') : 'geen specifieke voorkeur'}.
- Allergieën en harde uitsluitingen — NOOIT overtreden: ${input.allergies || 'geen bekende allergieën'}
- Elk recept: exact "servings": ${input.servings}, realistisch en thuis kookbaar in de aangegeven tijd, stijl HelloFresh, stappen in heldere Nederlandse jij-vorm.
- Respecteer het schema exact (enums, eenheden in g/ml/stuks/el/tl/bos/teen/blik/rol).

SEIZOEN & DATUM
Vandaag is ${dateLabel} (${season}). Kies seizoensgroenten die nu goed en betaalbaar zijn; benoem in "rationale" hoe het seizoen meeweegt.

BIBLIOTHEEK EERST
Dit gezin heeft favoriete, bewezen recepten. Vul eerst slots met passende bibliotheekrecepten (verwijs via "libraryRef": nummer) en genereer alleen nieuwe recepten voor de rest. Herhaal geen bibliotheekgerecht dat de afgelopen ${input.repeatWindowDays} dagen gepland was: ${formatRecentlyPlanned(input.recentlyPlanned)}.
Bibliotheek (nummer, titel, type, rating, laatst gepland):
${formatLibraryIndex(input.libraryIndex)}

SLIM HERGEBRUIK (verspilling minimaliseren)
- Verse kruiden, gember, tijm: plan ze in ≥2 gerechten zodat de bos opgaat.
- Open verpakkingen (kokosmelk 400ml, ricotta, room): tweede gerecht plant het restant in.
- Zet in "rationale" concreet welke ingrediënten je over gerechten heen deelt.

ECONOMISCH KOKEN
Aanbiedingen deze week (naam · gewone prijs · actieprijs · actietype):
${formatPromotions(input.promotions)}
- Bouw waar smaakvol mogelijk gerechten rond aanbiedingen met echte korting; zet het product in "usedPromotion".
- Multi-buy ("2e gratis", "2 voor X"): alleen benutten als het gezin de hoeveelheid echt opmaakt — combineer dan twee gerechten met dat ingrediënt.
- Richtprijs: gemiddeld ≤ ${formatEuroCents(input.targetCostPerServingCents)} per portie; luxe uitschieter mag als een ander gerecht goedkoop is.

KAST (altijd in huis; markeer als "pantry": true, telt niet als boodschap):
${formatPantryList(input.pantryList)}

OP TE MAKEN (verwerk logisch, zet "pantry": true als er daardoor niets gekocht hoeft):
${input.useUpProducts || 'geen'}

${buildProteinSplitBlock(input.proteinSplit)}`;
}

function buildUserMessage(preferences: string | undefined): string {
  return preferences ? `Wensen van het gezin deze week: ${preferences}` : 'Verras ons met een gevarieerde week.';
}

/** Purpose 'plan' (docs/PROMPTS.md §1). */
export function buildPlanPrompt(input: BuildPlanPromptInput): BuiltPrompt {
  return {
    system: buildSystemPrompt(input),
    prompt: buildUserMessage(input.preferences),
  };
}

export interface OtherMealSummary {
  title: string;
  type: RecipeType;
  keyIngredients: string[];
}

export interface BuildReplacePromptInput extends BuildPlanPromptInput {
  oldTitle: string;
  otherMeals: OtherMealSummary[];
  avoidTitles: string[];
}

function formatOtherMeals(meals: OtherMealSummary[]): string {
  if (meals.length === 0) return 'geen andere gerechten deze week.';
  return meals.map((meal) => `- ${meal.title} (${meal.type}) — kerningrediënten: ${meal.keyIngredients.join(', ') || 'onbekend'}`).join('\n');
}

/** Purpose 'replace' (docs/PROMPTS.md §2): same system prompt + a VERVANGING context block. */
export function buildReplacePrompt(input: BuildReplacePromptInput): BuiltPrompt {
  const base = buildSystemPrompt(input);
  const vervangingBlock = `VERVANGING
Vervang alleen "${input.oldTitle}". De overige gerechten blijven staan:
${formatOtherMeals(input.otherMeals)}
- Sluit aan op het bestaande hergebruik (deel waar mogelijk dezelfde verse kruiden/restverpakkingen).
- Vermijd: ${input.avoidTitles.length > 0 ? input.avoidTitles.join(', ') : 'niets specifiek'} en alles wat te veel lijkt op de blijvende gerechten.
- Zelfde type-categorie als het origineel, tenzij de gebruikerswens anders vraagt.`;

  return {
    system: `${base}\n\n${vervangingBlock}`,
    prompt: buildUserMessage(input.preferences),
  };
}
