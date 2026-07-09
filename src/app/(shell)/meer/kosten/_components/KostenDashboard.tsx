'use client';

import { useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import { CostBadge } from '@/components/CostBadge';
import { SkeletonList } from '@/components/Skeleton';
import { PURPOSE_LABEL } from '@/shared/labels';
import type { CostRangeDto, CostSummaryDto } from '@/shared/dto';

export interface KostenDashboardProps {
  initial: CostSummaryDto;
}

const RANGE_LABEL: Record<CostRangeDto, string> = { week: 'Deze week', month: 'Deze maand' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-surface p-5 shadow-sm">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

export function KostenDashboard({ initial }: KostenDashboardProps) {
  const [range, setRange] = useState<CostRangeDto>(initial.range);
  const [summary, setSummary] = useState<CostSummaryDto>(initial);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (range === initial.range) {
      setSummary(initial);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/costs?range=${range}`)
      .then((res) => {
        if (!res.ok) throw new Error(`GET /api/costs failed: ${res.status}`);
        return res.json() as Promise<CostSummaryDto>;
      })
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setStatus('idle');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` deliberately excluded: only re-fetches on range toggle.
  }, [range]);

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="flex gap-2" role="group" aria-label="Periode">
        {(['week', 'month'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setRange(option)}
            aria-pressed={range === option}
            className={`h-10 rounded-full px-4 text-sm font-semibold transition-colors ${
              range === option ? 'bg-primary text-white' : 'bg-ink/5 text-ink hover:bg-ink/10'
            }`}
          >
            {RANGE_LABEL[option]}
          </button>
        ))}
      </div>

      {status === 'error' && <Alert variant="danger">Kosten konden niet worden geladen. Probeer het opnieuw.</Alert>}

      {status === 'loading' ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <Section title="Totaal">
            <div className="flex flex-wrap items-center gap-4">
              <CostBadge cents={summary.totalCostCents} className="text-base" />
              <p className="text-sm text-ink-muted">
                {summary.totalCalls} {summary.totalCalls === 1 ? 'aanroep' : 'aanroepen'}
                {summary.failedCalls > 0 && ` · ${summary.failedCalls} mislukt`}
              </p>
            </div>
          </Section>

          <Section title="Per taak">
            {summary.byPurpose.length === 0 ? (
              <p className="text-sm text-ink-muted">Nog geen AI-aanroepen in deze periode.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-ink/10">
                {summary.byPurpose.map((entry) => (
                  <li key={entry.purpose} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-ink">{PURPOSE_LABEL[entry.purpose]}</p>
                      <p className="text-xs text-ink-muted">
                        {entry.calls} {entry.calls === 1 ? 'aanroep' : 'aanroepen'}
                      </p>
                    </div>
                    <CostBadge cents={entry.costCents} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Per model">
            {summary.byModel.length === 0 ? (
              <p className="text-sm text-ink-muted">Nog geen AI-aanroepen in deze periode.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-ink/10">
                {summary.byModel.map((entry) => (
                  <li key={`${entry.provider}:${entry.model}`} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-ink">{entry.model}</p>
                      <p className="text-xs text-ink-muted">
                        {capitalize(entry.provider)} · {entry.calls} {entry.calls === 1 ? 'aanroep' : 'aanroepen'}
                      </p>
                    </div>
                    <CostBadge cents={entry.costCents} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Top 10 duurste aanroepen">
            {summary.topCalls.length === 0 ? (
              <p className="text-sm text-ink-muted">Nog geen AI-aanroepen in deze periode.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink-muted">
                      <th className="py-2 pr-3 font-medium">Taak</th>
                      <th className="py-2 pr-3 font-medium">Model</th>
                      <th className="py-2 pr-3 font-medium">Wanneer</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 text-right font-medium">Kosten</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/10">
                    {summary.topCalls.map((call) => (
                      <tr key={call.id}>
                        <td className="py-2 pr-3 text-ink">{PURPOSE_LABEL[call.purpose]}</td>
                        <td className="py-2 pr-3 text-ink-muted">{call.model}</td>
                        <td className="py-2 pr-3 text-ink-muted">{formatDateTime(call.createdAt)}</td>
                        <td className="py-2 pr-3">
                          {call.ok ? (
                            <span className="text-success">Gelukt</span>
                          ) : (
                            <span className="text-danger">Mislukt</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <CostBadge cents={call.costCents} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
