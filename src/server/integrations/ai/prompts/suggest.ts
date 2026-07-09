// Prompt builders for purpose 'suggest' (docs/PROMPTS.md §6, docs/workpackages/
// WP-13-proactive-suggestions.md). Pure functions — no I/O — snapshot-testable like
// plan.ts/scanCard.ts. suggestionService/seasonService gather the dynamic inputs
// (the rule-based top-6 candidates, or a batch of recipes needing month-tags) and call
// these; callStructured sends the result to the model.
import type { BuiltPrompt } from './plan';

// --- Ranking + teaser (suggestionService's optional LLM call) -----------------------

/** One rule-based candidate, in rank order — the model only ever sees this compact list. */
export interface SuggestRankCandidate {
  title: string;
  type: string;
  rating: number;
  timeMin: number;
}

const RANK_SYSTEM = `Je schrijft korte, warme Nederlandse teaserzinnen voor het thuisscherm van een gezinsmaaltijd-app. Je krijgt een lijst met al gekozen, bewezen recepten uit de bibliotheek van het gezin, in volgorde van geschiktheid.

- Herschik de lijst als een duidelijk betere volgorde voor smaak/afwisseling dat rechtvaardigt; anders laat je de volgorde ongewijzigd.
- Schrijf per recept precies één teaserzin ("teaser"), maximaal 90 tekens, die uitnodigt om het te koken (bijv. "Perfect voor een doordeweekse avond: jullie ★5 orzosalade.").
- Verwijs naar elk recept met "index": het volgnummer uit de lijst hieronder (nooit een eigen naam of nummer verzinnen).
- Neem elk recept uit de lijst precies één keer op.`;

function formatRankCandidates(candidates: SuggestRankCandidate[]): string {
  return candidates
    .map((candidate, i) => `#${i + 1} · ${candidate.title} · ${candidate.type} · ★${candidate.rating} · ${candidate.timeMin} min`)
    .join('\n');
}

/** docs/PROMPTS.md §6: rerank the rule-based top-6 + write one Dutch teaser line each. */
export function buildSuggestRankPrompt(candidates: SuggestRankCandidate[]): BuiltPrompt {
  return {
    system: RANK_SYSTEM,
    prompt: `Recepten (volgnummer · titel · type · rating · bereidingstijd):\n${formatRankCandidates(candidates)}`,
  };
}

// --- Seasonality month-tagging (seasonService's batch call) -------------------------

export interface SeasonBatchCandidate {
  title: string;
  type: string;
  description: string;
}

const SEASON_SYSTEM = `Je bepaalt in welke maanden een gerecht op z'n best is voor een Nederlands gezin (seizoensgroenten, comfort food in de winter, lichte gerechten in de zomer, enzovoort).

- Geef per recept een lijst "bestMonths" met maandnummers (1 = januari .. 12 = december) waarin het gerecht het best past.
- Een gerecht dat het hele jaar door even goed past krijgt een lege lijst.
- Wees beknopt: meestal 2-4 maanden, nooit meer dan 6.
- Verwijs naar elk recept met "index": het volgnummer uit de lijst hieronder.`;

function formatSeasonCandidates(candidates: SeasonBatchCandidate[]): string {
  return candidates
    .map((candidate, i) => `#${i + 1} · ${candidate.title} · ${candidate.type}${candidate.description ? ` · ${candidate.description}` : ''}`)
    .join('\n');
}

/** docs/workpackages/WP-13 §2: cheap batch call, 1 recipe (create-time hook) or many (backfill). */
export function buildSeasonBatchPrompt(candidates: SeasonBatchCandidate[]): BuiltPrompt {
  return {
    system: SEASON_SYSTEM,
    prompt: `Recepten (volgnummer · titel · type · beschrijving):\n${formatSeasonCandidates(candidates)}`,
  };
}
