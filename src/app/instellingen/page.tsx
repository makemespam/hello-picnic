'use client';

import { useEffect, useState } from 'react';
import type { AppSettings } from '@/lib/types';
import { DEFAULT_PANTRY } from '@/data/pantry';
import { defaultSettings, normalizeSettings } from '@/lib/settings';
import {
  IMAGE_PROVIDERS,
  getDefaultImageModel,
  getImageProviderConfig,
  type ImageProvider,
  type OpenAIImageQuality,
} from '@/lib/image-models';
import {
  DEFAULT_MEAL_COUNT,
  DEFAULT_SERVINGS,
  LLM_PROVIDERS,
  getDefaultModel,
  getProviderConfig,
  type LlmProvider,
} from '@/lib/llm';

type ConfigStatus = {
  llmApiKeys: Partial<Record<LlmProvider, boolean>>;
  picnicCredentials: boolean;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [loginError, setLoginError] = useState('');
  const [saved, setSaved] = useState(false);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [picnic2faCode, setPicnic2faCode] = useState('');
  const [pendingPicnicToken, setPendingPicnicToken] = useState('');
  const [needsPicnic2fa, setNeedsPicnic2fa] = useState(false);

  useEffect(() => {
    loadPersistedSettings();
    fetchConfigStatus();
  }, []);

  async function loadPersistedSettings() {
    let localSettings: Partial<AppSettings> | null = null;
    try {
      const raw = localStorage.getItem('helloPicknicSettings');
      localSettings = raw ? JSON.parse(raw) : null;
    } catch {
      localSettings = null;
    }

    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      const merged = normalizeSettings(data.exists ? { ...localSettings, ...data.settings } : localSettings);
      setSettings(merged);
      localStorage.setItem('helloPicknicSettings', JSON.stringify(merged));
    } catch {
      setSettings(normalizeSettings(localSettings));
    }
  }

  async function fetchConfigStatus() {
    try {
      const res = await fetch('/api/config/status');
      const data = await res.json();
      setConfigStatus(data);
    } catch {
      setConfigStatus(null);
    }
  }

  async function save() {
    const normalized = normalizeSettings(settings);
    localStorage.setItem('helloPicknicSettings', JSON.stringify(normalized));
    setSettings(normalized);
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function loginPicnic() {
    setLoginStatus('loading');
    setLoginError('');
    const res = await fetch('/api/picnic/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: settings.picnicEmail, password: settings.picnicPassword }),
    });
    const data = await res.json();
    if (res.ok && data.authToken) {
      if (data.secondFactorRequired) {
        setPendingPicnicToken(data.authToken);
        setNeedsPicnic2fa(true);
        setLoginStatus('idle');
        await fetch('/api/picnic/2fa/generate', {
          method: 'POST',
          headers: { 'x-picnic-auth': data.authToken },
        });
        return;
      }

      const nextSettings = { ...settings, picnicAuthToken: data.authToken };
      setSettings(nextSettings);
      localStorage.setItem('helloPicknicSettings', JSON.stringify(nextSettings));
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      setLoginStatus('ok');
    } else {
      setLoginStatus('error');
      setLoginError(data.error ?? 'Inloggen mislukt');
    }
  }

  async function verifyPicnic2fa() {
    if (!pendingPicnicToken || !picnic2faCode) return;
    setLoginStatus('loading');
    setLoginError('');
    const res = await fetch('/api/picnic/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-picnic-auth': pendingPicnicToken },
      body: JSON.stringify({ code: picnic2faCode }),
    });
    const data = await res.json();

    if (res.ok && data.authToken) {
      const nextSettings = { ...settings, picnicAuthToken: data.authToken };
      setSettings(nextSettings);
      localStorage.setItem('helloPicknicSettings', JSON.stringify(nextSettings));
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      setNeedsPicnic2fa(false);
      setPendingPicnicToken('');
      setPicnic2faCode('');
      setLoginStatus('ok');
    } else {
      setLoginStatus('error');
      setLoginError(data.error ?? '2FA-code controleren mislukt');
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

  function setProvider(provider: LlmProvider) {
    setSettings((prev) => {
      const model = prev.modelsByProvider[provider] ?? getDefaultModel(provider);
      return {
        ...prev,
        llmProvider: provider,
        model,
        modelsByProvider: {
          ...prev.modelsByProvider,
          [provider]: model,
        },
      };
    });
  }

  function setModel(model: string) {
    setSettings((prev) => ({
      ...prev,
      model,
      modelsByProvider: {
        ...prev.modelsByProvider,
        [prev.llmProvider]: model,
      },
    }));
  }

  function setImageProvider(provider: ImageProvider) {
    setSettings((prev) => {
      const model = prev.imageModelsByProvider[provider] ?? getDefaultImageModel(provider);
      return {
        ...prev,
        imageProvider: provider,
        imageModel: model,
        imageModelsByProvider: {
          ...prev.imageModelsByProvider,
          [provider]: model,
        },
      };
    });
  }

  function setImageModel(model: string) {
    setSettings((prev) => ({
      ...prev,
      imageModel: model,
      imageModelsByProvider: {
        ...prev.imageModelsByProvider,
        [prev.imageProvider]: model,
      },
    }));
  }

  const activeProvider = getProviderConfig(settings.llmProvider);
  const activeImageProvider = getImageProviderConfig(settings.imageProvider);
  const hasServerApiKey = Boolean(configStatus?.llmApiKeys?.[activeProvider.id]);
  const hasPicnicEnvCredentials = Boolean(configStatus?.picnicCredentials);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-stone-900">Instellingen</h1>
        <p className="mt-1 text-stone-500">API-sleutels, Picnic-account en je kastinventaris.</p>
      </div>

      {/* LLM */}
      <div className="card p-6 space-y-4">
        <h2 className="font-bold text-stone-900 text-lg">🤖 LLM-instellingen</h2>
        <p className="text-sm text-stone-500">
          Kies eerst je aanbieder en daarna het model. API-sleutels worden lokaal opgeslagen.
        </p>

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Aanbieder</span>
          <select
            value={settings.llmProvider}
            onChange={(e) => setProvider(e.target.value as LlmProvider)}
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          >
            {LLM_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </label>

        <p className="text-sm text-stone-500">
          Je hebt een{' '}
          <a href={activeProvider.docsUrl} target="_blank" rel="noreferrer" className="text-orange-500 underline">
            {activeProvider.apiKeyLabel}
          </a>{' '}
          nodig, of zet `{activeProvider.envKey}` als server-env-variabele.
        </p>
        {hasServerApiKey && (
          <p className="text-sm text-emerald-600">✓ Server-env heeft een {activeProvider.label} API-sleutel.</p>
        )}

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">{activeProvider.apiKeyLabel}</span>
          <input
            type="password"
            value={
              activeProvider.id === 'anthropic'
                ? settings.anthropicApiKey
                : activeProvider.id === 'openai'
                  ? settings.openaiApiKey
                  : settings.geminiApiKey
            }
            onChange={(e) => {
              const value = e.target.value;
              setSettings((p) => ({
                ...p,
                anthropicApiKey: activeProvider.id === 'anthropic' ? value : p.anthropicApiKey,
                openaiApiKey: activeProvider.id === 'openai' ? value : p.openaiApiKey,
                geminiApiKey: activeProvider.id === 'gemini' ? value : p.geminiApiKey,
              }));
            }}
            placeholder={activeProvider.apiKeyPlaceholder}
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Model</span>
          <select
            value={settings.model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          >
            {activeProvider.models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Image generation */}
      <div className="card p-6 space-y-4">
        <h2 className="font-bold text-stone-900 text-lg">🖼️ Beeldgeneratie</h2>
        <p className="text-sm text-stone-500">
          Kies het beeldmodel voor het 2x2 inspiratiebeeld op de overzichtspagina.
        </p>

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Beeldaanbieder</span>
          <select
            value={settings.imageProvider}
            onChange={(e) => setImageProvider(e.target.value as ImageProvider)}
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          >
            {IMAGE_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Beeldmodel</span>
          <select
            value={settings.imageModel}
            onChange={(e) => setImageModel(e.target.value)}
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          >
            {activeImageProvider.models.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </label>

        {activeImageProvider.models.find((model) => model.id === settings.imageModel)?.note && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-2">
            {activeImageProvider.models.find((model) => model.id === settings.imageModel)?.note}
          </p>
        )}

        {settings.imageProvider === 'openai' && (
          <label className="block">
            <span className="text-sm font-semibold text-stone-700">OpenAI kwaliteit</span>
            <select
              value={settings.openaiImageQuality}
              onChange={(e) => setSettings((p) => ({ ...p, openaiImageQuality: e.target.value as OpenAIImageQuality }))}
              className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
            >
              <option value="low">Low - goedkoopst</option>
              <option value="medium">Medium</option>
              <option value="high">High - duurst</option>
            </select>
          </label>
        )}
      </div>

      {/* Plan */}
      <div className="card p-6 space-y-4">
        <h2 className="font-bold text-stone-900 text-lg">🍽️ Weekplan</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-stone-700">Aantal maaltijden</span>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.mealCount}
              onChange={(e) => setSettings((p) => ({ ...p, mealCount: Number(e.target.value) || DEFAULT_MEAL_COUNT }))}
              className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-stone-700">Aantal porties per maaltijd</span>
            <input
              type="number"
              min={1}
              max={12}
              value={settings.servings}
              onChange={(e) => setSettings((p) => ({ ...p, servings: Number(e.target.value) || DEFAULT_SERVINGS }))}
              className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
            />
          </label>
        </div>
      </div>

      {/* Picnic */}
      <div className="card p-6 space-y-4">
        <h2 className="font-bold text-stone-900 text-lg">🛒 Picnic-account</h2>
        <p className="text-sm text-stone-500">
          Log in met je Picnic-account om aanbiedingen op te halen en boodschappen toe te voegen aan je mandje.
          Je gegevens worden lokaal opgeslagen in je browser en in het lokale projectbestand.
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
            value={settings.picnicPassword}
            onChange={(e) => setSettings((p) => ({ ...p, picnicPassword: e.target.value }))}
            placeholder="Wordt lokaal opgeslagen"
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          />
        </label>

        <button
          onClick={loginPicnic}
          disabled={loginStatus === 'loading' || (!hasPicnicEnvCredentials && (!settings.picnicEmail || !settings.picnicPassword))}
          className="btn-secondary"
        >
          {loginStatus === 'loading' ? '⏳ Inloggen…' : '🔗 Verbinden met Picnic'}
        </button>

        {needsPicnic2fa && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-800">Picnic vraagt om 2FA-verificatie.</p>
            <label className="block">
              <span className="text-sm font-semibold text-stone-700">SMS-code</span>
              <input
                type="text"
                inputMode="numeric"
                value={picnic2faCode}
                onChange={(e) => setPicnic2faCode(e.target.value)}
                className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
              />
            </label>
            <button
              onClick={verifyPicnic2fa}
              disabled={loginStatus === 'loading' || !picnic2faCode}
              className="btn-secondary"
            >
              Code controleren
            </button>
          </div>
        )}

        {hasPicnicEnvCredentials && (
          <p className="text-sm text-emerald-600">✓ Server-env heeft Picnic-inloggegevens.</p>
        )}

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
