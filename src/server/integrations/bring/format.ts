// Bring item formatting (docs/workpackages/WP-11-bring-v2.md §3): Bring gets no
// product matching/prices — just the ingredient name plus a Dutch quantity
// specification string ("1,5 kg", "400 ml", "2 stuks"). Pure functions (no
// 'server-only', no secrets) so the unit tests import them directly.

// Dutch decimal comma, at most one decimal — matches shoppingService's AMOUNT_FORMAT
// so the Bring app shows the same figure as the boodschappen screen.
const AMOUNT_FORMAT = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 });

/** "1,5 kg" / "400 g" / "2 stuks" — the Bring purchase row's specification field. */
export function formatBringSpec(totalAmount: number, unit: string): string {
  const amount = AMOUNT_FORMAT.format(Math.round(totalAmount * 10) / 10);
  const trimmedUnit = unit.trim();
  return trimmedUnit ? `${amount} ${trimmedUnit}` : amount;
}

export interface BringItemPayload {
  /** Bring purchase name (itemId) — the plain ingredient display name. */
  name: string;
  /** Dutch quantity spec ("1,5 kg"). */
  spec: string;
  /** '{display} — {totalAmount} {unit}' — the single-string form shown in progress/status UI. */
  label: string;
}

/** Maps one shopping item (display + aggregated amount) onto Bring's name/spec pair. */
export function formatBringItem(display: string, totalAmount: number, unit: string): BringItemPayload {
  const name = display.trim();
  const spec = formatBringSpec(totalAmount, unit);
  return { name, spec, label: `${name} — ${spec}` };
}
