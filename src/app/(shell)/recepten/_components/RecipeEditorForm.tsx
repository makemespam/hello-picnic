'use client';

// Manual recipe editor (docs/workpackages/WP-04-recipe-domain-migration.md §5): shared
// between /recepten/nieuw (create) and /recepten/:id/bewerken (edit) — same fields,
// same submit shape, just a different HTTP verb/target and initial values.
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Checkbox } from '@/components/Checkbox';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { PhotoFrame } from '@/components/PhotoFrame';
import { Select } from '@/components/Select';
import { Textarea } from '@/components/Textarea';
import {
  DIFFICULTY_LABEL,
  INGREDIENT_CATEGORIES,
  INGREDIENT_CATEGORY_LABEL,
  MEAL_STYLE_LABEL,
  MEAL_STYLES,
  PRODUCT_PREFERENCE_LABEL,
  PRODUCT_PREFERENCES,
  RECIPE_DIFFICULTIES,
  RECIPE_TYPES,
  TYPE_LABEL,
  type Difficulty,
  type IngredientCategory,
  type MealStyle,
  type ProductPreference,
  type RecipeType,
} from '@/shared/labels';
import type { IngredientInput, RecipeDetailDto } from '@/shared/recipes';

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface DraftIngredient extends Omit<IngredientInput, 'nameKey'> {
  key: string; // client-only React key, stable across reorders
}

function emptyIngredient(): DraftIngredient {
  return { key: crypto.randomUUID(), display: '', amount: 1, unit: 'g', category: 'overig', pantry: false };
}

export interface RecipeEditorFormProps {
  mode: 'create' | 'edit';
  initial?: RecipeDetailDto;
}

