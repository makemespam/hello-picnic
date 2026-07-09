// Drizzle schema — tables land per work package:
// WP-03: users, settings, integration_tokens, llm_calls
// WP-04: recipes, recipe_ingredients, images
// WP-06: plans, plan_meals
// WP-08: card_scans
// WP-10: shopping_items
// See docs/ARCHITECTURE.md §3 for the full normative schema.

import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { AI_PURPOSES } from '@/shared/labels';

// Single household per deployment; household_id columns exist for future
// multi-tenancy but are constant 1 in v2 (docs/ARCHITECTURE.md §3).
export const HOUSEHOLD_ID = 1;

export const userRoleEnum = pgEnum('user_role', ['adult', 'child']);

// Mirrors src/shared/labels.ts AI_PURPOSES (single source of truth) so the DB enum
// can never drift from the AI model registry / settings UI purpose list.
export const llmPurposeEnum = pgEnum('llm_purpose', AI_PURPOSES);

export const integrationProviderEnum = pgEnum('integration_provider', ['picnic', 'bring', 'google']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id').notNull().default(HOUSEHOLD_ID),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('adult'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// value_json holds either the plain (non-secret) value, or — when is_secret is
// true — a JSON string containing the AES-256-GCM ciphertext produced by
// src/server/auth/crypto.ts. Never store secret plaintext here.
export const settings = pgTable(
  'settings',
  {
    householdId: integer('household_id').notNull().default(HOUSEHOLD_ID),
    key: text('key').notNull(),
    valueJson: jsonb('value_json').notNull(),
    isSecret: boolean('is_secret').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.key] })]
);

export const integrationTokens = pgTable('integration_tokens', {
  id: serial('id').primaryKey(),
  provider: integrationProviderEnum('provider').notNull(),
  payloadEncrypted: text('payload_encrypted').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// cost_cents is numeric (not integer): individual calls — especially the
// high-frequency, cheap-tier `validate_product` purpose — regularly cost a
// fraction of one cent, and the /kosten dashboard (WP-05) needs exact sums.
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: serial('id').primaryKey(),
    purpose: llmPurposeEnum('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costCents: numeric('cost_cents', { precision: 12, scale: 4, mode: 'number' }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    ok: boolean('ok').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('llm_calls_created_at_idx').on(table.createdAt)]
);
