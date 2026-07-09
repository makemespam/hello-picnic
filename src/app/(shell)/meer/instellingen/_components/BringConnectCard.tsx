'use client';

// Bring connect card (docs/workpackages/WP-11-bring-v2.md §2), mirroring
// PicnicConnectCard.tsx's shape: email/password form (password encrypted at rest via
// bringService.connect -> putSecret) -> connect -> list picker (GET /api/bring/lists,
// POST /api/bring/select-list) -> connected badge with the chosen list -> disconnect.
// No 2FA stage — Bring doesn't have one.
import { useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

export interface BringConnectCardProps {
  initialEmail: string;
  initialStatus: { connected: boolean; listUuid: string | null; listName: string | null };
}

interface BringErrorResponse {
  error: string;
  message: string;
}

interface BringListOption {
  listUuid: string;
  name: string;
}

export function BringConnectCard({ initialEmail, initialStatus }: BringConnectCardProps) {
  const [connected, setConnected] = useState(initialStatus.connected);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [lists, setLists] = useState<BringListOption[]>([]);
  const [listUuid, setListUuid] = useState(initialStatus.listUuid ?? '');
  const [listName, setListName] = useState(initialStatus.listName ?? '');
  const [loadingLists, setLoadingLists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once connected, fetch the account's lists for the picker (also on first render
  // when the server already reported connected — the picker should always be usable).
  useEffect(() => {
    if (!connected) return;
    setLoadingLists(true);
    fetch('/api/bring/lists')
      .then((res) => (res.ok ? (res.json() as Promise<{ lists: BringListOption[] }>) : Promise.reject(new Error(String(res.status)))))
      .then((data) => setLists(data.lists))
      .catch(() => setError('Bring-lijsten ophalen is niet gelukt.'))
      .finally(() => setLoadingLists(false));
  }, [connected]);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bring/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { connected?: boolean } & Partial<BringErrorResponse>;
      if (!res.ok) {
        setError(data.message ?? 'Verbinden met Bring is niet gelukt.');
        return;
      }
      setConnected(true);
      setPassword('');
    } catch {
      setError('Netwerkfout bij het verbinden met Bring.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectList(nextListUuid: string) {
    const chosen = lists.find((list) => list.listUuid === nextListUuid);
    if (!chosen) return;
    setListUuid(chosen.listUuid);
    setListName(chosen.name);
    setError(null);
    const res = await fetch('/api/bring/select-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listUuid: chosen.listUuid, listName: chosen.name }),
    });
    if (!res.ok) setError('Lijst kiezen is niet gelukt. Probeer het opnieuw.');
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/bring/disconnect', { method: 'POST' });
    } finally {
      setConnected(false);
      setLists([]);
      setListUuid('');
      setListName('');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!connected && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mailadres" htmlFor="bringConnectEmail">
            <Input id="bringConnectEmail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Wachtwoord" htmlFor="bringConnectPassword">
            <Input
              id="bringConnectPassword"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        </div>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      {connected && (
        <Field label="Bring-lijst" htmlFor="bringListUuid" hint="Hier komen je boodschappen op te staan.">
          <Select id="bringListUuid" value={listUuid} disabled={loadingLists} onChange={(event) => handleSelectList(event.target.value)}>
            <option value="">— Kies een lijst —</option>
            {lists.map((list) => (
              <option key={list.listUuid} value={list.listUuid}>
                {list.name}
              </option>
            ))}
            {/* Keep a previously chosen list visible even if the fresh fetch failed. */}
            {listUuid && !lists.some((list) => list.listUuid === listUuid) && <option value={listUuid}>{listName || 'Gekozen lijst'}</option>}
          </Select>
        </Field>
      )}

      <div className="flex items-center gap-3">
        {connected ? (
          <>
            <span className="text-sm font-medium text-success" role="status">
              ✓ Verbonden{listName ? ` · ${listName}` : ''}
            </span>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="h-9 shrink-0 rounded-full border border-ink/15 px-3 text-xs font-semibold text-ink hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Verbinding verbreken
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy || email.length === 0 || password.length === 0}
            className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Bezig…' : 'Verbinden met Bring'}
          </button>
        )}
      </div>
    </div>
  );
}
