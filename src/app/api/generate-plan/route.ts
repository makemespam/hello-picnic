import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { PicnicPromotion, MealPlan } from '@/lib/types';

const SYSTEM_PROMPT = `Je bent een slimme Nederlandse maaltijdplanner. Je genereert 4 gezonde avondmaaltijden voor 2 personen.

REGELS:
- Alleen vegetarisch of vis — geen vlees
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
      "type": "vega" or "vis",
      "emoji": "🍝",
      "time": 30,
      "difficulty": "easy" or "medium" or "hard",
      "servings": 2,
      "ingredients": [
        {
          "name": "canonical-slug",
          "display": "Weergavenaam",
          "amount": 2,
          "unit": "stuks",
          "category": "groenten" or "fruit" or "zuivel" or "vis" or "kruiden" or "granen" or "peulvruchten" or "overig",
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

function buildPrompt(preferences: string, pantryItems: string[], promotions: PicnicPromotion[]) {
  const pantryList = pantryItems.length > 0
    ? pantryItems.join(', ')
    : 'olijfolie, zout, peper, suiker, boter, bloem, sojasaus, honing, azijn, tomatenpuree, paprikapoeder, komijn, kurkuma, chilivlokken, gedroogde oregano, gedroogde tijm, groentebouillon, sesamolie, sesamzaad';

  const promotionsList = promotions.length > 0
    ? promotions.map((p) => `${p.name} (€${(p.price / 100).toFixed(2)})`).join('\n')
    : 'Geen aanbiedingen beschikbaar.';

  const system = SYSTEM_PROMPT
    .replace('{PANTRY_LIST}', pantryList)
    .replace('{PROMOTIONS}', promotionsList);

  const userMessage = preferences?.trim()
    ? `Genereer een 4-daags weekplan. Mijn wensen: ${preferences}`
    : 'Genereer een verrassend 4-daags weekplan met gevarieerde, lekkere recepten.';

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

export async function POST(req: NextRequest) {
  const { preferences, pantryItems, promotions, apiKey, model } = await req.json();

  const resolvedKey = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!resolvedKey) {
    return NextResponse.json(
      { error: 'Geen Anthropic API-sleutel. Voeg hem toe in Instellingen of als ANTHROPIC_API_KEY env-variabele.' },
      { status: 400 }
    );
  }

  const resolvedModel = model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  const client = new Anthropic({ apiKey: resolvedKey });
  const { system, userMessage } = buildPrompt(preferences, pantryItems ?? [], promotions ?? []);

  let text: string;
  try {
    const response = await client.messages.create({
      model: resolvedModel,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });
    text = response.content[0].type === 'text' ? response.content[0].text : '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `LLM-fout: ${msg}` }, { status: 500 });
  }

  let parsed: { recipes: MealPlan['recipes']; rationale: string };
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    return NextResponse.json(
      { error: 'LLM gaf geen geldige JSON terug. Probeer het opnieuw.', raw: text },
      { status: 500 }
    );
  }

  const plan: MealPlan = {
    recipes: parsed.recipes,
    rationale: parsed.rationale,
    generatedAt: new Date().toISOString(),
    preferences: preferences ?? '',
  };

  return NextResponse.json({ plan });
}
