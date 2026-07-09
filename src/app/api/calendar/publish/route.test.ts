// API/integration layer (docs/TESTING.md §1) — POST/DELETE /api/calendar/publish
// against a real Postgres, FAKE_GOOGLE=1 fixture mode (docs/workpackages/WP-12-google-
// calendar.md §7: "publish idempotency — second publish updates not duplicates (fixture
// call-log assert)").
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens, planMeals, plans, recipeIngredients, recipes, settings } from '@/server/db/schema';
import { getFakeGoogleCallLog, resetFakeGoogleState } from '@/server/integrations/google/fakeGoogle';
import { createRecipe } from '@/server/services/recipeService';
import { putGoogleCalendarId, putHouseholdPrefs } from '@/server/services/settingsService';
import type { RecipeCreateInput } from '@/shared/recipes';
import { DELETE, POST } from './route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV, FAKE_GOOGLE: '1' };
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

function post(body: unknown) {
  return POST(new Request('http://localhost/api/calendar/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

function del(body: unknown) {
  return DELETE(new Request('http://localhost/api/calendar/publish', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

async function seedConnectedGoogleToken() {
  const db = getDb();
  await db.insert(integrationTokens).values({
    provider: 'google',
    payloadEncrypted: encryptSecret(JSON.stringify({ accessToken: 'fake-access-token', refreshToken: 'fake-refresh-token' })),
    expiresAt: new Date(Date.now() + 3600_000),
  });
}

async function seedPlanWithMeal(cookDate: string | null): Promise<{ planId: number; mealId: number }> {
  const input: RecipeCreateInput = {
    source: 'manual',
    title: 'Orzosalade',
    description: '',
    type: 'vegetarisch',
    styles: [],
    timeMin: 25,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Kook de orzo.', 'Snijd de groenten.', 'Meng alles.'],
    ingredients: [{ nameKey: 'ing', display: 'Ingrediënt', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
  };
  const recipe = await createRecipe(input);

  const db = getDb();
  const [plan] = await db.insert(plans).values({ weekStart: '2026-07-06', servings: 4, mealCount: 1, status: 'final' }).returning();
  const [meal] = await db.insert(planMeals).values({ planId: plan!.id, recipeId: recipe.id, slotIndex: 0, cookDate, approved: true }).returning();
  return { planId: plan!.id, mealId: meal!.id };
}

describe('POST /api/calendar/publish', () => {
  it('rejects an invalid body', async () => {
    const res = await post({ planId: 'not-a-number' });
    expect(res.status).toBe(400);
  });

  it('returns 400 with a Dutch message when no calendar is chosen yet', async () => {
    await seedConnectedGoogleToken();
    const { planId } = await seedPlanWithMeal('2026-07-08');
    const res = await post({ planId });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('agenda');
  });

  it('publishes once, then re-publishing updates the same event instead of duplicating', async () => {
    await seedConnectedGoogleToken();
    await putGoogleCalendarId('primary');
    await putHouseholdPrefs({ dinnerTime: '18:00' });
    const { planId, mealId } = await seedPlanWithMeal('2026-07-08');

    const first = await post({ planId });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ published: 1, skipped: 0 });

    const db = getDb();
    const [afterFirst] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    const eventId = afterFirst?.calendarEventId;
    expect(eventId).toBeTruthy();

    const second = await post({ planId });
    expect(second.status).toBe(200);
    const [afterSecond] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    expect(afterSecond?.calendarEventId).toBe(eventId);

    const createCalls = getFakeGoogleCallLog().filter((call) => call.method === 'POST' && call.url.includes('/events'));
    const updateCalls = getFakeGoogleCallLog().filter((call) => call.method === 'PUT' && call.url.includes('/events/'));
    expect(createCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
  });
});

describe('DELETE /api/calendar/publish', () => {
  it('removes the published event and clears calendar_event_id', async () => {
    await seedConnectedGoogleToken();
    await putGoogleCalendarId('primary');
    await putHouseholdPrefs({ dinnerTime: '18:00' });
    const { planId, mealId } = await seedPlanWithMeal('2026-07-08');
    await post({ planId });

    const res = await del({ planId });
    expect(res.status).toBe(200);

    const db = getDb();
    const [mealRow] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    expect(mealRow?.calendarEventId).toBeNull();
  });
});
