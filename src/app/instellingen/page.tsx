'use client';

import { useCallback, useEffect, useState } from 'react';
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

type BringList = {
  listUuid: string;
  name: string;
};

const RECIPE_TYPE_OPTIONS = [
  { id: 'vegan', label: 'Vegan' },
  { id: 'vegetarisch', label: 'Vegetarisch' },
  { id: 'vis', label: 'Vis' },
  { id: 'rund', label: 'Rund' },
  { id: 'kip', label: 'Kip' },
  { id: 'varken', label: 'Varken' },
] as const;

const MEAL_STYLE_OPTIONS = [
  { id: 'luxe', label: 'Luxe' },
  { id: 'gezin', label: 'Gezin' },
  { id: 'fit', label: 'Fit' },
  { id: 'makkelijk', label: 'Makkelijk' },
  { id: 'snel', label: 'Snel' },
  { id: 'budget', label: 'Budget' },
  { id: 'wereldkeuken', label: 'Wereldkeuken' },
  { id: 'comfort', label: 'Comfort' },
] as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [loginError, setLoginError] = useState('');
  const [saved, setSaved] = useState(false);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [picnic2faCode, setPicnic2faCode] = useState('');
  const [pendingPicnicToken, setPendingPicnicToken] = useState('');
  const [needsPicnic2fa, setNeedsPicnic2fa] = useState(false);
  const [bringStatus, setBringStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [bringError, setBringError] = useState('');
  const [bringLists, setBringLists] = useState<BringList[]>([]);

  const fetchBringLists = useCallback(async () => {
    const res = await fetch('/api/bring/lists');
    const data = await res.json();
    if (res.ok && data.lists) setBringLists(data.lists);
  }, []);

  const loadPersistedSettings = useCallback(async () => {
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
      if (merged.bringAccessToken && merged.bringUserUuid) fetchBringLists();
    } catch {
      setSettings(normalizeSettings(localSettings));
    }
  }, [fetchBringLists]);

  const fetchConfigStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/config/status');
      const data = await res.json();
      setConfigStatus(data);
    } catch {
      setConfigStatus(null);
    }
  }, []);

  useEffect(() => {
    loadPersistedSettings();
    fetchConfigStatus();
  }, [fetchConfigStatus, loadPersistedSettings]);

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

  async function loginBring() {
    setBringStatus('loading');
    setBringError('');
    const res = await fetch('/api/bring/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: settings.bringEmail, password: settings.bringPassword }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setBringStatus('error');
      setBringError(data.error ?? 'Inloggen bij Bring mislukt.');
      return;
    }
    const selected = data.selectedList as BringList | null;
    const nextSettings = {
      ...settings,
      shoppingProvider: 'bring' as const,
      bringUserUuid: data.uuid ?? '',
      bringAccessToken: data.accessToken ?? '',
      bringListUuid: selected?.listUuid ?? settings.bringListUuid,
      bringListName: selected?.name ?? settings.bringListName,
    };
    setSettings(nextSettings);
    localStorage.setItem('helloPicknicSettings', JSON.stringify(nextSettings));
    setBringLists(data.lists ?? []);
    setBringStatus('ok');
  }

  async function selectBringList(listUuid: string) {
    const list = bringLists.find((item) => item.listUuid === listUuid);
    const nextSettings = {
      ...settings,
      shoppingProvider: 'bring' as const,
      bringListUuid: listUuid,
      bringListName: list?.name ?? '',
    };
    setSettings(nextSettings);
    localStorage.setItem('helloPicknicSettings', JSON.stringify(nextSettings));
    await fetch('/api/bring/lists', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listUuid, listName: list?.name ?? '' }),
    });
  }

  function togglePantry(key: string) {
    setSettings((prev) => ({
      ...prev,
      pantryItems: prev.pantryItems.includes(key)
        ? prev.pantryItems.filter((k) => k !== key)
        : [...prev.pantryItems, key],
    }));
  }

  function toggleRecipeType(type: AppSettings['enabledRecipeTypes'][number]) {
    setSettings((prev) => {
      const exists = prev.enabledRecipeTypes.includes(type);
      const next = exists
        ? prev.enabledRecipeTypes.filter((item) => item !== type)
        : [...prev.enabledRecipeTypes, type];
      return { ...prev, enabledRecipeTypes: next.length > 0 ? next : prev.enabledRecipeTypes };
    });
  }

  function toggleMealStyle(style: AppSettings['enabledMealStyles'][number]) {
    setSettings((prev) => {
      const exists = prev.enabledMealStyles.includes(style);
      const next = exists
        ? prev.enabledMealStyles.filter((item) => item !== style)
        : [...prev.enabledMealStyles, style];
      return { ...prev, enabledMealStyles: next.length > 0 ? next : prev.enabledMealStyles };
    });
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
    <div className="max-w-2xl mx-auto flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold text-stone-900">Instellingen</h1>
        <p className="mt-1 text-stone-500">API-sleutels, Picnic-account en je kastinventaris.</p>
      </div>

      {/* LLM */}
      <div className="card order-5 p-6 space-y-4">
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
      <div className="card order-6 p-6 space-y-4">
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
      <div className="card order-1 p-6 space-y-4">
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

      {/* Shopping app */}
      <div className="card order-4 p-6 space-y-4">
        <h2 className="font-bold text-stone-900 text-lg">🛒 Boodschappen-app</h2>
        <p className="text-sm text-stone-500">
          Kies waar je boodschappenlijst naartoe gaat. Picnic gebruikt productselectie en prijzen; Bring! gebruikt je gewone boodschappenlijst.
        </p>

        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Bestemming</span>
          <select
            value={settings.shoppingProvider}
            onChange={(e) => setSettings((p) => ({ ...p, shoppingProvider: e.target.value === 'bring' ? 'bring' : 'picnic' }))}
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          >
            <option value="picnic">Picnic</option>
            <option value="bring">Bring!</option>
          </select>
        </label>

        {settings.shoppingProvider === 'picnic' && (
          <>
            <label className="block">
              <span className="text-sm font-semibold text-stone-700">Picnic e-mailadres</span>
              <input
                type="email"
                value={settings.picnicEmail}
                onChange={(e) => setSettings((p) => ({ ...p, picnicEmail: e.target.value }))}
                placeholder="jij@example.com"
                className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-stone-700">Picnic wachtwoord</span>
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
              {loginStatus === 'loading' ? '⏳ Inloggen…' : settings.picnicAuthToken ? '✓ Verbonden met Picnic' : '🔗 Verbinden met Picnic'}
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
          </>
        )}

        {settings.shoppingProvider === 'bring' && (
          <>
            <label className="block">
              <span className="text-sm font-semibold text-stone-700">Bring! e-mailadres</span>
              <input
                type="email"
                value={settings.bringEmail}
                onChange={(e) => setSettings((p) => ({ ...p, bringEmail: e.target.value }))}
                placeholder="jij@example.com"
                className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-stone-700">Bring! wachtwoord</span>
              <input
                type="password"
                value={settings.bringPassword}
                onChange={(e) => setSettings((p) => ({ ...p, bringPassword: e.target.value }))}
                placeholder="Wordt lokaal opgeslagen"
                className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={loginBring}
                disabled={bringStatus === 'loading' || !settings.bringEmail || !settings.bringPassword}
                className="btn-secondary"
              >
                {bringStatus === 'loading' ? 'Inloggen…' : settings.bringAccessToken ? '✓ Verbonden met Bring!' : 'Verbinden met Bring!'}
              </button>
              {settings.bringAccessToken && (
                <button onClick={fetchBringLists} className="btn-secondary">
                  Lijsten verversen
                </button>
              )}
            </div>

            {bringLists.length > 0 && (
              <label className="block">
                <span className="text-sm font-semibold text-stone-700">Bring! lijst</span>
                <select
                  value={settings.bringListUuid}
                  onChange={(e) => selectBringList(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
                >
                  {bringLists.map((list) => (
                    <option key={list.listUuid} value={list.listUuid}>{list.name}</option>
                  ))}
                </select>
              </label>
            )}

            {settings.bringListName && (
              <p className="text-sm text-emerald-600">✓ Geselecteerde Bring!-lijst: {settings.bringListName}</p>
            )}
            {bringStatus === 'ok' && (
              <p className="text-sm text-emerald-600">✓ Bring! verbonden.</p>
            )}
            {bringStatus === 'error' && (
              <p className="text-sm text-red-600">❌ {bringError}</p>
            )}
          </>
        )}
      </div>

      {/* Pantry */}
      <div className="card order-3 p-6 space-y-4">
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

      {/* Personal food rules */}
      <div className="card order-2 p-6 space-y-4">
        <h2 className="font-bold text-stone-900 text-lg">Persoonlijke voorkeuren</h2>
        <div>
          <p className="text-sm font-semibold text-stone-700">Basismaaltijden</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {RECIPE_TYPE_OPTIONS.map((option) => (
              <label key={option.id} className="flex items-center gap-2 rounded-lg border border-stone-100 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.enabledRecipeTypes.includes(option.id)}
                  onChange={() => toggleRecipeType(option.id)}
                  className="h-4 w-4 rounded accent-orange-500"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-stone-700">Maaltijdsoort</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MEAL_STYLE_OPTIONS.map((option) => (
              <label key={option.id} className="flex items-center gap-2 rounded-lg border border-stone-100 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.enabledMealStyles.includes(option.id)}
                  onChange={() => toggleMealStyle(option.id)}
                  className="h-4 w-4 rounded accent-orange-500"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Allergieën en harde uitsluitingen</span>
          <textarea
            value={settings.allergies}
            onChange={(e) => setSettings((p) => ({ ...p, allergies: e.target.value }))}
            placeholder="Bijv. pinda, schaaldieren, lactose, geen aubergine..."
            rows={3}
            className="mt-1 w-full resize-none rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Producten in huis die op moeten</span>
          <textarea
            value={settings.useUpProducts}
            onChange={(e) => setSettings((p) => ({ ...p, useUpProducts: e.target.value }))}
            placeholder="Bijv. halve zak spinazie, 3 wortels, feta, geopende kokosmelk..."
            rows={3}
            className="mt-1 w-full resize-none rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          />
        </label>
      </div>

      {/* Save */}
      <button onClick={save} className="btn-primary order-7 w-full justify-center py-3">
        {saved ? '✓ Opgeslagen!' : '💾 Instellingen opslaan'}
      </button>
    </div>
  );
}
