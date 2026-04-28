import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { PicnicPromotion, MealPlan } from '@/lib/types';
import {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_MEAL_COUNT,
  DEFAULT_SERVINGS,
  getProviderConfig,
  getValidModel,
  type LlmProvider,
} from '@/lib/llm';
import { readLocalSettings } from '@/lib/settings-store';

const SYSTEM_PROMPT = `Je bent een slimme Nederlandse maaltijdplanner. Je genereert {MEAL_COUNT} gezonde avondmaaltijden voor {SERVINGS} personen.

REGELS:
- Alleen vegetarisch of vis — geen vlees
- Genereer exact {MEAL_COUNT} recepten
- Elk recept heeft exact "servings": {SERVINGS}
- "type" is alleen "vega" of "vis"
- "difficulty" is alleen "easy", "medium" of "hard"
- "category" is alleen "groenten", "fruit", "zuivel", "vis", "kruiden", "granen", "peulvruchten" of "overig"
- Voeg per ingredient "productPreference" toe: "fresh", "frozen", "canned", "dried" of "any"
- Voor normale groenten is "productPreference": "fresh", tenzij je expliciet diepvries/blik/gedroogd bedoelt
- Voor peulvruchten mag "canned" of "dried"; voor kokosmelk "any"; voor rijst/pasta "dried"
- Gezond, gevarieerd en seizoensgebonden
- Recepten zijn realistisch en smakelijk, in de stijl van Hello Fresh
- Instructies in heldere, vriendelijke Nederlandse taal (jij-vorm)

SLIMME INGREDIËNTEN-OVERLAP (belangrijk!):
- Als je verse kruiden nodig hebt (bijv. verse koriander, peterselie, basilicum), gebruik ze in minstens 2 recepten zodat de hele bos op gaat
- Als je een blik kokosmelk opent (400 ml), gebruik het in meerdere recepten
- Als je aardappelen koopt (altijd meer dan nodig voor 1 recept), plan een 2e recept ermee
- Als je verse gember of verse tijm koopt, gebruik het in 2 recepten
- Als je ricotta, halloumi of een andere bijzondere zuivel koopt, gebruik de rest in een 2e recept
- Minimaliseer verspilling actief en leg in het 'rationale' veld uit welke ingrediënten je hergebruikt

KAST-INGREDIËNTEN (altijd in huis, NIET op de boodschappenlijst — zet pantry: true):
{PANTRY_LIST}

AANBIEDINGEN BIJ PICNIC DEZE WEEK (gebruik als het past, maar forceer niets):
{PROMOTIONS}

Geef je antwoord als GELDIG JSON — geen markdown, geen extra tekst, alleen JSON:
{
  "recipes": [
    {
      "id": "unieke-kebab-slug",
      "title": "Receptnaam",
      "description": "Verleidelijke beschrijving van 1-2 zinnen",
      "type": "vega",
      "emoji": "🍝",
      "time": 30,
      "difficulty": "easy",
      "servings": {SERVINGS},
      "ingredients": [
        {
          "name": "canonical-slug",
          "display": "Weergavenaam",
          "amount": 2,
          "unit": "stuks",
          "category": "groenten",
          "productPreference": "fresh",
          "pantry": false
        }
      ],
      "steps": [
        "Verwarm de oven voor op 200°C. ...",
        "Kook de pasta..."
      ],
      "usedPromotion": "optioneel: naam van het Picnic-aanbiedingsproduct dat je hebt gebruikt"
    }
  ],
  "rationale": "Leg hier in 2-4 zinnen uit welke ingrediënten je bewust hergebruikt over meerdere recepten en waarom."
}`;

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function usableKey(value: string | undefined) {
  if (!value || value.startsWith('your_')) return '';
  return value;
}

function buildPrompt(
  preferences: string,
  pantryItems: string[],
  promotions: PicnicPromotion[],
  mealCount: number,
  servings: number
) {
  const pantryList = pantryItems.length > 0
    ? pantryItems.join(', ')
    : 'olijfolie, zout, peper, suiker, boter, bloem, sojasaus, honing, azijn, tomatenpuree, paprikapoeder, komijn, kurkuma, chilivlokken, gedroogde oregano, gedroogde tijm, groentebouillon, sesamolie, sesamzaad';

  const promotionsList = promotions.length > 0
    ? promotions.map((p) => `${p.name} (€${(p.price / 100).toFixed(2)})`).join('\n')
    : 'Geen aanbiedingen beschikbaar.';

  const system = SYSTEM_PROMPT
    .replaceAll('{MEAL_COUNT}', String(mealCount))
    .replaceAll('{SERVINGS}', String(servings))
    .replace('{PANTRY_LIST}', pantryList)
    .replace('{PROMOTIONS}', promotionsList);

  const userMessage = preferences?.trim()
    ? `Genereer een weekplan met ${mealCount} maaltijden voor ${servings} personen. Mijn wensen: ${preferences}`
    : `Genereer een verrassend weekplan met ${mealCount} maaltijden voor ${servings} personen met gevarieerde, lekkere recepten.`;

  return { system, userMessage };
}

