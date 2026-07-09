// API/integration layer (docs/TESTING.md §1: "route handlers with a real Postgres") —
// publishPlan/unpublishPlan write through plan_meals + settings (real Postgres); the
// Google network boundary runs in FAKE_GOOGLE=1 fixture mode so the idempotency
// assertion can inspect fakeGoogle's real call log (docs/workpackages/WP-12-google-
// calendar.md §7: "publish idempotency — second publish updates not duplicates (fixture
// call-log assert)") instead of a hand-rolled fetch mock.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens, planMeals, plans, recipeIngredients, recipes, settings } from '@/server/db/schema';
import { getFakeGoogleCallLog, resetFakeGoogleState } from '@/server/integrations/google/fakeGoogle';
import { createRecipe } from '@/server/services/recipeService';
import { putGoogleCalendarId, putHouseholdPrefs } from '@/server/services/settingsService';
import type { RecipeCreateInput } from '@/shared/recipes';
import {
  buildEventPayload,
  CalendarServiceError,
  mapFreeBusyToDayHints,
  publishPlan,
  unpublishPlan,
} from './calendarService';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV, FAKE_GOOGLE: '1', APP_BASE_URL: 'https://eten.example.nl' };
  resetFakeGoogleState();
  const db = getDb();
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(integrationTokens);
  await db.delete(settings);
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(integrationTokens);
  await db.delete(settings);
});

async function seedConnectedGoogleToken() {
  const db = getDb();
  await db.insert(integrationTokens).values({
    provider: 'google',
    payloadEncrypted: encryptSecret(JSON.stringify({ accessToken: 'fake-access-token', refreshToken: 'fake-refresh-token' })),
    expiresAt: new Date(Date.now() + 3600_000),
  });
}

