/** Dutch-formatted € amount (docs/DESIGN_PRINCIPLES.md §6: "€ 61,40"). Cents in, string out. */
export function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });
}
