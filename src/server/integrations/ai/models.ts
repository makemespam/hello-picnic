// Data-only AI model registry (docs/ARCHITECTURE.md §5): "the ONLY model registry".
// No model id or price may be hardcoded anywhere else in the codebase.
//
// WP-03 stub (docs/workpackages/WP-03-auth-settings-secrets-ledger.md §5: "stub
// registry now, completed in WP-05"): only entries with a fully verified $/MTok
// price pair from docs/PROMPTS.md §7 (web-verified 2026-07-11) are registered.
// `image` intentionally has ZERO candidates here — WP-07's 5-dish taste test fixes
// that default. Never guess a price: an unverified number silently corrupts the cost
// ledger, an empty dropdown does not.
//
// `scan_card` DEVIATION (WP-08): docs/workpackages/WP-08-card-scanning.md §7 calls for
// a live model-eval mini-task — run the extraction prompt on real card photos with 2
// candidate models and compare Dutch-OCR field accuracy before picking the default.
// This sandbox has no real provider API keys (see the builder task's environment
// notes), so that live eval could not be run. The eval PLAN is documented in
// docs/workpackages/WP-08-card-scanning.md's PR (owner runs it at deploy time,
// swapping the default below if a candidate wins); in the meantime this wires up the
// doc-stated, already-verified default (docs/PROMPTS.md §7, verifiedOn 2026-07-11) so
// scan_card is functional end-to-end instead of permanently config-erroring.

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
  {
    id: 'gpt-5.5',
    provider: 'openai',
    purposes: ['plan', 'replace'],
    inputPricePerMTok: 5,
    outputPricePerMTok: 30,
    verifiedOn: VERIFIED_ON,
    notes: 'Premium alternative for plan/replace.',
  },
  {
    id: 'gpt-5.4-mini',
    provider: 'openai',
    purposes: ['scan_card', 'validate_product'],
    inputPricePerMTok: 0.75,
    outputPricePerMTok: 4.5,
    verifiedOn: VERIFIED_ON,
    notes: 'Vision-capable; alternative for scan_card.',
  },
  {
    id: 'gemini-3.5-flash',
    provider: 'google',
    purposes: ['scan_card', 'validate_product'],
    inputPricePerMTok: 1.5,
    outputPricePerMTok: 9,
    verifiedOn: VERIFIED_ON,
    notes: 'Default for scan_card (vision, Dutch OCR eval in WP-08).',
  },
  // Image models (purpose 'image') land with WP-07's taste test — callImage
  // deliberately throws AiConfigError until then.
];

// Owner-overridable per purpose in settings (docs/ARCHITECTURE.md §5); this is only
// the built-in fallback when no override is stored. Purposes with no verified
// candidate yet are omitted on purpose — see file header. `image` stays omitted until
// WP-07's taste test; `scan_card` is wired provisionally — see the header deviation note.
export const DEFAULT_MODEL_BY_PURPOSE: Partial<Record<AiPurpose, string>> = {
  plan: 'claude-sonnet-5',
  replace: 'claude-sonnet-5',
  validate_product: 'claude-haiku-4-5-20251001',
  scan_card: 'gemini-3.5-flash',
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

// Used by POST /api/ai/test (WP-05 §6: "Test verbinding" per provider) to pick a
// registered model to probe — connectivity checks don't go through purpose routing.
export function getModelsForProvider(provider: AiProvider): AiModel[] {
  return AI_MODELS.filter((model) => model.provider === provider);
}
