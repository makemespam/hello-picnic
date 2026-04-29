import type { IngredientCategory, PicnicArticle, ProductPreference } from '@/lib/types';
import { readLocalSettings } from '@/lib/settings-store';

interface ValidationResult {
  index: number | null;
  searchTerm?: string;
  reason?: string;
}

function usableKey(value: string | undefined) {
  if (!value || value.startsWith('your_')) return '';
  return value;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  return text;
}

function buildPrompt(query: string, category: IngredientCategory | null, preference: ProductPreference | null, articles: PicnicArticle[]) {
  return `Kies het beste Picnic-product voor een boodschappenlijst.

Ingrediënt: ${query}
Categorie: ${category ?? 'onbekend'}
Productvoorkeur: ${preference ?? (category === 'groenten' ? 'fresh' : 'any')}

Regels:
- Als productvoorkeur fresh is: kies verse groente/fruit, geen diepvries, blik, pot, gebroken, à la crème of kant-en-klaar.
- Als productvoorkeur frozen/canned/dried is: die vorm mag juist wel.
- Focus verder op pure producten.
- Kies geen babyvoeding, schoonmaakmiddel, thee, limonade, saus, kant-en-klaarmaaltijd of gemengd product tenzij het ingrediënt zelf daarom vraagt.
- Bij "rode paprika" moet het product rood zijn, niet geel/groen. Hetzelfde geldt voor andere expliciete kleuren.
- Bij wortel/wortelen is "waspeen" een passende verse Picnic-term; kies geen potje of groentemix.
- Bij knoflook kies je verse knoflook, geen knoflooksaus.
- Bij gember kies je verse/pure gember, bijvoorbeeld "Bio gember"; geen gembershot, sap of gekoeld drankje.
- Bij eieren kies je echte eieren, geen eiermie of noedels.
- Kies binnen passende producten liever de goedkoopste optie.
- Als geen kandidaat passend is, geef index null en stel een betere korte zoekterm voor.

Kandidaten:
${articles.map((article, index) => `${index}: ${article.name} | €${(article.price / 100).toFixed(2)} | ${article.unitQuantity ?? 'geen verpakking'}`).join('\n')}

Antwoord alleen als JSON:
{
  "index": 0,
  "searchTerm": "optioneel betere zoekterm",
  "reason": "korte reden"
}`;
}

async function callGemini(apiKey: string, prompt: string) {
  const model = 'gemini-3-flash-preview';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 512,
        },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Gemini gaf HTTP ${res.status}`);
  return data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? '';
}

async function callOpenAI(apiKey: string, prompt: string) {
  const model = 'gpt-5.4-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_completion_tokens: 512,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `OpenAI gaf HTTP ${res.status}`);
  return data?.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(apiKey: string, prompt: string) {
  const model = 'claude-haiku-4-5-20251001';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Anthropic gaf HTTP ${res.status}`);
  return data?.content?.find((part: { type?: string; text?: string }) => part.type === 'text')?.text ?? '';
}

export async function validatePicnicArticlesWithLlm(
  query: string,
  category: IngredientCategory | null,
  preference: ProductPreference | null,
  articles: PicnicArticle[]
): Promise<ValidationResult | null> {
  if (articles.length === 0) return null;

  const settings = await readLocalSettings();
  const prompt = buildPrompt(query, category, preference, articles.slice(0, 8));
  const geminiKey = usableKey(settings.geminiApiKey) || usableKey(process.env.GEMINI_API_KEY);
  const openAiKey = usableKey(settings.openaiApiKey) || usableKey(process.env.OPENAI_API_KEY);
  const anthropicKey = usableKey(settings.anthropicApiKey) || usableKey(process.env.ANTHROPIC_API_KEY);

  try {
    const text = geminiKey
      ? await callGemini(geminiKey, prompt)
      : openAiKey
        ? await callOpenAI(openAiKey, prompt)
        : anthropicKey
          ? await callAnthropic(anthropicKey, prompt)
          : '';
    if (!text) return null;
    const parsed = JSON.parse(extractJson(text)) as ValidationResult;
    if (parsed.index !== null && (parsed.index < 0 || parsed.index >= articles.length)) return null;
    return parsed;
  } catch {
    return null;
  }
}
