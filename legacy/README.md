# Legacy v1 app (reference only)

This is the original Hello Picnic v1, frozen as reference material for the v2 rebuild
(see ../docs/REBUILD_PLAN.md). Do not develop here. Valuable logic to port:

- Picnic 2FA login flow + headers: src/lib/picnic.ts, src/app/api/picnic/*
- Product-selection heuristics: src/lib/picnic-product-selection.ts
- LLM product validator rules: src/lib/picnic-llm-validator.ts
- Package-size parsing: src/components/ShoppingList.tsx (parsePackageAmount)
- Search-term cleaning: src/app/api/picnic/search/route.ts
- Default pantry list: src/data/pantry.ts

Removed in WP-14 after the parity checklist passes.
