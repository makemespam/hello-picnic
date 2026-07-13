'use client';

// Google Agenda connect card (docs/workpackages/WP-12-google-calendar.md §5, mirrors
// PicnicConnectCard.tsx's shape). Unlike Picnic (an in-page email/password form),
// connecting is a full-page OAuth redirect — "Verbinden" is a plain `<a>` to
// GET /api/google/oauth/start, not a fetch call. The browser comes back on
// /meer/instellingen?google=connected|error|state_mismatch (src/app/api/google/oauth/
// callback/route.ts); this component reads + strips that query param on mount.
import { useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import { Field } from '@/components/Field';
import { Select } from '@/components/Select';

export interface GoogleConnectCardProps {
  initialConnected: boolean;
  initialCalendarId: string;
}

interface CalendarsResponse {
  calendars: { id: string; summary: string; primary?: boolean }[];
}

const OAUTH_RESULT_MESSAGE: Record<string, string> = {
  error: 'Verbinden met Google is niet gelukt. Probeer het opnieuw.',
  state_mismatch: 'De verbinding kon niet worden geverifieerd. Probeer het opnieuw.',
  not_configured:
    'Google Agenda is op de server nog niet ingesteld: maak eenmalig een OAuth-client aan in de Google Cloud Console (stappenplan: deploy/GOOGLE_OAUTH.md in de repository) en zet GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET in deploy/.env.',
};

export function GoogleConnectCard({ initialConnected, initialCalendarId }: GoogleConnectCardProps) {
  const [connected, setConnected] = useState(initialConnected);
  const [calendars, setCalendars] = useState<CalendarsResponse['calendars']>([]);
  const [calendarId, setCalendarId] = useState(initialCalendarId);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);

  // Read + strip the ?google= redirect-result query param once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google');
    if (!result) return;

    if (result === 'connected') {
      setConnected(true);
      setJustConnected(true);
    } else if (OAUTH_RESULT_MESSAGE[result]) {
      setError(OAUTH_RESULT_MESSAGE[result]!);
    }

    params.delete('google');
    const newSearch = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`);
  }, []);

  useEffect(() => {
    if (!connected) return;
    setLoadingCalendars(true);
    fetch('/api/calendar/calendars')
      .then((res) => (res.ok ? (res.json() as Promise<CalendarsResponse>) : Promise.reject(new Error(String(res.status)))))
      .then((data) => setCalendars(data.calendars))
      .catch(() => setError('Agenda’s ophalen is niet gelukt.'))
      .finally(() => setLoadingCalendars(false));
  }, [connected]);

  async function handleCalendarChange(nextCalendarId: string) {
    setCalendarId(nextCalendarId);
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleCalendarId: nextCalendarId }),
    });
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/google/disconnect', { method: 'POST' });
    } finally {
      setConnected(false);
      setCalendars([]);
      setCalendarId('');
      setJustConnected(false);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {justConnected && <Alert variant="success">Verbonden met Google Agenda.</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}

      {connected ? (
        <>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-success" role="status">
              ✓ Verbonden
            </span>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="h-9 shrink-0 rounded-full border border-ink/15 px-3 text-xs font-semibold text-ink hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Verbinding verbreken
            </button>
          </div>

          <Field label="Agenda" htmlFor="googleCalendarId" hint="Hierop komen de kook-voorbereidingen te staan.">
            <Select
              id="googleCalendarId"
              value={calendarId}
              disabled={loadingCalendars}
              onChange={(event) => handleCalendarChange(event.target.value)}
            >
              <option value="">— Kies een agenda —</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.summary}
                  {calendar.primary ? ' (standaard)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : (
        <a
          href="/api/google/oauth/start"
          className="inline-flex h-9 w-fit items-center justify-center rounded-full bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-hover"
        >
          Verbinden met Google Agenda
        </a>
      )}
    </div>
  );
}
