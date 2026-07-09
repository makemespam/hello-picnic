// Picnic connect/status/promotions orchestration (docs/ARCHITECTURE.md §1 "Pages ->
// route handlers -> services -> integrations", docs/workpackages/WP-09-picnic-client-v2.md
// §3/§5). Not in ARCHITECTURE.md §2's original service list (planService/recipeService/
// shoppingService/scanService/calendarService/costService/settingsService) — flagged as
// an addition in the PR: the connect/2FA/status/disconnect flow and the 24h promotions
// cache both need a thin orchestration layer above the pure integration client, and
// nothing in that list is the right home for either.
import { getCart } from '@/server/integrations/picnic/cart';
import { fetchPromotions } from '@/server/integrations/picnic/promotions';
import {
  clearPicnicToken,
  getStoredStatus,
  login,
  requestTwoFactorCode,
  verifyTwoFactorCode,
} from '@/server/integrations/picnic/auth';
import { PicnicAuthExpired, PicnicUnknown } from '@/server/integrations/picnic/errors';
import type { PicnicPromotion } from '@/shared/dto';
import { getDecryptedSecret, getPublicSettings, putSecret, putSettings } from './settingsService';

export interface PicnicConnectInput {
  email?: string;
  password?: string;
}

export interface PicnicConnectResult {
  secondFactorRequired: boolean;
}

/**
 * POST /api/picnic/connect (docs/workpackages/WP-09 §3): resolves email/password from
 * the request body, falling back to the stored settings (settingsService pattern shared
 * with legacy/src/app/api/picnic/login/route.ts). A body-supplied email/password is
 * persisted as the new stored value so a later silent reconnect (WP-10 shopping flows)
 * can reuse it — same tri-state secret semantics as PUT /api/settings.
 */
export async function connect(input: PicnicConnectInput): Promise<PicnicConnectResult> {
  const settings = await getPublicSettings();
  const email = input.email || settings.picnicEmail || process.env.PICNIC_EMAIL || '';
  const password = input.password || (await getDecryptedSecret('picnicPassword')) || process.env.PICNIC_PASSWORD || '';

  if (!email || !password) {
    throw new PicnicUnknown('E-mailadres en wachtwoord zijn verplicht.');
  }

  const persist: Promise<unknown>[] = [];
  if (input.email) persist.push(putSettings({ picnicEmail: input.email }));
  if (input.password) persist.push(putSecret('picnicPassword', input.password));
  await Promise.all(persist);

  const result = await login(email, password);
  // Legacy UX (legacy/src/app/instellingen/page.tsx `loginPicnic`): trigger the SMS/app
  // code immediately so the settings screen can go straight to "enter the code" instead
  // of a separate "request code" step.
  if (result.secondFactorRequired) await requestTwoFactorCode();
  return result;
}

/** POST /api/picnic/2fa. */
export async function verifyTwoFactor(code: string): Promise<void> {
  await verifyTwoFactorCode(code);
}

/** POST /api/picnic/disconnect. */
export async function disconnect(): Promise<void> {
  await clearPicnicToken();
}

export interface PicnicStatusResult {
  connected: boolean;
  expiresKnown: boolean;
}

/**
 * GET /api/picnic/status. Picnic tokens carry no client-visible expiry
 * (integration_tokens.expires_at stays null, docs/ARCHITECTURE.md §3) so `expiresKnown`
 * is always false — the only way to know a *connected* stored token has actually gone
 * stale is to use it. A cheap GET /cart doubles as that live probe so the settings
 * screen's badge/re-login banner reflect reality instead of "we once logged in
 * successfully" (docs/workpackages/WP-09 §2 "visible re-login banner").
 */
export async function getConnectionStatus(): Promise<PicnicStatusResult> {
  const stored = await getStoredStatus();
  if (stored !== 'connected') return { connected: false, expiresKnown: false };

  try {
    await getCart();
    return { connected: true, expiresKnown: false };
  } catch (error) {
    if (error instanceof PicnicAuthExpired) return { connected: false, expiresKnown: false };
    // Any other failure (rate-limited, transient network) shouldn't flip a good
    // connection to "disconnected" on a single probe — report connected without proof.
    return { connected: true, expiresKnown: false };
  }
}

// --- Promotions feed for the planner (docs/ARCHITECTURE.md §6, docs/workpackages/WP-09 §5) --

const PROMOTIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface PromotionsCacheEntry {
  fetchedAt: number;
  promotions: PicnicPromotion[];
}

let promotionsCache: PromotionsCacheEntry | null = null;

/** Test-only: clears the module-level 24h cache so each test starts from a clean slate. */
export function __resetPromotionsCacheForTests(): void {
  promotionsCache = null;
}

/**
 * planService.generate()'s promotions feed. Never throws: any Picnic failure (not
 * connected, expired token, rate-limited, network) degrades to an empty list so plan
 * generation never fails because Picnic is down (docs/workpackages/WP-09 §5 — see
 * planService.test.ts's "graceful degradation" case).
 */
export async function getWeekPromotions(now: number = Date.now()): Promise<PicnicPromotion[]> {
  if (promotionsCache && now - promotionsCache.fetchedAt < PROMOTIONS_CACHE_TTL_MS) {
    return promotionsCache.promotions;
  }

  try {
    const status = await getConnectionStatus();
    if (!status.connected) return [];

    const promotions = await fetchPromotions();
    promotionsCache = { fetchedAt: now, promotions };
    return promotions;
  } catch {
    return [];
  }
}
