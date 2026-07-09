// GET /api/suggestions (docs/ARCHITECTURE.md §4, docs/workpackages/
// WP-13-proactive-suggestions.md §5). Protected by middleware.ts. Cached read — see
// suggestionService.getSuggestions for the staleness/recompute logic.
import { NextResponse } from 'next/server';
import { getSuggestions } from '@/server/services/suggestionService';

export async function GET() {
  const result = await getSuggestions();
  return NextResponse.json(result);
}
