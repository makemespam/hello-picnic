'use client';

// Per-card review form (docs/DESIGN_PRINCIPLES.md §5: "review form per card (photo
// left, editable form right)"): low-confidence fields get a warning border + icon,
// `issues` are listed, approve persists corrections and creates the library recipe
// (photo left / stacked on mobile via the grid below). Duplicate-title warnings render
// as an inline confirm (docs/workpackages/WP-08-card-scanning.md §6).
import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Checkbox } from '@/components/Checkbox';
import { cn } from '@/components/cn';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { PhotoFrame } from '@/components/PhotoFrame';
import { Select } from '@/components/Select';
import { Textarea } from '@/components/Textarea';
import {
  DIFFICULTY_LABEL,
  INGREDIENT_CATEGORIES,
  INGREDIENT_CATEGORY_LABEL,
  RECIPE_DIFFICULTIES,
  RECIPE_TYPES,
  TYPE_LABEL,
  type Difficulty,
  type IngredientCategory,
  type RecipeType,
} from '@/shared/labels';
import { slugify } from '@/shared/recipes';
import type { CardScanDto } from '@/shared/scans';

interface DraftIngredient {
  key: string;
  display: string;
  amount: number;
  unit: string;
  category: IngredientCategory;
  pantry: boolean;
  lowConfidence: boolean;
}

export interface ScanReviewCardProps {
  scan: CardScanDto;
  onApproved: (scanId: number) => void;
  onRejected: (scanId: number) => void;
  /** Called after a successful re-extraction request so the parent can refresh the board. */
  onRetried?: () => void;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

function confidenceWarnClass(isLow: boolean): string {
  return isLow ? 'border-warning ring-1 ring-warning/40' : '';
}

// --- Zod-issues -> leesbare Nederlandse regels (owner feedback 2026-07-13: "Opslaan is
// niet gelukt. Controleer de velden" zei niet WELKE velden — de approve-route stuurt de
// issues al mee, dit vertaalt ze) ---------------------------------------------------

interface ApiIssue {
  code?: string;
  path?: (string | number)[];
  type?: string;
  message?: string;
}

const ISSUE_FIELD_LABEL: Record<string, string> = {
  title: 'Titel',
  description: 'Omschrijving',
  type: 'Type',
  timeMin: 'Bereidingstijd',
  difficulty: 'Moeilijkheid',
  servingsBase: 'Porties',
  steps: 'Bereidingsstappen',
  ingredients: 'Ingrediënten',
  display: 'naam',
  nameKey: 'naam',
  amount: 'hoeveelheid',
  unit: 'eenheid',
  category: 'categorie',
};

function issueFieldLabel(path: (string | number)[]): string {
  if (path[0] === 'ingredients' && typeof path[1] === 'number') {
    const sub = typeof path[2] === 'string' ? ` — ${ISSUE_FIELD_LABEL[path[2]] ?? path[2]}` : '';
    return `Ingrediënt ${path[1] + 1}${sub}`;
  }
  if (path[0] === 'steps' && typeof path[1] === 'number') return `Stap ${path[1] + 1}`;
  const head = String(path[0] ?? '');
  return ISSUE_FIELD_LABEL[head] ?? head;
}

function issueProblem(issue: ApiIssue): string {
  if (issue.code === 'too_small') {
    if (issue.type === 'number') return 'moet groter dan 0 zijn';
    if (issue.type === 'array') return 'er is er minstens één nodig';
    return 'mag niet leeg zijn';
  }
  if (issue.code === 'too_big') return 'is te lang/te groot';
  if (issue.code === 'invalid_type') return 'is geen geldige waarde (leeg of geen getal?)';
  return issue.message ?? 'is ongeldig';
}

function describeIssues(issues: ApiIssue[]): string[] {
  return issues.slice(0, 6).map((issue) => `${issueFieldLabel(issue.path ?? [])}: ${issueProblem(issue)}`);
}

export function ScanReviewCard({ scan, onApproved, onRejected, onRetried }: ScanReviewCardProps) {
  const extraction = scan.extraction;

  const [title, setTitle] = useState(extraction?.title ?? '');
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Transient provider failures ("model experiencing high demand") deserve a one-tap
  // retry against the existing POST /api/scans/:id/extract endpoint instead of the old
  // advice to re-photograph the card (owner feedback 2026-07-13).
  async function handleRetryExtraction() {
    setRetrying(true);
    setRetryError(null);
    const { ok } = await fetchJson<unknown>(`/api/scans/${scan.id}/extract`, { method: 'POST' });
    setRetrying(false);
    if (!ok) {
      setRetryError('Opnieuw verwerken is niet gelukt — probeer het over een paar minuten nog eens.');
      return;
    }
    onRetried?.();
  }
  const [description, setDescription] = useState(extraction?.description ?? '');
  const [type, setType] = useState<RecipeType>((extraction?.type as RecipeType) ?? 'vegetarisch');
  const [timeMin, setTimeMin] = useState(extraction?.timeMin ?? 30);
  const [difficulty, setDifficulty] = useState<Difficulty>((extraction?.difficulty as Difficulty) ?? 'makkelijk');
  const [steps, setSteps] = useState<string[]>(extraction?.steps.length ? extraction.steps : ['']);
  const [ingredients, setIngredients] = useState<DraftIngredient[]>(
    (extraction?.ingredients ?? []).map((ing, index) => ({
      key: `${scan.id}-${index}`,
      display: ing.display,
      amount: ing.amount,
      unit: ing.unit,
      category: ing.category as IngredientCategory,
      pantry: ing.pantry,
      lowConfidence: extraction?.confidence[`ingredients[${index}].amount`] === 'low' || extraction?.confidence[`ingredients[${index}].unit`] === 'low',
    }))
  );
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ title: string; similarity: number } | null>(null);