export function RecipeEditorForm({ mode, initial }: RecipeEditorFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [type, setType] = useState<RecipeType>(initial?.type ?? 'vegetarisch');
  const [styles, setStyles] = useState<MealStyle[]>(initial?.styles ?? []);
  const [timeMin, setTimeMin] = useState(initial?.timeMin ?? 30);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'makkelijk');
  const [servingsBase, setServingsBase] = useState(initial?.servingsBase ?? 4);
  const [steps, setSteps] = useState<string[]>(initial?.steps.length ? initial.steps : ['']);
  const [ingredients, setIngredients] = useState<DraftIngredient[]>(
    initial?.ingredients.length
      ? initial.ingredients.map((ing) => ({ ...ing, key: crypto.randomUUID() }))
      : [emptyIngredient()]
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function toggleStyle(style: MealStyle) {
    setStyles((current) => (current.includes(style) ? current.filter((s) => s !== style) : [...current, style]));
  }

  function updateIngredient(key: string, patch: Partial<DraftIngredient>) {
    setIngredients((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeIngredient(key: string) {
    setIngredients((rows) => (rows.length > 1 ? rows.filter((row) => row.key !== key) : rows));
  }

  function updateStep(index: number, value: string) {
    setSteps((rows) => rows.map((row, i) => (i === index ? value : row)));
  }

  function removeStep(index: number) {
    setSteps((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));
  }

  function handlePhotoChange(file: File | null) {
    setPhotoFile(file);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    setErrorMessage(null);

    const payload = {
      source: (initial?.source ?? 'manual') as 'manual' | 'card' | 'ai',
      title: title.trim(),
      description: description.trim(),
      type,
      styles,
      timeMin,
      difficulty,
      servingsBase,
      steps: steps.map((s) => s.trim()).filter(Boolean),
      ingredients: ingredients
        .filter((row) => row.display.trim().length > 0)
        .map((row) => ({
          nameKey: slugify(row.display),
          display: row.display.trim(),
          amount: row.amount,
          unit: row.unit.trim(),
          category: row.category,
          productPreference: row.productPreference,
          pantry: row.pantry,
        })),
    };

    const form = new FormData();
    form.set('data', JSON.stringify(payload));
    if (photoFile) form.set('photo', photoFile);

    const url = mode === 'create' ? '/api/recipes' : `/api/recipes/${initial!.id}`;
    const method = mode === 'create' ? 'POST' : 'PATCH';

    try {
      const res = await fetch(url, { method, body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${method} ${url} faalde: ${res.status}`);
      }
      const saved = await res.json();
      router.push(`/recepten/${saved.id}`);
      router.refresh();
    } catch {
      setStatus('error');
      setErrorMessage('Opslaan is niet gelukt. Controleer de velden en probeer het opnieuw.');
    }
  }

  const currentPhoto = photoPreviewUrl ?? initial?.photoUrlLarge ?? null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-8">
      <section className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Foto</h2>
        <PhotoFrame src={currentPhoto} alt={title || 'Nieuw recept'} aspect="4:3" className="max-w-xs" />
        <Field label="Kies een foto" htmlFor="photo" hint="Wordt automatisch verkleind (640/1280 breed) met een blur-up voorbeeld.">
          <input
            id="photo"
            type="file"
            accept="image/*"
            onChange={(event) => handlePhotoChange(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink-muted file:mr-3 file:h-9 file:rounded-full file:border-0 file:bg-primary-soft file:px-4 file:text-sm file:font-semibold file:text-primary"
          />
        </Field>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Basisgegevens</h2>
        <Field label="Titel" htmlFor="title" required>
          <Input id="title" required value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Omschrijving" htmlFor="description">
          <Textarea id="description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="type" required>
            <Select id="type" value={type} onChange={(event) => setType(event.target.value as RecipeType)}>
              {RECIPE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Moeilijkheid" htmlFor="difficulty" required>
            <Select id="difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
              {RECIPE_DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bereidingstijd (minuten)" htmlFor="timeMin" required>
            <Input
              id="timeMin"
              type="number"
              min={1}
              max={600}
              required
              value={timeMin}
              onChange={(event) => setTimeMin(Number(event.target.value))}
            />
          </Field>
          <Field label="Aantal porties (basis)" htmlFor="servingsBase" required>
            <Input
              id="servingsBase"
              type="number"
              min={1}
              max={12}
              required
              value={servingsBase}
              onChange={(event) => setServingsBase(Number(event.target.value))}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Stijlvoorkeuren</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {MEAL_STYLES.map((style) => (
              <Checkbox key={style} label={MEAL_STYLE_LABEL[style]} checked={styles.includes(style)} onChange={() => toggleStyle(style)} />
            ))}
          </div>
        </fieldset>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-surface p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Ingrediënten</h2>
          <button
            type="button"
            onClick={() => setIngredients((rows) => [...rows, emptyIngredient()])}
            className="inline-flex h-9 items-center rounded-full border border-ink/15 px-3 text-xs font-semibold text-ink hover:border-ink/30"
          >
            + Ingrediënt
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {ingredients.map((row) => (
            <div key={row.key} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2 border-b border-ink/10 pb-3 last:border-0">
              <Field label="Naam" htmlFor={`ing-display-${row.key}`}>
                <Input
                  id={`ing-display-${row.key}`}
                  required
                  value={row.display}
                  onChange={(event) => updateIngredient(row.key, { display: event.target.value })}
                  placeholder="bv. Kokosmelk"
                />
              </Field>
              <Field label="Hoeveelheid" htmlFor={`ing-amount-${row.key}`}>
                <Input
                  id={`ing-amount-${row.key}`}
                  type="number"
                  min={0}
                  step={0.1}
                  className="w-24"
                  value={row.amount}
                  onChange={(event) => updateIngredient(row.key, { amount: Number(event.target.value) })}
                />
              </Field>
              <Field label="Eenheid" htmlFor={`ing-unit-${row.key}`}>
                <Input
                  id={`ing-unit-${row.key}`}
                  className="w-20"
                  value={row.unit}
                  onChange={(event) => updateIngredient(row.key, { unit: event.target.value })}
                  placeholder="g"
                />
              </Field>
              <button
                type="button"
                onClick={() => removeIngredient(row.key)}
                aria-label="Verwijder ingrediënt"
                className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-ink/5"
              >
                ✕
              </button>
              <Field label="Categorie" htmlFor={`ing-cat-${row.key}`} className="col-span-2">
                <Select
                  id={`ing-cat-${row.key}`}
                  value={row.category}
                  onChange={(event) => updateIngredient(row.key, { category: event.target.value as IngredientCategory })}
                >
                  {INGREDIENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {INGREDIENT_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Voorkeur" htmlFor={`ing-pref-${row.key}`} className="col-span-2">
                <Select
                  id={`ing-pref-${row.key}`}
                  value={row.productPreference ?? ''}
                  onChange={(event) =>
                    updateIngredient(row.key, { productPreference: (event.target.value || undefined) as ProductPreference | undefined })
                  }
                >
                  <option value="">Geen voorkeur</option>
                  {PRODUCT_PREFERENCES.map((p) => (
                    <option key={p} value={p}>
                      {PRODUCT_PREFERENCE_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Checkbox
                label="Voorraad"
                checked={row.pantry}
                onChange={() => updateIngredient(row.key, { pantry: !row.pantry })}
                className="col-span-2"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-surface p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Bereidingsstappen</h2>
          <button
            type="button"
            onClick={() => setSteps((rows) => [...rows, ''])}
            className="inline-flex h-9 items-center rounded-full border border-ink/15 px-3 text-xs font-semibold text-ink hover:border-ink/30"
          >
            + Stap
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="mt-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
                {index + 1}
              </span>
              <Textarea
                aria-label={`Stap ${index + 1}`}
                value={step}
                onChange={(event) => updateStep(index, event.target.value)}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => removeStep(index)}
                aria-label={`Verwijder stap ${index + 1}`}
                className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-ink/5"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {status === 'error' && errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] flex justify-end md:static">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'saving' ? 'Bezig met opslaan…' : mode === 'create' ? 'Recept opslaan' : 'Wijzigingen opslaan'}
        </button>
      </div>
    </form>
  );
}
