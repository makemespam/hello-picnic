'use client';

import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { PicnicReloginBanner } from '@/components/PicnicReloginBanner';

export interface PicnicConnectCardProps {
  initialEmail: string;
  initialStatus: { connected: boolean; expiresKnown: boolean };
}

interface PicnicErrorResponse {
  error: string;
  message: string;
}

// `stage` is which form is showing; `busy` is whether an in-flight request should
// disable its button. Kept as two independent pieces of state (rather than one
// combined phase enum) so "showing the 2FA field while its 'Code bevestigen' request is
// in flight" isn't a fifth phase to remember to route the render logic through.
type Stage = 'credentials' | 'twoFactor';

export function PicnicConnectCard({ initialEmail, initialStatus }: PicnicConnectCardProps) {
  const [connected, setConnected] = useState(initialStatus.connected);
  const [wasConfigured] = useState(initialEmail.length > 0);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>('credentials');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/picnic/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { secondFactorRequired?: boolean } & Partial<PicnicErrorResponse>;
      if (!res.ok) {
        setError(data.message ?? 'Verbinden met Picnic is niet gelukt.');
        return;
      }
      if (data.secondFactorRequired) {
        setStage('twoFactor');
        return;
      }
      setConnected(true);
      setPassword('');
    } catch {
      setError('Netwerkfout bij het verbinden met Picnic.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/picnic/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as Partial<PicnicErrorResponse>;
      if (!res.ok) {
        setError(data.message ?? '2FA-code controleren is niet gelukt.');
        return;
      }
      setConnected(true);
      setPassword('');
      setCode('');
      setStage('credentials');
    } catch {
      setError('Netwerkfout bij het controleren van de 2FA-code.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/picnic/disconnect', { method: 'POST' });
    } finally {
      setConnected(false);
      setStage('credentials');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!connected && wasConfigured && stage === 'credentials' && <PicnicReloginBanner />}

      {!connected && stage === 'twoFactor' && (
        <Field label="2FA-code" htmlFor="picnicConnectCode" hint="Picnic heeft een code naar je telefoon gestuurd.">
          <Input
            id="picnicConnectCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
      )}

      {!connected && stage === 'credentials' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mailadres" htmlFor="picnicConnectEmail">
            <Input id="picnicConnectEmail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Wachtwoord" htmlFor="picnicConnectPassword">
            <Input
              id="picnicConnectPassword"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        </div>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      <div className="flex items-center gap-3">
        {connected ? (
          <>
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
          </>
        ) : stage === 'twoFactor' ? (
          <button
            type="button"
            onClick={handleVerify}
            disabled={busy || code.length === 0}
            className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Bezig…' : 'Code bevestigen'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy || email.length === 0 || password.length === 0}
            className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Bezig…' : 'Verbinden met Picnic'}
          </button>
        )}
      </div>
    </div>
  );
}
