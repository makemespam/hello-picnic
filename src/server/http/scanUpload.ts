// Multipart parsing for POST /api/scans (docs/ARCHITECTURE.md §9.5: "images only
// (sniffed mime), <=15 MB"). Mirrors src/server/http/recipePayload.ts's multipart
// handling, but for N unnamed `photos` file fields instead of one `data` + `photo` pair.

const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // docs/ARCHITECTURE.md §9.5
const MAX_PHOTOS_PER_UPLOAD = 20; // generous ceiling for an ±50-80 card bulk-import session done in a few batches

export class ScanUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanUploadError';
  }
}

/** Parses `multipart/form-data` with one or more `photos` file fields into validated buffers. */
export async function parseScanUploadPayload(request: Request): Promise<Buffer[]> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) throw new ScanUploadError('expected_multipart');

  const form = await request.formData();
  const files = form.getAll('photos').filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0) throw new ScanUploadError('no_photos');
  if (files.length > MAX_PHOTOS_PER_UPLOAD) throw new ScanUploadError('too_many_photos');

  return Promise.all(
    files.map(async (file) => {
      if (file.size > MAX_PHOTO_BYTES) throw new ScanUploadError('photo_too_large');
      // Sniffed by content-type header here; imageService.saveScanPhoto's sharp
      // pipeline is the real gate (throws InvalidImageError on non-image bytes
      // regardless of what the browser claimed the mime type was).
      if (!file.type.startsWith('image/')) throw new ScanUploadError('photo_not_an_image');
      return Buffer.from(await file.arrayBuffer());
    })
  );
}