async function seedRecipe(title: string, timeMin: number): Promise<number> {
  const input: RecipeCreateInput = {
    source: 'manual',
    title,
    description: '',
    type: 'vegetarisch',
    styles: [],
    timeMin,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Snijd de groenten.', 'Verhit de pan.', 'Voeg alles toe en roerbak.', 'Serveer warm.'],
    ingredients: [{ nameKey: 'ing', display: 'Ingrediënt', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
  };
  const recipe = await createRecipe(input);
  return recipe.id;
}

async function seedPlanWithMeal(recipeId: number, cookDate: string | null): Promise<{ planId: number; mealId: number }> {
  const db = getDb();
  const [plan] = await db.insert(plans).values({ weekStart: '2026-07-06', servings: 4, mealCount: 1, status: 'final' }).returning();
  const [meal] = await db.insert(planMeals).values({ planId: plan!.id, recipeId, slotIndex: 0, cookDate, approved: true }).returning();
  return { planId: plan!.id, mealId: meal!.id };
}

describe('buildEventPayload', () => {
  it('builds the title, deep link + first 3 steps, and the DST-correct start/end window', () => {
    const payload = buildEventPayload({
      recipeId: 42,
      recipeTitle: 'Orzosalade',
      recipeSteps: ['Kook de orzo.', 'Snijd de groenten.', 'Meng alles.', 'Een vijfde stap die niet meegaat.'],
      cookDate: '2026-07-08',
      dinnerTime: '18:00',
      prepMinutes: 25,
    });

    expect(payload.summary).toBe('🍳 Orzosalade bereiden');
    expect(payload.description).toContain('https://eten.example.nl/recepten/42');
    expect(payload.description).toContain('1. Kook de orzo.');
    expect(payload.description).toContain('2. Snijd de groenten.');
    expect(payload.description).toContain('3. Meng alles.');
    expect(payload.description).not.toContain('vijfde stap');
    expect(payload.start.timeZone).toBe('Europe/Amsterdam');
    // 18:00 - 25min = 17:35 (already 5-aligned) -> CEST -> 15:35 UTC.
    expect(payload.start.dateTime).toBe('2026-07-08T15:35:00.000Z');
    expect(payload.end.dateTime).toBe('2026-07-08T16:00:00.000Z'); // + 25 min
  });
});

describe('mapFreeBusyToDayHints', () => {
  it('flags a day busy only when an interval overlaps its 17:00-20:00 Amsterdam evening window', () => {
    const days = ['2026-07-06', '2026-07-07', '2026-07-08'];
    const hints = mapFreeBusyToDayHints(days, [
      { start: '2026-07-07T16:30:00Z', end: '2026-07-07T17:15:00Z' }, // 18:30-19:15 local -> overlaps
    ]);
    expect(hints).toEqual([
      { date: '2026-07-06', busy: false },
      { date: '2026-07-07', busy: true },
      { date: '2026-07-08', busy: false },
    ]);
  });

  it('does not flag an interval that ends exactly at the evening window start', () => {
    const hints = mapFreeBusyToDayHints(['2026-07-06'], [{ start: '2026-07-06T14:00:00Z', end: '2026-07-06T15:00:00Z' }]);
    expect(hints).toEqual([{ date: '2026-07-06', busy: false }]);
  });
});

describe('publishPlan', () => {
  it('throws CalendarServiceError when no calendar is chosen', async () => {
    const recipeId = await seedRecipe('Orzosalade', 25);
    const { planId } = await seedPlanWithMeal(recipeId, '2026-07-08');
    await expect(publishPlan(planId)).rejects.toThrow(CalendarServiceError);
  });

  it('creates one event per cook_date meal and skips meals without a cook_date', async () => {
    await seedConnectedGoogleToken();
    await putGoogleCalendarId('primary');
    await putHouseholdPrefs({ dinnerTime: '18:00' });

    const recipeId = await seedRecipe('Orzosalade', 25);
    const { planId, mealId } = await seedPlanWithMeal(recipeId, '2026-07-08');
    const unassignedRecipeId = await seedRecipe('Ongepland gerecht', 20);
    const db = getDb();
    await db.insert(planMeals).values({ planId, recipeId: unassignedRecipeId, slotIndex: 1, cookDate: null, approved: true });

    const result = await publishPlan(planId);
    expect(result).toEqual({ published: 1, skipped: 1 });

    const [mealRow] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    expect(mealRow?.calendarEventId).toMatch(/^fake-event-/);

    const createCalls = getFakeGoogleCallLog().filter((call) => call.method === 'POST' && call.url.includes('/events'));
    expect(createCalls).toHaveLength(1);

    // docs/workpackages/WP-12 §7: "Finalize + publish -> correct events (fixture
    // asserts title/time/description)" — inspect the actual payload sent to the fake
    // Google API, not just the local calendar_event_id bookkeeping.
    const sentPayload = createCalls[0]?.body as { summary: string; description: string; start: { dateTime: string } };
    expect(sentPayload.summary).toBe('🍳 Orzosalade bereiden');
    expect(sentPayload.description).toContain('/recepten/');
    expect(sentPayload.start.dateTime).toBe('2026-07-08T15:35:00.000Z'); // 18:00 - 25min = 17:35 CEST -> 15:35 UTC
  });

  it('re-publishing updates the existing event instead of creating a duplicate', async () => {
    await seedConnectedGoogleToken();
    await putGoogleCalendarId('primary');
    await putHouseholdPrefs({ dinnerTime: '18:00' });

    const recipeId = await seedRecipe('Orzosalade', 25);
    const { planId, mealId } = await seedPlanWithMeal(recipeId, '2026-07-08');

    const first = await publishPlan(planId);
    expect(first.published).toBe(1);
    const db = getDb();
    const [afterFirst] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    const eventIdAfterFirst = afterFirst?.calendarEventId;
    expect(eventIdAfterFirst).toBeTruthy();

    const second = await publishPlan(planId);
    expect(second.published).toBe(1);
    const [afterSecond] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    expect(afterSecond?.calendarEventId).toBe(eventIdAfterFirst); // same event id — updated, not replaced

    const createCalls = getFakeGoogleCallLog().filter((call) => call.method === 'POST' && call.url.includes('/events'));
    const updateCalls = getFakeGoogleCallLog().filter((call) => call.method === 'PUT' && call.url.includes('/events/'));
    expect(createCalls).toHaveLength(1); // exactly one create, ever
    expect(updateCalls).toHaveLength(1); // the second publish updated instead of creating
  });

  it('a meal replaced after publish keeps its calendar_event_id, so the next publish updates it', async () => {
    await seedConnectedGoogleToken();
    await putGoogleCalendarId('primary');
    await putHouseholdPrefs({ dinnerTime: '18:00' });

    const recipeId = await seedRecipe('Orzosalade', 25);
    const { planId, mealId } = await seedPlanWithMeal(recipeId, '2026-07-08');
    await publishPlan(planId);

    const db = getDb();
    const [published] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    const eventId = published?.calendarEventId;

    // Simulate replaceMeal swapping in a different recipe on the same plan_meals row
    // (planService.replaceMeal never touches calendar_event_id — see its own comment).
    const newRecipeId = await seedRecipe('Kruidige linzensoep', 20);
    await db.update(planMeals).set({ recipeId: newRecipeId }).where(eq(planMeals.id, mealId));

    await publishPlan(planId);
    const [afterRepublish] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    expect(afterRepublish?.calendarEventId).toBe(eventId);

    const updateCalls = getFakeGoogleCallLog().filter((call) => call.method === 'PUT' && call.url.includes('/events/'));
    expect(updateCalls).toHaveLength(1);
  });
});

describe('unpublishPlan', () => {
  it('deletes the Google event and clears calendar_event_id', async () => {
    await seedConnectedGoogleToken();
    await putGoogleCalendarId('primary');
    await putHouseholdPrefs({ dinnerTime: '18:00' });

    const recipeId = await seedRecipe('Orzosalade', 25);
    const { planId, mealId } = await seedPlanWithMeal(recipeId, '2026-07-08');
    await publishPlan(planId);

    await unpublishPlan(planId);

    const db = getDb();
    const [mealRow] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    expect(mealRow?.calendarEventId).toBeNull();

    const deleteCalls = getFakeGoogleCallLog().filter((call) => call.method === 'DELETE');
    expect(deleteCalls).toHaveLength(1);
  });

  it('is a no-op (never throws) for a plan with no published meals', async () => {
    const recipeId = await seedRecipe('Orzosalade', 25);
    const { planId } = await seedPlanWithMeal(recipeId, null);
    await expect(unpublishPlan(planId)).resolves.toBeUndefined();
  });
});
