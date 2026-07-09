# Agent Working Model — Hello Picnic v2

How this project is built by a mix of expensive "architect" models and cheaper "builder" models, coordinated by the owner.

## 1. Roles

| Role | Models | Responsibilities |
|---|---|---|
| **Architect** | Claude Fable / Claude Opus-class (expensive tier) | Owns `docs/` as the contract; splits/adjusts work packages; reviews every PR (code + screenshots + acceptance criteria); makes irreversible decisions (schema, security, API shape); writes the tricky 10% (crypto, basket optimizer core, AI layer) when builders struggle |
| **Builder (autonomous)** | Claude Sonnet-class — architect may spawn as subagents, or run in separate sessions | Implements one WP per branch/PR following docs; writes the tests the WP demands; posts screenshots in the PR |
| **Builder (owner-driven)** | DeepSeek `deepseek-v4-pro` — owner pastes a prepared prompt into DeepSeek and applies the output | Well-bounded, mechanical work: port legacy heuristics, fixture generation, documentation, seed data, translation of specs into test cases |
| **Owner** | Roeland | Approves screenshots/UX, runs manual test rounds with real credentials, merges after architect approval, runs `import-legacy` and deploys |

## 2. The control loop (per work package)

```
1. Architect: verify WP is current; adjust doc if reality changed. Hand builder the kickoff prompt (§4).
2. Builder: branch `wp-XX-<slug>` → implement → tests green locally → PR with checked
   acceptance criteria + screenshots.
3. CI: lint, typecheck, unit, e2e, screenshot artifacts (docs/TESTING.md).
4. Architect review gate — reject cheaply and early:
   a. acceptance criteria honestly met (spot-check, don't trust checkboxes)
   b. no docs/ARCHITECTURE.md violations (layering, DTO rules, secret handling)
   c. tests actually assert behavior (no assertion-free theater)
   d. screenshots match docs/DESIGN_PRINCIPLES.md
   e. diff hygiene: no drive-by refactors outside WP scope
5. Owner: eyeball screenshots, merge.
6. Architect: update REBUILD_PLAN progress table, pick next WP(s), exploit parallel tracks.
```

## 3. Choosing the model tier per WP

Each WP header carries a **Builder tier** recommendation:
- `sonnet` — default: multi-file features with UI + API + tests.
- `sonnet+architect-review-heavy` — security or money-touching code (WP-03, WP-05, WP-10): builder implements, architect line-reviews everything.
- `deepseek-ok` — bounded, spec-complete, low-blast-radius (fixtures, legacy ports with existing tests, docs, seed scripts).
- `architect-only` — `crypto.ts`, secret-leak test design, Auth wiring review, models.ts pricing verification.

When a builder fails twice on the same task, stop retrying with the same tier — escalate to the architect (cheaper than a third broken attempt).

## 4. Builder kickoff prompt template

```
Read first, in order: docs/REBUILD_PLAN.md, docs/ARCHITECTURE.md,
docs/workpackages/WP-XX-<slug>.md (your assignment), plus docs/DESIGN_PRINCIPLES.md
(if UI) / docs/PROMPTS.md (if AI) / docs/TESTING.md (always).

Rules of engagement:
- Implement ONLY WP-XX. Branch: wp-XX-<slug>. Anything out of scope: note it in the
  PR description under "Voorstellen", do not build it.
- Follow .cursorrules. The docs are the contract; if the code and docs conflict, the
  docs win — if the docs seem wrong, STOP and report instead of improvising.
- Definition of done: every acceptance criterion checked in the PR body, all test
  requirements implemented, npm run lint && npm run typecheck && npm run test:ci
  && npm run e2e green, screenshots attached for changed screens.
- Never commit secrets; never call live external APIs from tests (FAKE_AI=1 and
  fetch mocks only).
Deliver: PR titled "WP-XX: <title>".
```

For DeepSeek (owner-driven), the architect additionally inlines the full WP text + relevant doc excerpts into the prompt (DeepSeek won't have repo access) and asks for a unified diff or complete files, which the owner applies and pushes for CI to judge.

## 5. Guardrails that make cheap builders safe

1. **CI is the first reviewer** — nothing unreviewed can merge with red checks.
2. **The secret-leak e2e test** turns the worst failure mode into a red build.
3. **Zod at boundaries** turns "LLM/API shape drift" into typed errors builders can't ignore.
4. **Small WPs** (≤ ~2 days of agent work) keep diffs reviewable; if a WP balloons, the architect splits it rather than letting the builder wander.
5. **Snapshot-tested prompts** make prompt regressions visible in diffs.

## 6. Session hygiene

Builders start fresh per WP (no cross-WP context contamination). The architect maintains continuity: after each merge, it appends one line to the progress table in `docs/REBUILD_PLAN.md` (WP, date, PR#, notable deviations). That table — not chat history — is the memory of the project.
