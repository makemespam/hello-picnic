// API/integration layer (docs/TESTING.md §1) — route handlers against a real Postgres,
// FAKE_AI=1 + FAKE_PICNIC=1 (set in .env). Exercises the resolve -> send lifecycle
// (docs/workpackages/WP-10-basket-optimizer.md), idempotency, and the invalid-id/404
// error paths.
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens, planMeals, plans, recipeIngredients, recipes, shoppingItems } from '@/server/db/schema';
import { createRecipe } from '@/server/services/recipeService';
import { buildFromPlan } from '@/server/services/shoppingService';
import type { RecipeCreateInput } from '@/shared/recipes';
import { GET as getListRoute } from './[planId]/route';
import { POST as resolveRoute } from './[planId]/resolve/route';
import { DELETE as clearCartRoute, POST as sendRoute } from './[planId]/send/route';
import { PATCH as patchItemRoute } from './items/[id]/route';

beforeEach(async () => {
  const db = getDb();
  await db.delete(shoppingItems);
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
});

async function connectPicnic() {
  const db = getDb();
  await db.insert(integrationTokens).values({
    provider: 'picnic',
    payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-route-test', email: 'gezin@example.com' })),
    expiresAt: null,
  });
}

async function seedResolvablePlan(): Promise<number> {
  const input: RecipeCreateInput = {
    source: 'manual',
    title: 'Broccolischotel',
    description: '',
    type: 'vegetarisch',
    styles: [],
    timeMin: 20,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Bereid alles.'],
    ingredients: [{ nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten', pantry: false }],
  };
  const recipe = await createRecipe(input);

  const db = getDb();
  const [planRow] = await db.insert(plans).values({ weekStart: '2026-07-06', servings: 4, mealCount: 1, rationale: '', status: 'final' }).returning();
  if (!planRow) throw new Error('insert into plans returned no row');
  await db.insert(planMeals).values({ planId: planRow.id, recipeId: recipe.id, slotIndex: 0, approved: true });
  await buildFromPlan(planRow.id);
  return planRow.id;
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ planId: id }) };
}

describe('GET /api/shopping/:planId', () => {
  it('returns 400 on a non-numeric id', async () => {
    const res = await getListRoute(new Request('http://localhost/api/shopping/abc'), { params: Promise.resolve({ planId: 'abc' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown plan', async () => {
    const res = await getListRoute(new Request('http://localhost/api/shopping/999999'), { params: Promise.resolve({ planId: '999999' }) });
    expect(res.status).toBe(404);
  });

  it('returns the aggregated list for a finalized plan', async () => {
    const planId = await seedResolvablePlan();
    const res = await getListRoute(new Request(`http://localhost/api/shopping/${planId}`), paramsFor(String(planId)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].display).toBe('Broccoli');
  });
});

describe('POST /api/shopping/:planId/resolve', () => {
  it('returns 401 (auth_expired) when Picnic is not connected', async () => {
    const planId = await seedResolvablePlan();
    const res = await resolveRoute(new Request(`http://localhost/api/shopping/${planId}/resolve`, { method: 'POST' }), paramsFor(String(planId)));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('auth_expired');
  });

  it('resolves items to Picnic products when connected', async () => {
    await connectPicnic();
    const planId = await seedResolvablePlan();
    const res = await resolveRoute(new Request(`http://localhost/api/shopping/${planId}/resolve`, { method: 'POST' }), paramsFor(String(planId)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolved).toBe(1);
    expect(body.list.items[0].article).not.toBeNull();
    expect(body.list.totalPriceCents).toBeGreaterThan(0);
  });
});

describe('full resolve -> send -> double-send -> clear lifecycle', () => {
  it('is idempotent and clears the cart on demand', async () => {
    await connectPicnic();
    const planId = await seedResolvablePlan();

    await resolveRoute(new Request(`http://localhost/api/shopping/${planId}/resolve`, { method: 'POST' }), paramsFor(String(planId)));

    const firstSend = await sendRoute(new Request(`http://localhost/api/shopping/${planId}/send`, { method: 'POST' }), paramsFor(String(planId)));
    expect(firstSend.status).toBe(200);
    const firstBody = await firstSend.json();
    expect(firstBody.added).toBe(1);

    // Double-send adds nothing more (idempotent).
    const secondSend = await sendRoute(new Request(`http://localhost/api/shopping/${planId}/send`, { method: 'POST' }), paramsFor(String(planId)));
    const secondBody = await secondSend.json();
    expect(secondBody.added).toBe(0);
    expect(secondBody.skipped).toBe(1);

    const cleared = await clearCartRoute(new Request(`http://localhost/api/shopping/${planId}/send`, { method: 'DELETE' }), paramsFor(String(planId)));
    expect(cleared.status).toBe(200);
    const clearedBody = await cleared.json();
    expect(clearedBody.items[0].status).toBe('open');
  });
});

describe('PATCH /api/shopping/items/:id', () => {
  it('toggles enabled', async () => {
    const planId = await seedResolvablePlan();
    const listRes = await getListRoute(new Request(`http://localhost/api/shopping/${planId}`), paramsFor(String(planId)));
    const list = await listRes.json();
    const itemId = list.items[0].id as number;

    const patchRes = await patchItemRoute(
      new Request(`http://localhost/api/shopping/items/${itemId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) }),
      { params: Promise.resolve({ id: String(itemId) }) }
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.enabled).toBe(false);
  });

  it('returns 404 for an unknown item', async () => {
    const res = await patchItemRoute(
      new Request('http://localhost/api/shopping/items/999999', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) }),
      { params: Promise.resolve({ id: '999999' }) }
    );
    expect(res.status).toBe(404);
  });

  it('rejects a body with neither field with 400', async () => {
    const res = await patchItemRoute(
      new Request('http://localhost/api/shopping/items/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: '1' }) }
    );
    expect(res.status).toBe(400);
  });
});
