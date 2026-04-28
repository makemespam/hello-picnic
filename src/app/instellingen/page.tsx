'use client';

import { useEffect, useState } from 'react';
import type { AppSettings } from '@/lib/types';
import { DEFAULT_PANTRY, DEFAULT_PANTRY_KEYS } from '@/data/pantry';

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — snel & goedkoop' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — aanbevolen ✨' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7 — slimst' },
];

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('helloPicknicSettings');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    anthropicApiKey: '',
    model: 'claude-sonnet-4-6',
    picnicAuthToken: '',
    picnicEmail: '',
    pantryItems: DEFAULT_PANTRY_KEYS,
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    anthropicApiKey: '',
    model: 'claude-sonnet-4-6',
    picnicAuthToken: '',
    picnicEmail: '',
    pantryItems: DEFAULT_PANTRY_KEYS,
  });
  const [picnicPassword, setPicnicPassword] = useState('');
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [loginError, setLoginError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  function save() {
    localStorage.setItem('helloPicknicSettings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function loginPicnic() {
    setLoginStatus('loading');
    setLoginError('');
    const res = await fetch('/api/picnic/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: settings.picnicEmail, password: picnicPassword }),
    });
    const data = await res.json();
    if (res.ok && data.authToken) {
      setSettings((prev) => ({ ...prev, picnicAuthToken: data.authToken }));
      setLoginStatus('ok');
    } else {
      setLoginStatus('error');
      setLoginError(data.error ?? 'Inloggen mislukt');
    }
  }

  function togglePantry(key: string) {
    setSettings((prev) => ({
      ...prev,
      pantryItems: prev.pantryItems.includes(key)
        ? prev.pantryItems.filter((k) => k !== key)
        : [...prev.pantryItems, key],
    }));
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-stone-900">Instellingen</h1>
        <p className="mt-1 text-stone-500">API-sleutels, Picnic-account en je kastinventaris.</p>
      </div>

      {/* Anthropic */}
      <div className="card p-6 space-y-4">
        <h2 className="font-bold text-stone-900 text-lg">🤖 LLM-instellingen (Anthropic)</h2>
        <p className="text-sm text-stone-500">
          Je hebt een{' '}
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-orange-500 underline">
            Anthropic API-sleutel
          </a>{' '}
          nodig. De sleutel wordt alleen lokaal opgeslagen in je browser.
        </p>

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">API-sleutel</span>
          <input
            type="password"
            value={settings.anthropicApiKey}
            onChange={(e) => setSettings((p) => ({ ...p, anthropicApiKey: e.target.value }))}
            placeholder="sk-ant-..."
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Model</span>
          <select
            value={settings.model}
            onChange={(e) => setSettings((p) => ({ ...p, model: e.target.value }))}
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Picnic */}
      <div className="card p-6 space-y-4">
        <h2 className="font-bold text-stone-900 text-lg">🛒 Picnic-account</h2>
        <p className="text-sm text-stone-500">
          Log in met je Picnic-account om aanbiedingen op te halen en boodschappen toe te voegen aan je mandje.
          Je wachtwoord wordt nooit opgeslagen — alleen het sessie-token.
        </p>

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">E-mailadres</span>
          <input
            type="email"
            value={settings.picnicEmail}
            onChange={(e) => setSettings((p) => ({ ...p, picnicEmail: e.target.value }))}
            placeholder="jij@example.com"
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Wachtwoord</span>
          <input
            type="password"
            value={picnicPassword}
            onChange={(e) => setPicnicPassword(e.target.value)}
            placeholder="Wordt niet opgeslagen"
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          />
        </label>

        <button
          onClick={loginPicnic}
          disabled={loginStatus === 'loading' || !settings.picnicEmail || !picnicPassword}
          className="btn-secondary"
        >
          {loginStatus === 'loading' ? '⏳ Inloggen…' : '🔗 Verbinden met Picnic'}
        </button>

        {loginStatus === 'ok' && (
          <p className="text-sm text-emerald-600">✓ Ingelogd! Sessie-token opgeslagen.</p>
        )}
        {loginStatus === 'error' && (
          <p className="text-sm text-red-600">❌ {loginError}</p>
        )}
        {settings.picnicAuthToken && loginStatus !== 'ok' && (
          <p className="text-sm text-emerald-600">✓ Actief sessie-token aanwezig</p>
        )}
      </div>

      {/* Pantry */}
      <div className="card p-6 space-y-4">
        <h2 className="font-bold text-stone-900 text-lg">🏠 Kastinventaris</h2>
        <p className="text-sm text-stone-500">
          Deze ingrediënten heb je altijd in huis. Ze worden niet op de boodschappenlijst gezet.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(DEFAULT_PANTRY).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={settings.pantryItems.includes(key)}
                onChange={() => togglePantry(key)}
                className="h-4 w-4 rounded accent-orange-500"
              />
              <span className="text-sm text-stone-700 group-hover:text-stone-900">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Save */}
      <button onClick={save} className="btn-primary w-full justify-center py-3">
        {saved ? '✓ Opgeslagen!' : '💾 Instellingen opslaan'}
      </button>
    </div>
  );
}
