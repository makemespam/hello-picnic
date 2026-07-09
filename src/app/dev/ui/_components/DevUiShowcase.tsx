'use client';

import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { BottomNav } from '@/components/BottomNav';
import { Checkbox } from '@/components/Checkbox';
import { CostBadge } from '@/components/CostBadge';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { PageHeader } from '@/components/PageHeader';
import { PhotoFrame } from '@/components/PhotoFrame';
import { ProgressList, type ProgressItemData } from '@/components/ProgressList';
import { RadioCard } from '@/components/RadioCard';
import { RecipeCard, type RecipeCardData } from '@/components/RecipeCard';
import { RecipeTypeBadge } from '@/components/RecipeTypeBadge';
import { Select } from '@/components/Select';
import { Sheet } from '@/components/Sheet';
import { Sidebar } from '@/components/Sidebar';
import { Skeleton, SkeletonCard, SkeletonDetail, SkeletonList } from '@/components/Skeleton';
import { Stars } from '@/components/Stars';
import { StepperList } from '@/components/StepperList';
import { Textarea } from '@/components/Textarea';
import { TopBar } from '@/components/TopBar';
import type { RecipeType } from '@/shared/labels';

const RECIPE_TYPES: RecipeType[] = ['vegan', 'vegetarisch', 'vis', 'kip', 'rund', 'varken'];

const SAMPLE_RECIPE: RecipeCardData = {
  id: 'demo-1',
  title: 'Orzosalade met halloumi en geroosterde paprika',
  photoUrl: null,
  type: 'vegetarisch',
  timeMin: 25,
  rating: 4,
};

const PROGRESS_ITEMS: ProgressItemData[] = [
  { id: '1', label: 'Kaart 1 · voorkant', status: 'done' },
  { id: '2', label: 'Kaart 1 · achterkant', status: 'active' },
  { id: '3', label: 'Kaart 2 · voorkant', status: 'pending' },
  { id: '4', label: 'Kaart 2 · achterkant', status: 'error', detail: 'Onscherpe foto' },
];

