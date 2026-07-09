// Shared request-body parsing for POST /api/recipes and PATCH /api/recipes/:id
// (docs/workpackages/WP-04-recipe-domain-migration.md §5: "photo upload via
// StorageAdapter" happens in the create/edit editor, not a separate WP-07 endpoint).
//
// Accepts either:
// - application/json: the recipe fields only, no photo (API tests, programmatic use).
// - multipart/form-data: a `data` field (JSON string of the recipe fields) plus an
//   optional `photo` file field — what the /recepten editor's <form> submits.
import type { z } from 'zod';

export class RecipePayloadError extends Error {
  constructor(
    message: string,
    public readonly issues?: unknown
  ) {
    super(message);
    this.name = 'RecipePayloadError';
  }
}

export interface ParsedRecipePayload<T> {
  data: T;
  photo?: Buffer;
}

const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // docs/ARCHITECTURE.md §9.5

// `S extends z.ZodTypeAny` + `z.output<S>` (rather than a `z.ZodType<T>` parameter) so
// TS infers the schema's *output* type (defaults applied, e.g. `pantry: boolean`, not
// `pantry?: boolean`) — binding T directly off `ZodType<T>` instead infers the input
// type in this position and produces spurious "optional vs required" mismatches at
// every call site.
export async function parseRecipePayload<S extends z.ZodTypeAny>(
  request: Request,
  schema: S
): Promise<ParsedRecipePayload<z.output<S>>> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const raw = form.get('data');
    if (typeof raw !== 'string') throw new RecipePayloadError('missing_data_field');

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new RecipePayloadError('invalid_json');
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new RecipePayloadError('invalid_input', parsed.error.issues);

    const file = form.get('photo');
    let photo: Buffer | undefined;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_PHOTO_BYTES) throw new RecipePayloadError('photo_too_large');
      if (!file.type.startsWith('image/')) throw new RecipePayloadError('photo_not_an_image');
      photo = Buffer.from(await file.arrayBuffer());
    }

    return { data: parsed.data, photo };
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new RecipePayloadError('invalid_json');
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new RecipePayloadError('invalid_input', parsed.error.issues);
  return { data: parsed.data };
}
