'use client';

import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn('credentials', { email, password, redirect: false });

    setSubmitting(false);
    if (!result || result.error) {
      setError(
        result?.code === 'rate_limited'
          ? 'Te veel inlogpogingen. Probeer het over een minuut opnieuw.'
          : 'E-mailadres of wachtwoord klopt niet.'
      );
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-ink/10 bg-surface p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="text-4xl" role="img" aria-hidden="true">
            🍽️
          </span>
          <h1 className="text-xl font-bold text-ink">Welkom terug</h1>
          <p className="text-sm text-ink-muted">Log in om jullie weekmenu te bekijken.</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <Field label="E-mailadres" htmlFor="email" required>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Wachtwoord" htmlFor="password" required>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error && <Alert variant="danger">{error}</Alert>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Bezig met inloggen…' : 'Inloggen'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
