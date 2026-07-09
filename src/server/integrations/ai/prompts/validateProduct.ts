// Prompt builder for purpose 'validate_product' (docs/PROMPTS.md §4, docs/workpackages/
// WP-10-basket-optimizer.md §2: "port v1's rules (they were good) into the structured
// pipeline"). Pure function — no I/O — so it stays snapshot-testable like
// src/server/integrations/ai/prompts/plan.ts. shoppingService gathers the ranked
// candidates (picnic/selection.ts rankPicnicArticles) and calls this; callStructured
// sends the result to the model with validateProductSchema (src/shared/ai-schemas.ts).
import type { IngredientCategory, ProductPreference } from '@/shared/labels';
import type { BuiltPrompt } from './plan';

export interface ValidateProductCandidate {
  name: string;
  priceCents: number;
  unitQuantity?: string;
  promoLabel?: string;
}

export interface BuildValidateProductPromptInput {
  query: string;
  category: IngredientCategory;
  productPreference?: ProductPreference;
  candidates: ValidateProductCandidate[];
}

const SYSTEM = `Je kiest het beste Picnic-product voor een boodschappenlijst-item van een Nederlands gezin.

Regels:
- Respecteer de opgegeven productvoorkeur (vers/diepvries/blik/gedroogd) als die is meegegeven.
- Kies een puur/onbewerkt product boven een kant-en-klaar of samengesteld gerecht, tenzij de gevraagde naam zelf al een gerecht is.
- Wijs non-food, babyvoeding en kant-en-klaarmaaltijden af, tenzij daar expliciet om gevraagd wordt.
- Herken Nederlandse synoniemen (bv. "wortel"/"waspeen", "ei"/"eieren").
- Let op kleur- en variant-match (bv. rode ui vs gewone ui, rode vs gele paprika).
- Bij meerdere geschikte producten wint het goedkoopste.
- Geef het 0-gebaseerde indexnummer van het beste kandidaat-product, of null als geen enkele kandidaat geschikt is.
- Geef bij null optioneel een betere zoekterm (betterSearchTerm) die een nieuwe zoekopdracht kan gebruiken.
- Geef altijd een korte reden (reason) in het Nederlands.`;

function formatCandidate(candidate: ValidateProductCandidate, index: number): string {
  const price = `€${(candidate.priceCents / 100).toFixed(2)}`;
  const promo = candidate.promoLabel ? ` (${candidate.promoLabel})` : '';
  const unitQuantity = candidate.unitQuantity ? ` · ${candidate.unitQuantity}` : '';
  return `${index} · ${candidate.name} · ${price}${promo}${unitQuantity}`;
}

/** docs/PROMPTS.md §4: "Candidates listed as index · name · price(+promo) · unitQuantity". */
export function buildValidateProductPrompt(input: BuildValidateProductPromptInput): BuiltPrompt {
  const preferenceLine = input.productPreference ? `Productvoorkeur: ${input.productPreference}.` : 'Geen specifieke productvoorkeur.';
  const candidatesBlock = input.candidates.map((candidate, index) => formatCandidate(candidate, index)).join('\n');

  return {
    system: SYSTEM,
    prompt: `Gezocht ingrediënt: "${input.query}" (categorie: ${input.category}).
${preferenceLine}

KANDIDATEN
${candidatesBlock || '(geen kandidaten gevonden)'}`,
  };
}
