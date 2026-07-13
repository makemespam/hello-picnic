'use client';

// Scannen orchestrator (docs/DESIGN_PRINCIPLES.md §5, docs/workpackages/WP-08-card-
// scanning.md): upload -> pairing -> batch extraction (polled progress) -> per-card
// review -> approve/reject. Polls GET /api/scans every 1.5s while a batch is busy
// (docs/ARCHITECTURE.md §4: "server-side job loops with per-item status rows ... the
// client polls the collection endpoint") — a page reload just re-renders from whatever
// the DB already has (SSR'd `initialBoard`) and polling auto-resumes if a batch was
// still mid-flight.
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { ProgressList, type ProgressItemData } from '@/components/ProgressList';
import { CARD_SCAN_STATUS_LABEL } from '@/shared/labels';
import type { CardScanDto, ScanBoardDto } from '@/shared/scans';
import { PairingBoard } from './PairingBoard';
import { ScanReviewCard } from './ScanReviewCard';

const POLL_INTERVAL_MS = 1500;

function isHighConfidence(scan: CardScanDto): boolean {
  if (!scan.extraction) return false;
  return Object.values(scan.extraction.confidence).every((level) => level === 'high');
}

export function ScannenView({ initialBoard }: { initialBoard: ScanBoardDto }) {
  const [board, setBoard] = useState(initialBoard);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // "Are there still scans waiting to be extracted" — drives polling (so a reload
  // mid-batch keeps refreshing until the batch is actually done) and whether the
  // button is clickable at all. Deliberately NOT the button's label state: right after
  // pairing, every fresh scan starts in 'uploaded' too, and the button must still read
  // "Alles verwerken" (an invitation to click) rather than falsely claiming work is
  // already in progress — `processing` (this tab's own in-flight POST) owns the label.
  const hasUnprocessedScans = board.scans.some((scan) => scan.status === 'uploaded');

  async function refreshBoard() {
    const res = await fetch('/api/scans');
    if (res.ok) setBoard(await res.json());
  }

  // Auto-resumes progress polling on mount if a batch was still mid-flight (reload
  // mid-batch), and whenever the user starts one via "Alles verwerken".
  useEffect(() => {
    if (!hasUnprocessedScans) return;
    const timer = setInterval(refreshBoard, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasUnprocessedScans]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append('photos', file);
      const res = await fetch('/api/scans', { method: 'POST', body: form });
      if (!res.ok) {
        setUploadError('Uploaden is niet gelukt. Probeer het opnieuw met foto-bestanden onder 15 MB.');
        return;
      }
      await refreshBoard();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleExtractAll() {
    setProcessing(true);
    try {
      await fetch('/api/scans/extract-all', { method: 'POST' });
      await refreshBoard();
    } finally {
      setProcessing(false);
    }
  }

  function handleApproved(scanId: number) {
    setBoard((current) => ({ ...current, scans: current.scans.map((s) => (s.id === scanId ? { ...s, status: 'approved' } : s)) }));
    void refreshBoard();
  }

  function handleRejected(scanId: number) {
    setBoard((current) => ({ ...current, scans: current.scans.map((s) => (s.id === scanId ? { ...s, status: 'rejected' } : s)) }));
  }

  async function handleBulkApproveHighConfidence() {
    setBulkApproving(true);
    try {
      for (const scan of reviewable.filter(isHighConfidence)) {
        const extraction = scan.extraction!;
        await fetch(`/api/scans/${scan.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: extraction.title,
            description: extraction.description,
            type: extraction.type,
            styles: [],
            timeMin: extraction.timeMin,
            difficulty: extraction.difficulty,
            servingsBase: extraction.servingsBase,
            steps: extraction.steps,
            ingredients: extraction.ingredients.map((i) => ({
              nameKey: i.display.toLocaleLowerCase('nl-NL'),
              display: i.display,
              amount: i.amount,
              unit: i.unit,
              category: i.category,
              productPreference: i.productPreference,
              pantry: i.pantry,
            })),
            confirmDuplicate: false,
          }),
        });
      }
      await refreshBoard();
    } finally {
      setBulkApproving(false);
    }
  }

  const reviewable = board.scans.filter((scan) => scan.status === 'needs_review' || (scan.status === 'extracted' && scan.error));
  const highConfidenceCount = reviewable.filter(isHighConfidence).length;

  const progressItems: ProgressItemData[] = (() => {
    const pending = board.scans.filter((scan) => scan.status === 'uploaded');
    const active = pending[0];
    return board.scans
      .filter((scan) => scan.status !== 'approved' && scan.status !== 'rejected')
      .map((scan): ProgressItemData => {
        if (scan.status === 'uploaded') {
          // Without `processing` an 'uploaded' scan is NOT being worked on — showing a
          // spinner-ish state made a stalled/never-started extraction look busy forever
          // (owner feedback 2026-07-13). Tell the user what to do instead.
          const isActive = processing && active && scan.id === active.id;
          return {
            id: String(scan.id),
            label: `Kaart #${scan.id}`,
            status: isActive ? 'active' : 'pending',
            detail: processing ? undefined : 'Wacht op verwerking — tik "Alles verwerken"',
          };
        }
        if (scan.status === 'extracted' && scan.error) {
          return { id: String(scan.id), label: extractionLabel(scan), status: 'error', detail: scan.error };
        }
        return { id: String(scan.id), label: extractionLabel(scan), status: 'done', detail: CARD_SCAN_STATUS_LABEL[scan.status] };
      });
  })();

  function extractionLabel(scan: CardScanDto): string {
    return scan.extraction?.title ?? `Kaart #${scan.id}`;
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <PageHeader title="Scannen" description="Upload foto's van je HelloFresh-kaarten, koppel voor- en achterkant, en verwerk ze in één keer." />

      <section className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-surface p-4 shadow-sm">
        <Field label="Foto's van receptkaarten" htmlFor="scan-upload-input" hint="Meerdere foto's tegelijk kan (voor- en achterkant).">
          {/* Two explicit entry points: `capture` forces the camera on Android and hides
              the gallery entirely, so the gallery input must NOT carry it (owner feedback
              2026-07-13). Both feed the same upload handler. */}
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-11 cursor-pointer items-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover">
              🖼️ Kies uit galerij
              <input
                ref={fileInputRef}
                id="scan-upload-input"
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => handleUpload(event.target.files)}
                className="sr-only"
              />
            </label>
            <label className="inline-flex h-11 cursor-pointer items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-primary-soft">
              📷 Foto maken
              <input
                id="scan-camera-input"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(event) => handleUpload(event.target.files)}
                className="sr-only"
              />
            </label>
          </div>
        </Field>
        {uploading && <p className="text-sm text-ink-muted">Bezig met uploaden…</p>}
        {uploadError && <p className="text-sm text-danger">{uploadError}</p>}
      </section>

      {board.unpairedImages.length === 0 && board.scans.length === 0 && (
        <EmptyState illustration="📷" title="Nog geen kaarten geüpload" description="Kies of maak foto's van je HelloFresh-kaarten hierboven." />
      )}

      {board.unpairedImages.length > 0 && <PairingBoard unpairedImages={board.unpairedImages} onPaired={refreshBoard} />}

      {board.scans.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold text-ink">Verwerken</h3>
            <div className="flex gap-2">
              {highConfidenceCount > 0 && (
                <button
                  type="button"
                  onClick={handleBulkApproveHighConfidence}
                  disabled={bulkApproving}
                  className="inline-flex h-10 items-center rounded-full border border-primary px-4 text-sm font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkApproving ? 'Bezig…' : `Alles met hoge confidence goedkeuren (${highConfidenceCount})`}
                </button>
              )}
              <button
                type="button"
                onClick={handleExtractAll}
                disabled={processing || !hasUnprocessedScans}
                className="inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {processing ? 'Bezig met verwerken…' : 'Alles verwerken'}
              </button>
            </div>
          </div>
          {progressItems.length > 0 && <ProgressList items={progressItems} />}
        </section>
      )}

      {reviewable.length > 0 && (
        <section className="flex flex-col gap-4">
          <h3 className="text-base font-bold text-ink">Controleren</h3>
          {reviewable.map((scan) => (
            <ScanReviewCard key={scan.id} scan={scan} onApproved={handleApproved} onRejected={handleRejected} onRetried={() => void refreshBoard()} />
          ))}
        </section>
      )}
    </div>
  );
}
