// Client-facing DTO types live here (docs/ARCHITECTURE.md §1).
// HARD RULE: no field may ever carry secret material (passwords, tokens, API keys).
// Secret-bearing settings are represented as `{ configured: boolean }`.

export interface HealthDto {
  ok: boolean;
  version: string;
}
