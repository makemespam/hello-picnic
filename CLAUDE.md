# Hello Picnic

AI meal planner for a Dutch family: weekly menus, HelloFresh card scanning, Picnic/Bring shopping integration, Google Calendar prep events.

**Start here:** `.cursorrules` (agent rules) and `docs/REBUILD_PLAN.md` (the approved v2 blueprint). The docs/ folder is the contract:
REBUILD_PLAN → ARCHITECTURE → DESIGN_PRINCIPLES → TESTING → PROMPTS → AGENTS → workpackages/.

Current state: v1 app lives at the repo root (moves to `legacy/` in WP-01); v2 is being built per the work packages. One WP = one branch (`wp-XX-<slug>`) = one PR with screenshots.

Commands (v2, once scaffolded): `npm run dev` · `npm run test:ci` · `npm run e2e` · `npm run lint && npm run typecheck`.
