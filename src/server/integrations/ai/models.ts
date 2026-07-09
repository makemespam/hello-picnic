// Data-only AI model registry (docs/ARCHITECTURE.md §5): "the ONLY model registry".
// No model id or price may be hardcoded anywhere else in the codebase.
//
// WP-03 stub (docs/workpackages/WP-03-auth-settings-secrets-ledger.md §5: "stub
// registry now, completed in WP-05"): only entries with a fully verified $/MTok
// price pair from docs/PROMPTS.md §7 (web-verified 2026-07-11) are registered.
// `scan_card` and `image` purposes intentionally have ZERO candidates here — the
// doc names line/preview candidates (gemini-3.5-flash, Nano Banana 2, gpt-image-1.5,
// Imagen 4, gpt-5.4-mini) but explicitly defers fixing a priced default until the
// WP-08 Dutch-OCR eval and WP-07 photo taste-test. Never guess a price: an
// unverified number silently corrupts the cost ledger, an empty dropdown does not.
// WP-05 re-verifies every id+price against live provider docs before adding entries
// for those two purposes and stamps a fresh `verifiedOn`.

import type { AiPurpose } from '@/shared/labels';

export type AiProvider = 'anthropic' | 'openai' | 'google' | 'deepseek';

export interface AiModel {
  id: string;
  provider: AiProvider;
  purposes: AiPurpose[];
  /** USD per 1,000,000 input tokens. */
  inputPricePerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPricePerMTok: number;
  /** Date (YYYY-MM-DD) this id + price pair was last checked against live provider docs. */
  verifiedOn: string;
  notes?: string;
}

const VERIFIED_ON = '2026-07-11';

export const AI_MODELS: AiModel[] = [
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    purposes: ['plan', 'replace'],
    inputPricePerMTok: 2,
    outputPricePerMTok: 10,
    verifiedOn: VERIFIED_ON,
    notes: 'Intro pricing until 2026-08-31, then $3/$10MTok input / $15/MTok output.',
  },
  {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    purposes: ['plan', 'replace'],
    inputPricePerMTok: 0.44,
    outputPricePerMTok: 0.87,
    verifiedOn: VERIFIED_ON,
    notes: 'Budget alternative for plan/replace.',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    purposes: ['validate_product', 'suggest'],
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
    verifiedOn: VERIFIED_ON,
    notes: 'Default for validate_product; alternative for suggest.',
  },
  {
    id: 'deepseek-v4-flash',
    provider: 'deepseek',
    purposes: ['validate_product', 'suggest'],
    inputPricePerMTok: 0.14,
    outputPricePerMTok: 0.28,
    verifiedOn: VERIFIED_ON,
    notes: 'Default for suggest; budget alternative for validate_product.',
  },
];

// Owner-overridable per purpose in settings (docs/ARCHITECTURE.md §5); this is only
// the built-in fallback when no override is stored. Purposes with no verified
// candidate yet are omitted on purpose — see file header.
export const DEFAULT_MODEL_BY_PURPOSE: Partial<Record<AiPurpose, string>> = {
  plan: 'claude-sonnet-5',
  replace: 'claude-sonnet-5',
  validate_product: 'claude-haiku-4-5-20251001',
  suggest: 'deepseek-v4-flash',
};

export function getModelsForPurpose(purpose: AiPurpose): AiModel[] {
  return AI_MODELS.filter((model) => model.purposes.includes(purpose));
}

export function getDefaultModelForPurpose(purpose: AiPurpose): AiModel | undefined {
  const id = DEFAULT_MODEL_BY_PURPOSE[purpose];
  return id ? AI_MODELS.find((model) => model.id === id) : undefined;
}

export function getModelById(id: string): AiModel | undefined {
  return AI_MODELS.find((model) => model.id === id);
}
