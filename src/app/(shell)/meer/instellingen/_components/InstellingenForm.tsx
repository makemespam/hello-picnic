'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Checkbox } from '@/components/Checkbox';
import { cn } from '@/components/cn';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Textarea } from '@/components/Textarea';
import { AI_PURPOSES, MEAL_STYLE_LABEL, MEAL_STYLES, PURPOSE_LABEL, RECIPE_TYPES, TYPE_LABEL, type AiPurpose } from '@/shared/labels';
import { DEFAULT_PANTRY, DEFAULT_PANTRY_KEYS } from '@/shared/pantry';
import { SECRET_KEYS, type AiModelOverrides, type HouseholdPrefs, type PublicSettingsDto, type SecretKey, type SettingsPutInput } from '@/shared/settings';
import { GoogleConnectCard } from './GoogleConnectCard';
import { PicnicConnectCard, type PicnicConnectCardProps } from './PicnicConnectCard';

// Plain, JSON-serializable shape of src/server/integrations/ai/models.ts' AiModel —
// re-declared locally (rather than importing the server module) so this client
// component never imports from src/server/* (docs/ARCHITECTURE.md §1 layering).
export interface ModelOption {
  id: string;
  provider: string;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
}

export interface InstellingenFormProps {
  initial: PublicSettingsDto;
  modelsByPurpose: Record<AiPurpose, ModelOption[]>;
  defaultModelIdByPurpose: Partial<Record<AiPurpose, string>>;
  initialPicnicStatus: PicnicConnectCardProps['initialStatus'];
  initialGoogleStatus: { connected: boolean; calendarId: string | null };
}

type SecretDraft = Record<SecretKey, string | null>;

function emptySecretDraft(): SecretDraft {
  return Object.fromEntries(SECRET_KEYS.map((key) => [key, ''])) as SecretDraft;
}

function configuredFlagsFrom(dto: PublicSettingsDto): Record<SecretKey, boolean> {
  return Object.fromEntries(SECRET_KEYS.map((key) => [key, dto[`${key}Configured`]])) as Record<SecretKey, boolean>;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-surface p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

type ProviderId = 'anthropic' | 'openai' | 'google' | 'deepseek';
type TestStatus = 'idle' | 'testing' | 'ok' | 'error';

interface AiTestResponse {
  ok: boolean;
  error?: string;
}

const TEST_ERROR_LABEL: Record<string, string> = {
  no_api_key: 'geen sleutel ingesteld',
  no_registered_model: 'nog geen geverifieerd model',
};

/** "Test verbinding" per provider (docs/workpackages/WP-05 §6) — POSTs to /api/ai/test. */
function TestConnectionButton({ provider }: { provider: ProviderId }) {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setStatus('testing');
    setError(null);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = (await res.json()) as AiTestResponse;
      setStatus(data.ok ? 'ok' : 'error');
      if (!data.ok) setError(data.error ? (TEST_ERROR_LABEL[data.error] ?? data.error) : 'onbekende fout');
    } catch {
      setStatus('error');
      setError('netwerkfout');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === 'testing'}
        className="h-9 shrink-0 rounded-full border border-ink/15 px-3 text-xs font-semibold text-ink hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'testing' ? 'Bezig…' : 'Test verbinding'}
      </button>
      {status === 'ok' && (
        <span className="text-xs font-medium text-success" role="status">
          ✓ Verbonden
        </span>
      )}
      {status === 'error' && (
        <span className="text-xs font-medium text-danger" role="status">
          ✗ {error}
        </span>
      )}
    </div>
  );
}

function SecretField({
  id,
  label,
  value,
  configured,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  configured: boolean;
  onChange: (value: string | null) => void;
}) {
  const cleared = value === null;
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          placeholder={configured ? '••••••••' : 'Nog niet ingesteld'}
          value={cleared ? '' : (value ?? '')}
          disabled={cleared}
          onChange={(event) => onChange(event.target.value)}
          className="flex-1"
        />
        {configured && !cleared && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-xs font-medium text-danger underline underline-offset-2"
          >
            Wissen
          </button>
        )}
        {cleared && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="shrink-0 text-xs font-medium text-primary underline underline-offset-2"
          >
            Ongedaan maken
          </button>
        )}
      </div>
      <p className={cn('mt-1 text-xs', cleared ? 'text-danger' : configured ? 'text-success' : 'text-ink-muted')}>
        {cleared ? 'Wordt gewist bij opslaan' : configured ? '✓ ingesteld' : 'Niet ingesteld'}
      </p>
    </Field>
  );
}

