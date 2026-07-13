import { describe, expect, it } from 'vitest';
import {
  AI_IMAGE_MODELS,
  AI_MODELS,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_MODEL_BY_PURPOSE,
  getDefaultImageModel,
  getDefaultModelForPurpose,
  getImageModelById,
  getModelById,
  getModelsForPurpose,
} from './models';

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
    // `image` intentionally has zero registry entries — see models.ts header comment.
    // WP-07's photo taste test completes this. `scan_card` now has a provisional
    // default (WP-08 deviation, same header comment) and is covered separately below.
    expect(getDefaultModelForPurpose('image')).toBeUndefined();
  });

  it('getDefaultModelForPurpose resolves scan_card to the WP-08 provisional default', () => {
    const model = getDefaultModelForPurpose('scan_card');
    expect(model?.id).toBe('gemini-3.5-flash');
    expect(model?.purposes).toContain('scan_card');
  });
});

describe('AI image model registry (WP-07, docs/workpackages/WP-07-photo-pipeline.md — separate from AI_MODELS)', () => {
  it('has no duplicate ids', () => {
    const ids = AI_IMAGE_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has strictly positive prices for every entry', () => {
    for (const model of AI_IMAGE_MODELS) {
      expect(model.pricePerImageCents).toBeGreaterThan(0);
    }
  });

  it('stamps verifiedOn on every entry', () => {
    for (const model of AI_IMAGE_MODELS) {
      expect(model.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('has at least one entry per supported image provider', () => {
    const providers = new Set(AI_IMAGE_MODELS.map((m) => m.provider));
    expect(providers.has('google')).toBe(true);
    expect(providers.has('openai')).toBe(true);
  });

  it('DEFAULT_IMAGE_MODEL_ID resolves to a registered image model', () => {
    const model = getImageModelById(DEFAULT_IMAGE_MODEL_ID);
    expect(model).toBeDefined();
  });

  it('getDefaultImageModel returns the same model as DEFAULT_IMAGE_MODEL_ID', () => {
    expect(getDefaultImageModel()?.id).toBe(DEFAULT_IMAGE_MODEL_ID);
  });

  it('getImageModelById returns undefined for an unknown id', () => {
    expect(getImageModelById('does-not-exist')).toBeUndefined();
  });
});
