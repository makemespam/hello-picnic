// Seeds a development/e2e database (docs/TESTING.md §2).
// WP-03 slice: 1 login user for local dev + the e2e/secret-leak sentinel data flow.
// WP-04 adds: 12 recipes (3 source='card' with small generated placeholder photos
// written through the StorageAdapter, 9 source='ai' without photos).
//
// DEVIATION (flagged per .cursorrules): the WP-04 scope summary line also mentions
// "1 draft plan", but `plans`/`plan_meals` are WP-06's tables (docs/ARCHITECTURE.md §2,
// schema.ts header) — builders may not create tables outside their own WP, so no plan
// is seeded here. WP-06 should extend this script when it adds the plans schema.
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { getDb } from '../src/server/db/client';
import { users } from '../src/server/db/schema';
import { createRecipe, findRecipeBySourceRef } from '../src/server/services/recipeService';
import type { RecipeCreateInput } from '../src/shared/recipes';

const DEV_USER = {
  email: 'gezin@example.com',
  name: 'Het gezin',
  password: 'proefkonijn123',
};
const BCRYPT_COST = 12;

interface SeedRecipe {
  sourceRef: string;
  photo?: { r: number; g: number; b: number };
  input: RecipeCreateInput;
}

function recipe(sourceRef: string, photo: SeedRecipe['photo'], input: RecipeCreateInput): SeedRecipe {
  return { sourceRef, photo, input };
}

