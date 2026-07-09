// Unit layer (docs/TESTING.md §1) — the FAKE_PICNIC dispatch table itself (used by the
// Playwright e2e suite; exercised directly here so its scenario-selection rules stay
// documented and regression-tested without needing a full browser run).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_EXPIRED_TOKEN,
  FAKE_RATE_LIMITED_ARTICLE_ID,
  fakePicnicFetch,
  getFakePicnicCallLog,
  isFakePicnic,
  resetFakePicnicCallLog,
} from './fakePicnic';

beforeEach(() => {
  resetFakePicnicCallLog();
});

describe('isFakePicnic', () => {
  it('reflects FAKE_PICNIC=1', () => {
    const original = process.env.FAKE_PICNIC;
    process.env.FAKE_PICNIC = '1';
    expect(isFakePicnic()).toBe(true);
    process.env.FAKE_PICNIC = '0';
    expect(isFakePicnic()).toBe(false);
    process.env.FAKE_PICNIC = original;
  });
});

describe('fakePicnicFetch — login', () => {
  it('succeeds outright for a plain email', async () => {
    const res = await fakePicnicFetch({ path: '/user/login', method: 'POST', headers: {}, body: { key: 'gezin@example.com' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-picnic-auth')).toBe('FAKE_PICNIC_AUTH_TOKEN_OK');
    const body = (await res.json()) as { second_factor_authentication_required: boolean };
    expect(body.second_factor_authentication_required).toBe(false);
  });

  it('requires 2FA for a "2fa+"-prefixed email', async () => {
    const res = await fakePicnicFetch({ path: '/user/login', method: 'POST', headers: {}, body: { key: '2fa+gezin@example.com' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-picnic-auth')).toBe('FAKE_PICNIC_AUTH_TOKEN_PENDING');
    const body = (await res.json()) as { second_factor_authentication_required: boolean };
    expect(body.second_factor_authentication_required).toBe(true);
  });

  it('fails for the invalid-credentials sentinel email', async () => {
    const res = await fakePicnicFetch({ path: '/user/login', method: 'POST', headers: {}, body: { key: 'faal@hellopicnic-test.nl' } });
    expect(res.status).toBe(400);
  });
});

describe('fakePicnicFetch — 2FA', () => {
  it('generate always succeeds', async () => {
    const res = await fakePicnicFetch({ path: '/user/2fa/generate', method: 'POST', headers: {} });
    expect(res.status).toBe(200);
  });

  it('verify succeeds for code 123456', async () => {
    const res = await fakePicnicFetch({ path: '/user/2fa/verify', method: 'POST', headers: {}, body: { otp: '123456' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-picnic-auth')).toBe('FAKE_PICNIC_AUTH_TOKEN_VERIFIED');
  });

  it('verify fails for any other code', async () => {
    const res = await fakePicnicFetch({ path: '/user/2fa/verify', method: 'POST', headers: {}, body: { otp: '000000' } });
    expect(res.status).toBe(400);
  });
});

describe('fakePicnicFetch — authenticated endpoints', () => {
  it('returns the matching fixture for search/promotions/cart', async () => {
    const search = await fakePicnicFetch({ path: '/pages/search-page-results?search_term=waspeen', method: 'GET', headers: {} });
    expect(search.status).toBe(200);

    const promotions = await fakePicnicFetch({ path: '/promotion-overview', method: 'GET', headers: {} });
    expect(promotions.status).toBe(200);

    const cartAdd = await fakePicnicFetch({ path: '/cart/add_product', method: 'POST', headers: {} });
    expect(cartAdd.status).toBe(200);

    const cartGet = await fakePicnicFetch({ path: '/cart', method: 'GET', headers: {} });
    expect(cartGet.status).toBe(200);
  });

  it('returns 401 for every authenticated endpoint when the token is the expired sentinel', async () => {
    const headers = { 'x-picnic-auth': FAKE_EXPIRED_TOKEN };
    const search = await fakePicnicFetch({ path: '/pages/search-page-results?search_term=waspeen', method: 'GET', headers });
    expect(search.status).toBe(401);
    const cart = await fakePicnicFetch({ path: '/cart', method: 'GET', headers });
    expect(cart.status).toBe(401);
  });

  it('returns 404 for an unhandled path', async () => {
    const res = await fakePicnicFetch({ path: '/not-a-real-endpoint', method: 'GET', headers: {} });
    expect(res.status).toBe(404);
  });

  it('cart/add_product 429s for the FAKE_RATE_LIMITED_ARTICLE_ID sentinel, 200s for anything else', async () => {
    const limited = await fakePicnicFetch({ path: '/cart/add_product', method: 'POST', headers: {}, body: { product_id: FAKE_RATE_LIMITED_ARTICLE_ID, count: 1 } });
    expect(limited.status).toBe(429);

    const ok = await fakePicnicFetch({ path: '/cart/add_product', method: 'POST', headers: {}, body: { product_id: 's1001', count: 1 } });
    expect(ok.status).toBe(200);
  });
});

describe('call log', () => {
  it('records every dispatched request and can be reset', async () => {
    await fakePicnicFetch({ path: '/cart', method: 'GET', headers: {} });
    await fakePicnicFetch({ path: '/cart/add_product', method: 'POST', headers: {}, body: { product_id: 's1001', count: 1 } });
    expect(getFakePicnicCallLog()).toHaveLength(2);

    resetFakePicnicCallLog();
    expect(getFakePicnicCallLog()).toHaveLength(0);
  });
});
