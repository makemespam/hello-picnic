// Normalized Levenshtein title similarity (docs/workpackages/WP-08-card-scanning.md
// §6: "duplicate detection (title similarity) warns before creating"). Pure, no I/O —
// scanService.approveScan calls this against every active recipe's title.

/** Classic Levenshtein edit distance between two strings. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i++) {
    const currentRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const insertCost = currentRow[j]! + 1;
      const deleteCost = previousRow[j + 1]! + 1;
      const substituteCost = previousRow[j]! + (a[i] === b[j] ? 0 : 1);
      currentRow.push(Math.min(insertCost, deleteCost, substituteCost));
    }
    previousRow = currentRow;
  }

  return previousRow[b.length]!;
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('nl-NL')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Similarity in [0, 1]: `1 - distance / maxLength`, computed on normalized
 * (diacritics-stripped, lowercased, punctuation-collapsed) titles so "Romige
 * Kippastei!" and "romige kippastei" score 1.0. Two empty titles are trivially
 * identical (1); one empty and one non-empty are maximally different (0).
 */
export function titleSimilarity(a: string, b: string): number {
  const normalizedA = normalizeTitle(a);
  const normalizedB = normalizeTitle(b);
  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(normalizedA, normalizedB) / maxLength;
}