const SEED_RECIPES: SeedRecipe[] = [
  recipe('seed-recipe-1', { r: 214, g: 91, b: 67 }, {
    source: 'card',
    title: 'Romige tomatensoep met basilicum',
    description: 'Snelle troostsoep met een scheut room en verse basilicum.',
    type: 'vegetarisch',
    styles: ['makkelijk', 'gezin'],
    timeMin: 25,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: [
      'Fruit de ui glazig in een scheutje olie.',
      'Voeg de tomatenblokjes toe en laat 15 minuten sudderen.',
      'Pureer de soep glad en roer de room erdoor.',
      'Serveer met gehakte basilicum.',
    ],
    ingredients: [
      { nameKey: 'tomaat', display: 'Tomatenblokjes uit blik', amount: 800, unit: 'g', category: 'groenten', productPreference: 'canned', pantry: false },
      { nameKey: 'ui', display: 'Ui', amount: 1, unit: 'stuks', category: 'groenten', pantry: false },
      { nameKey: 'kookroom', display: 'Kookroom', amount: 100, unit: 'ml', category: 'zuivel', productPreference: 'fresh', pantry: false },
      { nameKey: 'basilicum', display: 'Verse basilicum', amount: 1, unit: 'bos', category: 'kruiden', pantry: false },
    ],
  }),
  recipe('seed-recipe-2', { r: 235, g: 165, b: 105 }, {
    source: 'card',
    title: 'Zalm met broccoli en citroen',
    description: 'Ovenzalm met knapperige broccoli en citroen.',
    type: 'vis',
    styles: ['fit', 'snel'],
    timeMin: 30,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: [
      'Verwarm de oven voor op 200°C.',
      'Verdeel de broccoli en zalm over een bakplaat, besprenkel met olie.',
      'Bak 15-18 minuten tot de zalm gaar is.',
      'Serveer met een partje citroen.',
    ],
    ingredients: [
      { nameKey: 'zalmfilet', display: 'Zalmfilet', amount: 4, unit: 'stuks', category: 'vis', productPreference: 'fresh', pantry: false },
      { nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten', pantry: false },
      { nameKey: 'citroen', display: 'Citroen', amount: 1, unit: 'stuks', category: 'fruit', pantry: false },
    ],
  }),
  recipe('seed-recipe-3', { r: 120, g: 66, b: 48 }, {
    source: 'card',
    title: 'Runderstoof met wortel',
    description: 'Langzaam gestoofd rundvlees met wortel en tijm.',
    type: 'rund',
    styles: ['comfort', 'luxe'],
    timeMin: 150,
    difficulty: 'uitdagend',
    servingsBase: 4,
    steps: [
      'Braad de runderlappen rondom aan.',
      'Voeg wortel, tijm en bouillon toe.',
      'Laat 2,5 uur zachtjes stoven tot het vlees mals is.',
      'Breng op smaak en serveer.',
    ],
    ingredients: [
      { nameKey: 'runderlappen', display: 'Runderlappen', amount: 800, unit: 'g', category: 'vis', productPreference: 'fresh', pantry: false },
      { nameKey: 'wortel', display: 'Wortel', amount: 4, unit: 'stuks', category: 'groenten', pantry: false },
      { nameKey: 'tijm', display: 'Verse tijm', amount: 1, unit: 'bos', category: 'kruiden', pantry: false },
      { nameKey: 'runderbouillon', display: 'Runderbouillon', amount: 500, unit: 'ml', category: 'overig', pantry: true },
    ],
  }),
  recipe('seed-recipe-4', undefined, {
    source: 'ai',
    title: 'Vega curry met kokosmelk',
    description: 'Pittige curry met linzen en spinazie.',
    type: 'vegetarisch',
    styles: ['wereldkeuken', 'gezin'],
    timeMin: 35,
    difficulty: 'gemiddeld',
    servingsBase: 4,
    steps: [
      'Bak het kerriepoeder kort mee met een gesnipperde ui.',
      'Voeg linzen en kokosmelk toe, laat 20 minuten sudderen.',
      'Roer de spinazie erdoor tot deze geslonken is.',
      'Breng op smaak met zout en peper.',
    ],
    ingredients: [
      { nameKey: 'kokosmelk', display: 'Kokosmelk', amount: 400, unit: 'ml', category: 'overig', productPreference: 'canned', pantry: false },
      { nameKey: 'linzen', display: 'Rode linzen', amount: 200, unit: 'g', category: 'peulvruchten', productPreference: 'dried', pantry: false },
      { nameKey: 'spinazie', display: 'Verse spinazie', amount: 150, unit: 'g', category: 'groenten', pantry: false },
      { nameKey: 'kerriepoeder', display: 'Kerriepoeder', amount: 2, unit: 'el', category: 'kruiden', pantry: true },
    ],
  }),
  recipe('seed-recipe-5', undefined, {
    source: 'ai',
    title: 'Kipsaté met rijst',
    description: 'Kipsaté in pindasaus met gestoomde rijst.',
    type: 'kip',
    styles: ['gezin', 'comfort'],
    timeMin: 40,
    difficulty: 'gemiddeld',
    servingsBase: 4,
    steps: [
      'Snijd de kipfilet in blokjes en bak gaar.',
      'Maak de satésaus met pindakaas, sojasaus en water.',
      'Kook de rijst volgens de verpakking.',
      'Serveer de kip met saus over de rijst.',
    ],
    ingredients: [
      { nameKey: 'kipfilet', display: 'Kipfilet', amount: 600, unit: 'g', category: 'vis', productPreference: 'fresh', pantry: false },
      { nameKey: 'pindakaas', display: 'Pindakaas', amount: 150, unit: 'g', category: 'overig', pantry: true },
      { nameKey: 'rijst', display: 'Rijst', amount: 300, unit: 'g', category: 'granen', pantry: true },
    ],
  }),
  recipe('seed-recipe-6', undefined, {
    source: 'ai',
    title: 'Vegan chili sin carne',
    description: 'Stevige chili met kidneybonen en paprika.',
    type: 'vegan',
    styles: ['budget', 'makkelijk'],
    timeMin: 30,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: [
      'Fruit ui, paprika en knoflook aan.',
      'Voeg tomatenblokjes en kidneybonen toe.',
      'Laat 15 minuten sudderen met chilipoeder en komijn.',
      'Serveer met rijst of tortillachips.',
    ],
    ingredients: [
      { nameKey: 'kidneybonen', display: 'Kidneybonen uit blik', amount: 400, unit: 'g', category: 'peulvruchten', productPreference: 'canned', pantry: false },
      { nameKey: 'paprika', display: 'Rode paprika', amount: 2, unit: 'stuks', category: 'groenten', pantry: false },
      { nameKey: 'tomatenblokjes', display: 'Tomatenblokjes uit blik', amount: 400, unit: 'g', category: 'groenten', productPreference: 'canned', pantry: false },
    ],
  }),
  recipe('seed-recipe-7', undefined, {
    source: 'ai',
    title: 'Varkenshaas met appelmoes',
    description: 'Mals gebakken varkenshaas met huisgemaakte appelmoes.',
    type: 'varken',
    styles: ['luxe', 'comfort'],
    timeMin: 35,
    difficulty: 'gemiddeld',
    servingsBase: 4,
    steps: [
      'Kruid de varkenshaas en bak rondom bruin.',
      'Laat 10 minuten rusten onder aluminiumfolie.',
      'Kook de appels zacht met een scheutje water tot moes.',
      'Snijd de varkenshaas in plakken en serveer met de appelmoes.',
    ],
    ingredients: [
      { nameKey: 'varkenshaas', display: 'Varkenshaas', amount: 600, unit: 'g', category: 'vis', productPreference: 'fresh', pantry: false },
      { nameKey: 'appel', display: 'Appels', amount: 4, unit: 'stuks', category: 'fruit', pantry: false },
    ],
  }),
  recipe('seed-recipe-8', undefined, {
    source: 'ai',
    title: 'Pasta pesto met cherrytomaatjes',
    description: 'Snel weekdaggerecht met verse pesto.',
    type: 'vegetarisch',
    styles: ['snel', 'makkelijk'],
    timeMin: 20,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Kook de pasta beetgaar.', 'Halveer de cherrytomaatjes.', 'Meng de pasta met pesto en tomaatjes.', 'Serveer met Parmezaan.'],
    ingredients: [
      { nameKey: 'pasta', display: 'Pasta', amount: 400, unit: 'g', category: 'granen', pantry: true },
      { nameKey: 'pesto', display: 'Groene pesto', amount: 1, unit: 'stuks', category: 'overig', pantry: false },
      { nameKey: 'cherrytomaat', display: 'Cherrytomaatjes', amount: 250, unit: 'g', category: 'groenten', pantry: false },
    ],
  }),
  recipe('seed-recipe-9', undefined, {
    source: 'ai',
    title: 'Kabeljauw uit de oven met venkel',
    description: 'Lichte ovenschotel met venkel en witte wijn.',
    type: 'vis',
    styles: ['fit', 'luxe'],
    timeMin: 30,
    difficulty: 'gemiddeld',
    servingsBase: 4,
    steps: [
      'Snijd de venkel in dunne plakken en bak kort aan.',
      'Leg de kabeljauwfilets erop in een ovenschaal.',
      'Blus af met witte wijn en zet 15 minuten in de oven op 190°C.',
      'Serveer met aardappelpuree.',
    ],
    ingredients: [
      { nameKey: 'kabeljauwfilet', display: 'Kabeljauwfilet', amount: 4, unit: 'stuks', category: 'vis', productPreference: 'fresh', pantry: false },
      { nameKey: 'venkel', display: 'Venkel', amount: 2, unit: 'stuks', category: 'groenten', pantry: false },
    ],
  }),
  recipe('seed-recipe-10', undefined, {
    source: 'ai',
    title: 'Gehaktballen in tomatensaus',
    description: 'Klassieke gehaktballen met een rijke tomatensaus.',
    type: 'rund',
    styles: ['gezin', 'comfort'],
    timeMin: 40,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: [
      'Meng gehakt met ei, paneermeel en kruiden, rol tot balletjes.',
      'Bak de gehaktballen rondom bruin.',
      'Voeg tomatensaus toe en laat 20 minuten sudderen.',
      'Serveer met pasta of aardappelpuree.',
    ],
    ingredients: [
      { nameKey: 'rundergehakt', display: 'Rundergehakt', amount: 500, unit: 'g', category: 'vis', productPreference: 'fresh', pantry: false },
      { nameKey: 'tomatensaus', display: 'Passata', amount: 500, unit: 'ml', category: 'groenten', productPreference: 'canned', pantry: false },
      { nameKey: 'paneermeel', display: 'Paneermeel', amount: 50, unit: 'g', category: 'granen', pantry: true },
    ],
  }),
  recipe('seed-recipe-11', undefined, {
    source: 'ai',
    title: 'Thaise groentecurry',
    description: 'Frisse curry met wokgroenten en Thaise kruidenpasta.',
    type: 'vegan',
    styles: ['wereldkeuken', 'fit'],
    timeMin: 30,
    difficulty: 'gemiddeld',
    servingsBase: 4,
    steps: [
      'Bak de currypasta kort aan in een wok.',
      'Voeg kokosmelk en wokgroenten toe.',
      'Laat 10 minuten sudderen tot de groenten beetgaar zijn.',
      'Serveer met jasmijnrijst.',
    ],
    ingredients: [
      { nameKey: 'currypasta', display: 'Rode currypasta', amount: 3, unit: 'el', category: 'kruiden', pantry: true },
      { nameKey: 'kokosmelk', display: 'Kokosmelk', amount: 400, unit: 'ml', category: 'overig', productPreference: 'canned', pantry: false },
      { nameKey: 'wokgroenten', display: 'Wokgroentemix', amount: 400, unit: 'g', category: 'groenten', pantry: false },
    ],
  }),
  recipe('seed-recipe-12', undefined, {
    source: 'ai',
    title: 'Kip tikka masala',
    description: 'Romige currykip met een diepe kruidensmaak.',
    type: 'kip',
    styles: ['wereldkeuken', 'luxe'],
    timeMin: 45,
    difficulty: 'uitdagend',
    servingsBase: 4,
    steps: [
      'Marineer de kip minstens 30 minuten in yoghurt en kruiden.',
      'Bak de kip aan en zet apart.',
      'Maak de saus met tomatenpuree, room en garam masala.',
      'Voeg de kip terug toe en laat 10 minuten sudderen.',
    ],
    ingredients: [
      { nameKey: 'kipfilet', display: 'Kipfilet', amount: 600, unit: 'g', category: 'vis', productPreference: 'fresh', pantry: false },
      { nameKey: 'yoghurt', display: 'Volle yoghurt', amount: 150, unit: 'g', category: 'zuivel', pantry: false },
      { nameKey: 'kookroom', display: 'Kookroom', amount: 200, unit: 'ml', category: 'zuivel', productPreference: 'fresh', pantry: false },
      { nameKey: 'garammasala', display: 'Garam masala', amount: 1, unit: 'el', category: 'kruiden', pantry: true },
    ],
  }),
];

async function seedUser() {
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEV_USER.email)).limit(1);

  if (existing) {
    console.log(`[seed-dev] Gebruiker bestaat al: ${DEV_USER.email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(DEV_USER.password, BCRYPT_COST);
  await db.insert(users).values({ email: DEV_USER.email, name: DEV_USER.name, passwordHash });
  console.log(`[seed-dev] Aangemaakt: ${DEV_USER.email} / ${DEV_USER.password} (alleen voor dev/e2e)`);
}

/** Small solid-color placeholder photo, generated on the fly rather than checked-in
 * binary fixtures — saveRecipeImage derives the real 640w/1280w/blur webp set from it. */
async function placeholderPhoto(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

async function seedRecipes() {
  let created = 0;
  for (const seed of SEED_RECIPES) {
    const existing = await findRecipeBySourceRef(seed.sourceRef);
    if (existing) continue;

    const photo = seed.photo ? await placeholderPhoto(seed.photo) : undefined;
    await createRecipe(seed.input, {
      sourceRef: seed.sourceRef,
      photo,
      photoKind: photo ? 'card' : undefined,
    });
    created += 1;
  }

  if (created === 0) {
    console.log('[seed-dev] Recepten bestaan al — niets toegevoegd.');
  } else {
    console.log(`[seed-dev] ${created} recept(en) aangemaakt (van ${SEED_RECIPES.length} in totaal).`);
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.log('[seed-dev] NODE_ENV=production — refusing to seed known dev data, skipping.');
    return;
  }

  await seedUser();
  await seedRecipes();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
