import { NextRequest, NextResponse } from 'next/server';
import type { MealImageResult, Recipe } from '@/lib/types';
import { readLocalSettings } from '@/lib/settings-store';
import {
  DEFAULT_IMAGE_PROVIDER,
  getValidImageModel,
  getValidOpenAIImageQuality,
  type ImageProvider,
  type OpenAIImageQuality,
} from '@/lib/image-models';

function usableKey(value: string | undefined) {
  if (!value || value.startsWith('your_')) return '';
  return value;
}

function buildImagePrompt(recipes: Recipe[]) {
  const recipeNames = recipes.slice(0, 4).map((recipe, index) => `${index + 1}. ${recipe.title}`).join('\n');
  return `Clean top-down minimalist meal prep grid, 2x2 layout, 4 distinct finished dishes, white background, natural daylight, appetizing but realistic home-cooked food, each quadrant clearly separated, no text, no labels, no hands, no packaging, no ingredient mixing between dishes.

Dishes:
${recipeNames}`;
}

async function generateWithGemini(apiKey: string, model: string, prompt: string): Promise<MealImageResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Gemini image API gaf HTTP ${res.status}`);
  }

  const imagePart = data?.candidates?.[0]?.content?.parts?.find((part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData?.data);
  const base64 = imagePart?.inlineData?.data;
  const mimeType = imagePart?.inlineData?.mimeType ?? 'image/png';
  if (!base64) throw new Error('Gemini gaf geen afbeelding terug.');

  return {
    provider: 'gemini',
    model,
    prompt,
    imageDataUrl: `data:${mimeType};base64,${base64}`,
  };
}

async function generateWithOpenAI(
  apiKey: string,
  model: string,
  quality: OpenAIImageQuality,
  prompt: string
): Promise<MealImageResult> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      size: '1024x1024',
      quality,
      output_format: 'webp',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `OpenAI image API gaf HTTP ${res.status}`);
  }

  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error('OpenAI gaf geen afbeelding terug.');

  return {
    provider: 'openai',
    model,
    quality,
    prompt,
    imageDataUrl: `data:image/webp;base64,${base64}`,
  };
}

export async function POST(req: NextRequest) {
  const { recipes, imageProvider, imageModel, openaiImageQuality } = await req.json();
  if (!Array.isArray(recipes) || recipes.length === 0) {
    return NextResponse.json({ error: 'Geen recepten gevonden voor beeldgeneratie.' }, { status: 400 });
  }

  const settings = await readLocalSettings();
  const geminiKey = usableKey(settings.geminiApiKey) || usableKey(process.env.GEMINI_API_KEY);
  const openAiKey = usableKey(settings.openaiApiKey) || usableKey(process.env.OPENAI_API_KEY);
  const provider = (imageProvider ?? settings.imageProvider ?? DEFAULT_IMAGE_PROVIDER) as ImageProvider;
  const model = getValidImageModel(provider, imageModel ?? settings.imageModel);
  const quality = getValidOpenAIImageQuality(openaiImageQuality ?? settings.openaiImageQuality);
  const prompt = buildImagePrompt(recipes as Recipe[]);

  try {
    const result = provider === 'gemini'
      ? geminiKey
        ? await generateWithGemini(geminiKey, model, prompt)
        : null
      : openAiKey
        ? await generateWithOpenAI(openAiKey, model, quality, prompt)
        : null;

    if (!result) {
      return NextResponse.json({ error: `Geen ${provider === 'gemini' ? 'Gemini' : 'OpenAI'} API-sleutel beschikbaar voor beeldgeneratie.` }, { status: 400 });
    }

    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Beeldgeneratie mislukt: ${message}` }, { status: 500 });
  }
}
