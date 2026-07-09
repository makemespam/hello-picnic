import { describe, expect, it } from 'vitest';
import { AI_MODELS, DEFAULT_MODEL_BY_PURPOSE, getDefaultModelForPurpose, getModelById, getModelsForPurpose } from './models';

describe('AI model registry (docs/ARCHITECTURE.md §5: "the ONLY model registry")', () => {
  it('has no duplicate ids', () => {
    const ids = AI_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has strictly positive prices for every entry', () => {
    for (const model of AI_MODELS) {
      expect(model.inputPricePerMTok).toBeGreaterThan(0);
      expect(model.outputPricePerMTok).toBeGreaterThan(0);
    }
  });

  it('stamps verifiedOn on every entry', () => {
    for (const model of AI_MODELS) {
      expect(model.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every DEFAULT_MODEL_BY_PURPOSE id resolves to a registered model that lists that purpose', () => {
    for (const [purpose, id] of Object.entries(DEFAULT_MODEL_BY_PURPOSE)) {
      const model = getModelById(id!);
      expect(model, `${id} for ${purpose}`).toBeDefined();
      expect(model?.purposes).toContain(purpose);
    }
  });

  it('getModelsForPurpose filters by purpose', () => {
    const planModels = getModelsForPurpose('plan');
    expect(planModels.length).toBeGreaterThan(0);
    for (const model of planModels) expect(model.purposes).toContain('plan');
  });

  it('getDefaultModelForPurpose returns undefined for purposes with no verified candidate yet', () => {
    // scan_card/image intentionally have zero registry entries in the WP-03 stub —
    // see models.ts header comment. WP-05 completes this.
    expect(getDefaultModelForPurpose('scan_card')).toBeUndefined();
    expect(getDefaultModelForPurpose('image')).toBeUndefined();
  });
});
