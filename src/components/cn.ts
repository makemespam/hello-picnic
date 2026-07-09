// Tiny classnames joiner — avoids pulling in a dependency (clsx/tailwind-merge)
// for what amounts to `Array.filter(Boolean).join(' ')`.
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
