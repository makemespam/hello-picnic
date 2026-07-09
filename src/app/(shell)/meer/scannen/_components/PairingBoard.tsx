'use client';

// Pairing step (docs/DESIGN_PRINCIPLES.md §5, docs/workpackages/WP-08-card-scanning.md
// §3): auto-suggests front/back pairs by upload order; tap two pool photos to combine
// them into a pair (or "Los toevoegen" for a front-only scan); each formed pair can be
// swapped or unpaired again before confirming. Posts the final grouping to
// POST /api/scans/pair.
import { useEffect, useState } from 'react';
import { cn } from '@/components/cn';
import { PhotoFrame } from '@/components/PhotoFrame';
import type { ScanImageDto } from '@/shared/scans';

interface DraftPair {
  key: string;
  front: ScanImageDto;
  back: ScanImageDto | null;
}

function autoPair(images: ScanImageDto[]): { pairs: DraftPair[]; pool: ScanImageDto[] } {
  const pairs: DraftPair[] = [];
  for (let i = 0; i < images.length; i += 2) {
    const front = images[i]!;
    const back = images[i + 1] ?? null;
    pairs.push({ key: `pair-${front.id}`, front, back });
  }
  return { pairs, pool: [] };
}

export interface PairingBoardProps {
  unpairedImages: ScanImageDto[];
  onPaired: () => void;
}

export function PairingBoard({ unpairedImages, onPaired }: PairingBoardProps) {
  const [pairs, setPairs] = useState<DraftPair[]>(() => autoPair(unpairedImages).pairs);
  const [pool, setPool] = useState<ScanImageDto[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [knownIds, setKnownIds] = useState<Set<number>>(() => new Set(unpairedImages.map((i) => i.id)));

  // New uploads that arrive while the pairing screen is open (e.g. a second batch
  // added before confirming) join the pool instead of resetting the draft.
  useEffect(() => {
    const newOnes = unpairedImages.filter((image) => !knownIds.has(image.id));
    if (newOnes.length === 0) return;
    setPool((current) => [...current, ...newOnes]);
    setKnownIds((current) => new Set([...current, ...newOnes.map((i) => i.id)]));
  }, [unpairedImages, knownIds]);

  function togglePoolSelect(image: ScanImageDto) {
    if (selectedPoolId === image.id) {
      setSelectedPoolId(null);
      return;
    }
    if (selectedPoolId === null) {
      setSelectedPoolId(image.id);
      return;
    }
    const front = pool.find((p) => p.id === selectedPoolId);
    if (!front) {
      setSelectedPoolId(image.id);
      return;
    }
    setPairs((current) => [...current, { key: `pair-${front.id}`, front, back: image }]);
    setPool((current) => current.filter((p) => p.id !== front.id && p.id !== image.id));
    setSelectedPoolId(null);
  }

  function addSelectedAsFrontOnly() {
    const image = pool.find((p) => p.id === selectedPoolId);
    if (!image) return;
    setPairs((current) => [...current, { key: `pair-${image.id}`, front: image, back: null }]);
    setPool((current) => current.filter((p) => p.id !== image.id));
    setSelectedPoolId(null);
  }

  function swap(key: string) {
    setPairs((current) =>
      current.map((pair) => (pair.key === key && pair.back ? { ...pair, key: `pair-${pair.back.id}`, front: pair.back, back: pair.front } : pair))
    );
  }

  function unpair(key: string) {
    const pair = pairs.find((p) => p.key === key);
    if (!pair) return;
    setPool((current) => [...current, pair.front, ...(pair.back ? [pair.back] : [])]);
    setPairs((current) => current.filter((p) => p.key !== key));
  }

  async function confirm() {
    setSaving(true);
    try {
      const res = await fetch('/api/scans/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairs: pairs.map((pair) => ({ frontImageId: pair.front.id, backImageId: pair.back?.id })),
        }),
      });
      if (res.ok) onPaired();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-surface p-4 shadow-sm">
      <div>
        <h3 className="text-base font-bold text-ink">Kaarten koppelen</h3>
        <p className="text-sm text-ink-muted">Voor- en achterkant zijn automatisch gekoppeld op uploadvolgorde. Tik om te wisselen.</p>
      </div>

      <div className="flex flex-col gap-3">
        {pairs.map((pair) => (
          <div key={pair.key} className="flex items-center gap-3 rounded-md border border-ink/10 p-2">
            <PhotoFrame src={pair.front.url} alt="Voorkant" aspect="1:1" className="h-16 w-16 shrink-0 rounded-md" />
            <span aria-hidden="true" className="text-ink-muted">
              +
            </span>
            {pair.back ? (
              <PhotoFrame src={pair.back.url} alt="Achterkant" aspect="1:1" className="h-16 w-16 shrink-0 rounded-md" />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-ink/20 text-center text-xs text-ink-muted">
                Alleen voorkant
              </span>
            )}
            <div className="ml-auto flex gap-2">
              {pair.back && (
                <button type="button" onClick={() => swap(pair.key)} className="text-xs font-semibold text-primary underline underline-offset-2">
                  Wissel
                </button>
              )}
              <button type="button" onClick={() => unpair(pair.key)} className="text-xs font-semibold text-danger underline underline-offset-2">
                Ontkoppelen
              </button>
            </div>
          </div>
        ))}
      </div>

      {pool.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-ink-muted">Nog te koppelen (tik twee foto&apos;s om te combineren)</h4>
          <div className="flex flex-wrap gap-2">
            {pool.map((image) => (
              <button
                key={image.id}
                type="button"
                onClick={() => togglePoolSelect(image)}
                className={cn('h-16 w-16 overflow-hidden rounded-md border-2', selectedPoolId === image.id ? 'border-primary' : 'border-transparent')}
              >
                <PhotoFrame src={image.url} alt="Ongekoppelde foto" aspect="1:1" />
              </button>
            ))}
          </div>
          {selectedPoolId !== null && (
            <button type="button" onClick={addSelectedAsFrontOnly} className="mt-2 text-xs font-semibold text-primary underline underline-offset-2">
              Los toevoegen als voorkant-only
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={confirm}
        disabled={saving || pairs.length === 0}
        className="inline-flex h-11 items-center justify-center self-start rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? 'Bezig…' : `Koppeling bevestigen (${pairs.length})`}
      </button>
    </div>
  );
}
