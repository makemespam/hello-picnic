// Prompt builder for purpose 'scan_card' (docs/PROMPTS.md §3, docs/workpackages/
// WP-08-card-scanning.md). Pure function — no I/O — so it stays snapshot-testable
// like plan.ts/validateProduct.ts. The card photo(s) themselves are NOT part of the
// text prompt: scanService reads them from the StorageAdapter and passes them to
// callStructured's `images` param, which maps them to the model's multimodal message
// content — this file only builds the system instruction + a short user prompt.
import type { BuiltPrompt } from './plan';

// Verbatim system prompt from docs/PROMPTS.md §3, with one necessary deviation: the
// doc's ingredient line reads "PER {SERVINGS_ON_CARD} personen", but unlike every other
// {PLACEHOLDER} in docs/PROMPTS.md (DATE, SEASON, LIBRARY_INDEX, ...), SERVINGS_ON_CARD
// has no value this code could inject BEFORE the call — the model only learns that
// number by reading the card itself (it's the same value it must also report back as
// "cardServings"). Rendered here as plain instruction text instead of a substituted
// placeholder; flagged as a deviation in the WP-08 PR per .cursorrules ("if docs seem
// wrong: stop and report, don't improvise" — reported, but the semantic intent is
// unambiguous enough to implement while flagging).
const SYSTEM = `Je leest een HelloFresh-receptkaart (Nederlands). Extraheer het recept exact zoals het op de kaart staat — verzin niets bij. Onleesbare velden krijgen null en een notitie in "issues".

- Titel exact; beschrijving mag je bondig samenvatten van de kaartintro.
- Ingrediënten: alle regels, met hoeveelheid + eenheid per het aantal personen dat de kaart zelf vermeldt (zie "cardServings"); markeer voorraadkast-items (olie, zout e.d.) met "pantry": true.
- Stappen: alle genummerde stappen volledig, in de volgorde van de kaart.
- Schat "type" (vegan/vegetarisch/vis/kip/rund/varken), "time" (staat meestal op de kaart) en "difficulty".
- "cardServings": voor hoeveel personen de kaarthoeveelheden gelden.
- Vul "confidence" als lijst van objecten {"field": "<veldnaam, bijv. title of ingredients[2].amount>", "level": "high|medium|low"} zodat de reviewer weet waar te kijken.`;

export interface BuildScanCardPromptInput {
  /** True when only a front photo was captured (no back/ingredient panel) — tells the
   * model the ingredients/steps may genuinely be absent from what it's given, rather
   * than a reading failure worth inventing content to cover for. */
  frontOnly?: boolean;
}

/** docs/PROMPTS.md §3: "Input: 1–2 photos (front = dish photo + title; back = ingredients/steps)." */
export function buildScanCardPrompt(input: BuildScanCardPromptInput = {}): BuiltPrompt {
  const prompt = input.frontOnly
    ? 'Dit is alleen de voorkant van de kaart (geen achterkant met ingrediënten/stappen gefotografeerd). Extraheer titel en wat zichtbaar is; laat "ingredients"/"steps" leeg met een notitie in "issues" als die niet op deze foto staan.'
    : "Lees de bijgevoegde foto's van de receptkaart (voorkant + achterkant) en extraheer het recept exact volgens de systeeminstructie.";

  return { system: SYSTEM, prompt };
}