function extractJson(text: string): string {
  // strip possible markdown code fences
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  // find first { ... } block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  return text;
}

function ensureMealPlanShape(value: unknown): { recipes: MealPlan['recipes']; rationale: string } {
  if (!value || typeof value !== 'object') {
    throw new Error('Response is geen object');
  }
  const candidate = value as { recipes?: unknown; rationale?: unknown };
  if (!Array.isArray(candidate.recipes)) {
    throw new Error('Response mist recipes-array');
  }
  return {
    recipes: candidate.recipes as MealPlan['recipes'],
    rationale: typeof candidate.rationale === 'string' ? candidate.rationale : '',
  };
}

async function callAnthropic(apiKey: string, model: string, system: string, userMessage: string) {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  return response.content.find((part) => part.type === 'text')?.text ?? '';
}

async function callOpenAI(apiKey: string, model: string, system: string, userMessage: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `${system}\n\nJe moet valide JSON teruggeven.` },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 4096,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `OpenAI API gaf HTTP ${res.status}`);
  }
  return data?.choices?.[0]?.message?.content ?? '';
}

async function callGemini(apiKey: string, model: string, system: string, userMessage: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: system }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userMessage }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 4096,
        },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Gemini API gaf HTTP ${res.status}`);
  }
  return data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? '';
}

export async function POST(req: NextRequest) {
  const {
    preferences,
    pantryItems,
    promotions,
    apiKey,
    apiKeys,
    model,
    provider,
    mealCount: rawMealCount,
    servings: rawServings,
  } = await req.json();

  const savedSettings = await readLocalSettings();
  const resolvedProvider = getProviderConfig(provider ?? savedSettings.llmProvider ?? DEFAULT_LLM_PROVIDER);
  const providerId = resolvedProvider.id as LlmProvider;
  const mealCount = clampInt(rawMealCount ?? savedSettings.mealCount, DEFAULT_MEAL_COUNT, 1, 10);
  const servings = clampInt(rawServings ?? savedSettings.servings, DEFAULT_SERVINGS, 1, 12);
  const providerApiKeys = apiKeys as Partial<Record<LlmProvider, string>> | undefined;
  const savedApiKeys: Record<LlmProvider, string> = {
    anthropic: savedSettings.anthropicApiKey,
    openai: savedSettings.openaiApiKey,
    gemini: savedSettings.geminiApiKey,
  };

  const envKey = usableKey(process.env[resolvedProvider.envKey]);
  const resolvedKey = usableKey(providerApiKeys?.[providerId]) || usableKey(apiKey) || usableKey(savedApiKeys[providerId]) || envKey;
  if (!resolvedKey) {
    return NextResponse.json(
      { error: `Geen ${resolvedProvider.label} API-sleutel. Voeg hem toe in Instellingen of als ${resolvedProvider.envKey} env-variabele.` },
      { status: 400 }
    );
  }

  const modelEnvKey = `${resolvedProvider.envKey.replace('_API_KEY', '')}_MODEL`;
  const resolvedModel = process.env[modelEnvKey] || getValidModel(providerId, model ?? savedSettings.model);
  const { system, userMessage } = buildPrompt(preferences, pantryItems ?? [], promotions ?? [], mealCount, servings);

  let text: string;
  try {
    if (providerId === 'openai') {
      text = await callOpenAI(resolvedKey, resolvedModel, system, userMessage);
    } else if (providerId === 'gemini') {
      text = await callGemini(resolvedKey, resolvedModel, system, userMessage);
    } else {
      text = await callAnthropic(resolvedKey, resolvedModel, system, userMessage);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `LLM-fout: ${msg}` }, { status: 500 });
  }

  let parsed: { recipes: MealPlan['recipes']; rationale: string };
  try {
    parsed = ensureMealPlanShape(JSON.parse(extractJson(text)));
  } catch {
    return NextResponse.json(
      { error: 'LLM gaf geen geldige JSON terug. Probeer het opnieuw of kies een ander model.', raw: text },
      { status: 500 }
    );
  }

  const plan: MealPlan = {
    recipes: parsed.recipes,
    rationale: parsed.rationale,
    generatedAt: new Date().toISOString(),
    preferences: preferences ?? '',
    mealCount,
    servings,
  };

  return NextResponse.json({ plan });
}