  const confidence = extraction?.confidence ?? {};
  const isLow = (key: string) => confidence[key] === 'low' || confidence[key] === 'medium';

  function updateIngredient(key: string, patch: Partial<DraftIngredient>) {
    setIngredients((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function updateStep(index: number, value: string) {
    setSteps((rows) => rows.map((row, i) => (i === index ? value : row)));
  }

  async function submitApproval(confirmDuplicate: boolean) {
    setStatus('saving');
    setErrorMessage(null);

    const payload = {
      title: title.trim(),
      description: description.trim(),
      type,
      styles: [],
      timeMin,
      difficulty,
      servingsBase: extraction?.servingsBase ?? 4,
      steps: steps.map((s) => s.trim()).filter(Boolean),
      ingredients: ingredients
        .filter((row) => row.display.trim().length > 0)
        .map((row) => ({
          nameKey: slugify(row.display),
          display: row.display.trim(),
          amount: row.amount,
          unit: row.unit.trim(),
          category: row.category,
          pantry: row.pantry,
        })),
      confirmDuplicate,
    };

    const { ok, body } = await fetchJson<{
      status: 'approved' | 'duplicate';
      recipeId?: number;
      duplicate?: { title: string; similarity: number };
      error?: string;
      issues?: ApiIssue[];
    }>(`/api/scans/${scan.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

    if (!ok) {
      setStatus('error');
      // Naam WELKE velden mis zijn (de route stuurt de Zod-issues mee) in plaats van
      // alleen "controleer de velden" — owner feedback 2026-07-13. Een dienstfout
      // (bijv. "Deze scan is al afgehandeld.") is al Nederlands en gaat door zoals-is.
      if (body.issues && body.issues.length > 0) {
        setErrorMessage(`Opslaan is niet gelukt:\n${describeIssues(body.issues).join('\n')}`);
      } else if (body.error && !['invalid_input', 'invalid_json', 'invalid_id'].includes(body.error)) {
        setErrorMessage(`Opslaan is niet gelukt: ${body.error}`);
      } else {
        setErrorMessage('Opslaan is niet gelukt. Controleer de velden en probeer het opnieuw.');
      }
      return;
    }

    if (body.status === 'duplicate' && body.duplicate) {
      setDuplicate(body.duplicate);
      setStatus('idle');
      return;
    }

    setStatus('idle');
    setDuplicate(null);
    onApproved(scan.id);
  }

  async function handleReject() {
    setStatus('saving');
    const { ok } = await fetchJson(`/api/scans/${scan.id}/reject`, { method: 'POST' });
    setStatus('idle');
    if (ok) onRejected(scan.id);
  }

  return (
    <div data-testid="scan-review-card" className="grid grid-cols-1 gap-4 rounded-lg border border-ink/10 bg-surface p-4 shadow-sm md:grid-cols-[280px_1fr]">
      <div className="flex flex-col gap-2">
        <PhotoFrame src={scan.frontImage.url} alt={title || 'Receptkaart'} aspect="4:3" className="rounded-md" />
        {scan.backImage && <PhotoFrame src={scan.backImage.url} alt="Achterkant van de kaart" aspect="4:3" className="rounded-md" />}
      </div>

      <div className="flex flex-col gap-4">
        {scan.error && (
          <Alert variant="danger" title="Extractie mislukt">
            <p>{scan.error}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRetryExtraction}
                disabled={retrying}
                className="inline-flex h-9 items-center rounded-full bg-danger px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {retrying ? 'Bezig…' : '🔄 Opnieuw verwerken'}
              </button>
              <span className="text-xs">of vul de velden hieronder handmatig in.</span>
            </div>
            {retryError && <p className="mt-1 text-xs">{retryError}</p>}
          </Alert>
        )}
        {extraction && extraction.issues.length > 0 && (
          <Alert variant="warning" title="Let op bij het controleren">
            <ul className="list-inside list-disc">
              {extraction.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </Alert>
        )}
        {duplicate && (
          <Alert variant="warning" title="Lijkt op een bestaand recept">
            <p>
              &quot;{duplicate.title}&quot; ({Math.round(duplicate.similarity * 100)}% gelijk) staat al in de bibliotheek.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => submitApproval(true)}
                className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-hover"
              >
                Toch opslaan
              </button>
              <button
                type="button"
                onClick={() => setDuplicate(null)}
                className="inline-flex h-9 items-center rounded-full border border-ink/15 px-4 text-xs font-semibold text-ink hover:bg-ink/5"
              >
                Annuleren
              </button>
            </div>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Titel" htmlFor={`title-${scan.id}`} required>
            <Input
              id={`title-${scan.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={cn(confidenceWarnClass(isLow('title')))}
            />
            {isLow('title') && <p className="mt-1 flex items-center gap-1 text-xs text-warning">⚠️ Lage betrouwbaarheid — controleer.</p>}
          </Field>
          <Field label="Type" htmlFor={`type-${scan.id}`} required>
            <Select
              id={`type-${scan.id}`}
              value={type}
              onChange={(event) => setType(event.target.value as RecipeType)}
              className={cn(confidenceWarnClass(isLow('type')))}
            >
              {RECIPE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bereidingstijd (minuten)" htmlFor={`time-${scan.id}`} required>
            <Input
              id={`time-${scan.id}`}
              type="number"
              min={1}
              max={600}
              value={timeMin}
              onChange={(event) => setTimeMin(Number(event.target.value))}
              className={cn(confidenceWarnClass(isLow('timeMin')))}
            />
            {isLow('timeMin') && <p className="mt-1 flex items-center gap-1 text-xs text-warning">⚠️ Lage betrouwbaarheid — controleer.</p>}
          </Field>
          <Field label="Moeilijkheid" htmlFor={`difficulty-${scan.id}`} required>
            <Select
              id={`difficulty-${scan.id}`}
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as Difficulty)}
              className={cn(confidenceWarnClass(isLow('difficulty')))}
            >
              {RECIPE_DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Omschrijving" htmlFor={`description-${scan.id}`}>
          <Textarea id={`description-${scan.id}`} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>

        {extraction && <p className="text-xs text-ink-muted">Hoeveelheden zijn herberekend van {extraction.cardServings} (kaart) naar {extraction.servingsBase} porties.</p>}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">Ingrediënten</h3>
          {/* Vaste smalle kolommen voor aantal/eenheid en minmax(0,1fr) voor de naam:
              met auto-kolommen bepaalden de LABELS ("Hoeveelheid"/"Eenheid") de
              kolombreedte, waardoor de naam op een telefoon tot ±2 tekens werd
              geplet (owner feedback 2026-07-13). Kortere labels + min-w-0 zodat de
              naam alle resterende ruimte krijgt. */}
          {ingredients.map((row) => (
            <div
              key={row.key}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_4.5rem_4rem] items-end gap-2 rounded-md border border-transparent p-1.5',
                row.lowConfidence && 'border-warning ring-1 ring-warning/40'
              )}
            >
              <Field label="Naam" htmlFor={`ing-display-${row.key}`} className="min-w-0">
                <Input id={`ing-display-${row.key}`} value={row.display} onChange={(event) => updateIngredient(row.key, { display: event.target.value })} />
              </Field>
              <Field label="Aantal" htmlFor={`ing-amount-${row.key}`}>
                <Input
                  id={`ing-amount-${row.key}`}
                  type="number"
                  min={0}
                  step={0.1}
                  value={row.amount}
                  onChange={(event) => updateIngredient(row.key, { amount: Number(event.target.value) })}
                />
              </Field>
              <Field label="Eenheid" htmlFor={`ing-unit-${row.key}`}>
                <Input id={`ing-unit-${row.key}`} value={row.unit} onChange={(event) => updateIngredient(row.key, { unit: event.target.value })} />
              </Field>
              {row.lowConfidence && <p className="col-span-3 -mt-1 flex items-center gap-1 text-xs text-warning">⚠️ Lage betrouwbaarheid — controleer.</p>}
              <Field label="Categorie" htmlFor={`ing-cat-${row.key}`} className="col-span-2">
                <Select id={`ing-cat-${row.key}`} value={row.category} onChange={(event) => updateIngredient(row.key, { category: event.target.value as IngredientCategory })}>
                  {INGREDIENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {INGREDIENT_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Checkbox label="Voorraad" checked={row.pantry} onChange={() => updateIngredient(row.key, { pantry: !row.pantry })} />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">Bereidingsstappen</h3>
          {steps.map((step, index) => (
            <Textarea key={index} aria-label={`Stap ${index + 1}`} value={step} onChange={(event) => updateStep(index, event.target.value)} rows={2} />
          ))}
        </div>

        {status === 'error' && errorMessage && (
          <Alert variant="danger">
            <span className="whitespace-pre-line">{errorMessage}</span>
          </Alert>
        )}

        <div className="flex justify-end gap-2 border-t border-ink/10 pt-3">
          <button
            type="button"
            onClick={handleReject}
            disabled={status === 'saving'}
            className="inline-flex h-11 items-center justify-center rounded-full border border-ink/15 px-5 text-sm font-semibold text-danger hover:bg-danger/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Afkeuren
          </button>
          <button
            type="button"
            onClick={() => submitApproval(false)}
            disabled={status === 'saving'}
            className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'saving' ? 'Bezig…' : 'Goedkeuren'}
          </button>
        </div>
      </div>
    </div>
  );
}
