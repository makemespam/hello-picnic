import { describe, expect, it } from 'vitest';
import { buildScanCardPrompt } from './scanCard';

describe('buildScanCardPrompt (docs/PROMPTS.md §3)', () => {
  it('includes every normative system-prompt instruction verbatim', () => {
    const { system } = buildScanCardPrompt();
    expect(system).toContain('HelloFresh-receptkaart');
    expect(system).toContain('Onleesbare velden krijgen null en een notitie in "issues"');
    expect(system).toContain('"pantry": true');
    expect(system).toContain('cardServings');
    expect(system).toContain('confidence');
  });

  it('points at both photos by default', () => {
    const { prompt } = buildScanCardPrompt();
    expect(prompt).toContain('voorkant + achterkant');
  });

  it('warns the model that ingredients/steps may be absent when frontOnly', () => {
    const { prompt } = buildScanCardPrompt({ frontOnly: true });
    expect(prompt).toContain('alleen de voorkant');
    expect(prompt).toContain('issues');
  });
});