const COOK_STEPS = [
  'Kook de orzo volgens de verpakking beetgaar en giet af.',
  'Rooster de paprika in blokjes op hoog vuur, 6-8 minuten.',
  'Meng orzo, paprika en halloumi, breng op smaak met citroen en olijfolie.',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-ink/10 py-8 first:border-t-0 first:pt-0">
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function DevUiShowcase() {
  const [rating, setRating] = useState(3);
  const [servings, setServings] = useState('4');
  const [checked, setChecked] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-8 pb-24 md:px-6 md:pb-8">
      <h1 className="text-3xl font-bold text-ink">/dev/ui — componentenoverzicht</h1>
      <p className="text-sm text-ink-muted">
        Dev-only showcase (404 in productie) — elk component uit docs/DESIGN_PRINCIPLES.md §3 in elke staat.
      </p>

      <Section title="RecipeTypeBadge">
        <div className="flex flex-wrap gap-2">
          {RECIPE_TYPES.map((type) => (
            <RecipeTypeBadge key={type} type={type} />
          ))}
        </div>
      </Section>

      <Section title="Stars">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-ink-muted">Alleen-lezen:</span>
            <Stars value={0} />
            <Stars value={2.5} />
            <Stars value={5} size="md" />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-ink-muted">Interactief (pijltjestoetsen werken):</span>
            <Stars value={rating} size="md" onChange={setRating} label="Jouw beoordeling" />
          </div>
        </div>
      </Section>

      <Section title="PhotoFrame">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <PhotoFrame src={null} alt="Zonder foto (fallback)" aspect="4:3" className="rounded-lg" />
          <PhotoFrame src="https://picsum.photos/seed/hellopicnic1/640/480" alt="Voorbeeldgerecht" aspect="4:3" className="rounded-lg" />
          <PhotoFrame src="https://picsum.photos/seed/hellopicnic2/640/640" alt="Voorbeeldgerecht vierkant" aspect="1:1" className="rounded-lg" />
          <PhotoFrame src="https://picsum.photos/seed/hellopicnic3/960/540" alt="Voorbeeldgerecht breed" aspect="16:9" className="rounded-lg" />
        </div>
      </Section>

      <Section title="RecipeCard">
        <div className="grid max-w-xs grid-cols-1 gap-4 sm:max-w-none sm:grid-cols-3">
          <RecipeCard recipe={SAMPLE_RECIPE} />
          <RecipeCard recipe={{ ...SAMPLE_RECIPE, id: 'demo-2', type: 'kip', rating: 5 }} href="/recepten" />
          <RecipeCard recipe={{ ...SAMPLE_RECIPE, id: 'demo-3', type: 'vis', rating: 0, title: 'Kort' }} />
        </div>
      </Section>

      <Section title="Alert (variant)">
        <div className="flex flex-col gap-3">
          <Alert variant="info" title="Info">Je kunt dit later nog aanpassen in instellingen.</Alert>
          <Alert variant="success" title="Gelukt">Weekmenu opgeslagen in de bibliotheek.</Alert>
          <Alert variant="warning" title="Let op">Twee ingrediënten zijn niet gevonden bij Picnic.</Alert>
          <Alert
            variant="danger"
            title="Picnic wil dat je opnieuw inlogt"
            action={
              <button type="button" className="inline-flex h-9 items-center rounded-full bg-danger px-4 text-xs font-semibold text-white">
                Opnieuw inloggen
              </button>
            }
          >
            Je sessie is verlopen.
          </Alert>
        </div>
      </Section>

      <Section title="Skeleton set (card / list / detail)">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonList rows={3} />
          <SkeletonDetail />
        </div>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          illustration="📖"
          title="Nog geen recepten"
          description="Scan straks jullie HelloFresh-kaarten of voeg recepten handmatig toe."
          action={{ label: 'Scan kaarten', onClick: () => setSheetOpen(true) }}
        />
      </Section>

      <Section title="Field / Input / Select / Textarea / Checkbox / RadioCard">
        <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Aantal porties" htmlFor="dev-servings" hint="Tussen 1 en 8">
            <Input id="dev-servings" type="number" min={1} max={8} value={servings} onChange={(e) => setServings(e.target.value)} />
          </Field>
          <Field label="Moeilijkheid" htmlFor="dev-difficulty">
            <Select id="dev-difficulty" defaultValue="gemiddeld">
              <option value="makkelijk">Makkelijk</option>
              <option value="gemiddeld">Gemiddeld</option>
              <option value="uitdagend">Uitdagend</option>
            </Select>
          </Field>
          <Field label="E-mailadres" htmlFor="dev-email-error" error="Vul een geldig e-mailadres in">
            <Input id="dev-email-error" type="email" defaultValue="niet-geldig" />
          </Field>
          <Field label="Wensen voor deze week" htmlFor="dev-wishes">
            <Textarea id="dev-wishes" placeholder="Bijv. geen pittig, één keer vis" />
          </Field>
        </div>
        <div className="flex flex-col gap-3">
          <Checkbox label="Gebruik agenda om kookdagen te bepalen" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <Checkbox label="Uitgeschakeld" disabled />
        </div>
        <div className="grid max-w-md grid-cols-1 gap-2">
          {(['4', '6', '8'] as const).map((n) => (
            <RadioCard
              key={n}
              name="dev-servings-radio"
              value={n}
              label={`${n} porties`}
              description={n === '4' ? 'Standaard voor het gezin' : undefined}
              checked={servings === n}
              onChange={() => setServings(n)}
            />
          ))}
        </div>
      </Section>

      <Section title="StepperList (cooking steps)">
        <StepperList steps={COOK_STEPS} activeIndex={1} />
      </Section>

      <Section title="ProgressList (per-item async status)">
        <ProgressList items={PROGRESS_ITEMS} />
      </Section>

      <Section title="CostBadge">
        <div className="flex items-center gap-2">
          <CostBadge cents={0} />
          <CostBadge cents={6140} />
          <CostBadge cents={123456} />
        </div>
      </Section>

      <Section title="PageHeader">
        <div className="rounded-lg border border-ink/10 p-4">
          <PageHeader
            title="Orzosalade met halloumi"
            description="Vegetarisch · 25 min · Gemiddeld"
            action={
              <button type="button" className="inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-white">
                Zet in weekplan
              </button>
            }
          />
          <p className="text-sm text-ink-muted">Content-area header — TopBar boven in de schil draagt de pagina-h1.</p>
        </div>
      </Section>

      <Section title="Sheet">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="inline-flex h-11 w-fit items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          Open sheet
        </button>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Kies porties">
          <div className="flex flex-col gap-2">
            {(['2', '4', '6', '8'] as const).map((n) => (
              <RadioCard
                key={n}
                name="dev-sheet-servings"
                value={n}
                label={`${n} porties`}
                checked={servings === n}
                onChange={() => setServings(n)}
              />
            ))}
          </div>
        </Sheet>
      </Section>

      <Section title="TopBar / Sidebar / BottomNav">
        <p className="text-sm text-ink-muted">
          Dit zijn de echte, functionele navigatiecomponenten — dezelfde die de rest van de app gebruikt. De
          tabbalk is hieronder aan de pagina bevestigd (mobiel); de sidebar hiernaast (vanaf 768px).
        </p>
        <div className="overflow-hidden rounded-lg border border-ink/10">
          <TopBar title="Voorbeeldtitel" />
        </div>
        <div className="overflow-hidden rounded-lg border border-ink/10">
          <Sidebar />
        </div>
      </Section>
    </div>
  );
}

/** Rendered once, outside the scrollable container, since BottomNav is `fixed`. */
export function DevUiBottomNav() {
  return <BottomNav />;
}