export function InstellingenForm({
  initial,
  modelsByPurpose,
  defaultModelIdByPurpose,
  initialPicnicStatus,
  initialGoogleStatus,
}: InstellingenFormProps) {
  const [prefs, setPrefs] = useState<HouseholdPrefs>(initial.householdPrefs);
  const [overrides, setOverrides] = useState<AiModelOverrides>(initial.aiModelOverrides);
  const [bringEmail, setBringEmail] = useState(initial.bringEmail);
  const [secrets, setSecrets] = useState<SecretDraft>(emptySecretDraft());
  const [configured, setConfigured] = useState(() => configuredFlagsFrom(initial));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  function setSecret(key: SecretKey, value: string | null) {
    setSecrets((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');

    const payload: SettingsPutInput = {
      householdPrefs: prefs,
      aiModelOverrides: overrides,
      bringEmail,
      ...secrets,
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`PUT /api/settings failed: ${res.status}`);
      const data = (await res.json()) as PublicSettingsDto;

      setPrefs(data.householdPrefs);
      setOverrides(data.aiModelOverrides);
      setBringEmail(data.bringEmail);
      setSecrets(emptySecretDraft());
      setConfigured(configuredFlagsFrom(data));
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-8">
      <Card title="Gezinsvoorkeuren" description="Bepaalt hoe het weekmenu wordt samengesteld.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Aantal maaltijden per week" htmlFor="mealCount">
            <Select
              id="mealCount"
              value={prefs.mealCount}
              onChange={(event) => setPrefs({ ...prefs, mealCount: Number(event.target.value) })}
            >
              {Array.from({ length: 7 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Aantal porties" htmlFor="servings">
            <Select
              id="servings"
              value={prefs.servings}
              onChange={(event) => setPrefs({ ...prefs, servings: Number(event.target.value) })}
            >
              {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Type recepten</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {RECIPE_TYPES.map((type) => (
              <Checkbox
                key={type}
                label={TYPE_LABEL[type]}
                checked={prefs.recipeTypes.includes(type)}
                onChange={() => setPrefs({ ...prefs, recipeTypes: toggle(prefs.recipeTypes, type) })}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Stijlvoorkeuren</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {MEAL_STYLES.map((style) => (
              <Checkbox
                key={style}
                label={MEAL_STYLE_LABEL[style]}
                checked={prefs.mealStyles.includes(style)}
                onChange={() => setPrefs({ ...prefs, mealStyles: toggle(prefs.mealStyles, style) })}
              />
            ))}
          </div>
        </fieldset>

        <Field label="Allergieën en harde uitsluitingen" htmlFor="allergies" hint="Nooit overtreden bij het plannen.">
          <Textarea
            id="allergies"
            value={prefs.allergies}
            onChange={(event) => setPrefs({ ...prefs, allergies: event.target.value })}
          />
        </Field>

        <Field label="Op te maken" htmlFor="useUp" hint="Producten die deze week verwerkt moeten worden.">
          <Textarea id="useUp" value={prefs.useUp} onChange={(event) => setPrefs({ ...prefs, useUp: event.target.value })} />
        </Field>

        <Checkbox
          label="Gesplitste eiwitten (basisgerecht + aparte vega-bereiding)"
          checked={prefs.proteinSplit}
          onChange={() => setPrefs({ ...prefs, proteinSplit: !prefs.proteinSplit })}
        />

        {prefs.proteinSplit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Aantal porties vlees/vis" htmlFor="proteinSplitMeatServings">
              <Input
                id="proteinSplitMeatServings"
                type="number"
                min={1}
                max={8}
                value={prefs.proteinSplitMeatServings}
                onChange={(event) => setPrefs({ ...prefs, proteinSplitMeatServings: Number(event.target.value) })}
              />
            </Field>
            <Field label="Aantal porties vega" htmlFor="proteinSplitVegaServings">
              <Input
                id="proteinSplitVegaServings"
                type="number"
                min={1}
                max={8}
                value={prefs.proteinSplitVegaServings}
                onChange={(event) => setPrefs({ ...prefs, proteinSplitVegaServings: Number(event.target.value) })}
              />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Richtprijs per portie (€)" htmlFor="targetCostPerServingCents" hint="Standaard € 3,50.">
            <Input
              id="targetCostPerServingCents"
              type="number"
              min={0}
              step={0.1}
              value={(prefs.targetCostPerServingCents / 100).toFixed(2)}
              onChange={(event) => setPrefs({ ...prefs, targetCostPerServingCents: Math.round(Number(event.target.value) * 100) })}
            />
          </Field>
          <Field label="Etenstijd" htmlFor="dinnerTime" hint="Voor 'start met koken om' op Vandaag.">
            <Input
              id="dinnerTime"
              type="time"
              value={prefs.dinnerTime}
              onChange={(event) => setPrefs({ ...prefs, dinnerTime: event.target.value })}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Vaste voorraad (kast)</legend>
          <p className="mb-2 text-xs text-ink-muted">Deze producten tellen niet mee als boodschap.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {DEFAULT_PANTRY_KEYS.map((key) => (
              <Checkbox
                key={key}
                label={DEFAULT_PANTRY[key] ?? key}
                checked={prefs.pantry.includes(key)}
                onChange={() => setPrefs({ ...prefs, pantry: toggle(prefs.pantry, key) })}
              />
            ))}
          </div>
        </fieldset>
      </Card>

      <Card title="AI per taak" description="Welk model voert elke AI-taak uit (docs/PROMPTS.md §7). WP-05 verbindt dit met echte aanroepen.">
        <div className="grid gap-4 sm:grid-cols-2">
          {AI_PURPOSES.map((purpose) => {
            const options = modelsByPurpose[purpose];
            const value = overrides[purpose] ?? defaultModelIdByPurpose[purpose] ?? '';
            return (
              <Field key={purpose} label={PURPOSE_LABEL[purpose]} htmlFor={`model-${purpose}`}>
                {options.length > 0 ? (
                  <Select
                    id={`model-${purpose}`}
                    value={value}
                    onChange={(event) => setOverrides({ ...overrides, [purpose]: event.target.value })}
                  >
                    {options.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.id} · {model.provider} (${model.inputPricePerMTok}/${model.outputPricePerMTok} per MTok)
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-sm italic text-ink-muted">Nog geen geverifieerd model beschikbaar (komt in WP-05).</p>
                )}
              </Field>
            );
          })}
        </div>
      </Card>

      <Card title="Picnic" description="Voor het vullen van de winkelmand.">
        <PicnicConnectCard initialEmail={initial.picnicEmail} initialStatus={initialPicnicStatus} />
      </Card>

      <Card title="Google Agenda" description="Voor kook-voorbereidingen als afspraak in de agenda.">
        <GoogleConnectCard initialConnected={initialGoogleStatus.connected} initialCalendarId={initial.googleCalendarId} />
      </Card>

      <Card title="Bring" description="Alternatief voor de boodschappenlijst.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mailadres" htmlFor="bringEmail">
            <Input id="bringEmail" type="email" value={bringEmail} onChange={(event) => setBringEmail(event.target.value)} />
          </Field>
          <SecretField
            id="bringPassword"
            label="Wachtwoord"
            value={secrets.bringPassword}
            configured={configured.bringPassword}
            onChange={(value) => setSecret('bringPassword', value)}
          />
        </div>
      </Card>

      <Card title="AI-providers" description="API-sleutels voor tekst-AI (plannen, scannen, valideren).">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <SecretField
              id="anthropicApiKey"
              label="Anthropic API-sleutel"
              value={secrets.anthropicApiKey}
              configured={configured.anthropicApiKey}
              onChange={(value) => setSecret('anthropicApiKey', value)}
            />
            <TestConnectionButton provider="anthropic" />
          </div>
          <div className="flex flex-col gap-2">
            <SecretField
              id="openaiApiKey"
              label="OpenAI API-sleutel"
              value={secrets.openaiApiKey}
              configured={configured.openaiApiKey}
              onChange={(value) => setSecret('openaiApiKey', value)}
            />
            <TestConnectionButton provider="openai" />
          </div>
          <div className="flex flex-col gap-2">
            <SecretField
              id="geminiApiKey"
              label="Google Gemini API-sleutel"
              value={secrets.geminiApiKey}
              configured={configured.geminiApiKey}
              onChange={(value) => setSecret('geminiApiKey', value)}
            />
            <TestConnectionButton provider="google" />
          </div>
          <div className="flex flex-col gap-2">
            <SecretField
              id="deepseekApiKey"
              label="DeepSeek API-sleutel"
              value={secrets.deepseekApiKey}
              configured={configured.deepseekApiKey}
              onChange={(value) => setSecret('deepseekApiKey', value)}
            />
            <TestConnectionButton provider="deepseek" />
          </div>
        </div>
      </Card>

      <Card title="Fotogeneratie" description="Losse sleutels, mogen afwijken van de tekst-AI-sleutels hierboven.">
        <div className="grid gap-4 sm:grid-cols-2">
          <SecretField
            id="imageOpenaiApiKey"
            label="OpenAI API-sleutel (foto's)"
            value={secrets.imageOpenaiApiKey}
            configured={configured.imageOpenaiApiKey}
            onChange={(value) => setSecret('imageOpenaiApiKey', value)}
          />
          <SecretField
            id="imageGeminiApiKey"
            label="Google Gemini API-sleutel (foto's)"
            value={secrets.imageGeminiApiKey}
            configured={configured.imageGeminiApiKey}
            onChange={(value) => setSecret('imageGeminiApiKey', value)}
          />
        </div>
      </Card>

      {status === 'saved' && <Alert variant="success">Instellingen opgeslagen.</Alert>}
      {status === 'error' && <Alert variant="danger">Opslaan is niet gelukt. Probeer het opnieuw.</Alert>}

      <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] flex justify-end md:static">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'saving' ? 'Bezig met opslaan…' : 'Wijzigingen opslaan'}
        </button>
      </div>
    </form>
  );
}
