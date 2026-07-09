// Default HelloFresh-style pantry: things assumed to always be in the house.
// Ported verbatim from v1's data/pantry.ts (docs/workpackages/WP-03 §7) —
// seeds the household settings' pantry checklist; households customize it in
// Instellingen from there on (stored as a plain string[] of keys in `settings`).
export const DEFAULT_PANTRY: Record<string, string> = {
  // oils & fats
  olijfolie: 'Olijfolie',
  zonnebloemolie: 'Zonnebloemolie',
  sesamolie: 'Sesamolie',
  boter: 'Boter',

  // basic seasoning
  zout: 'Zout',
  peper: 'Zwarte peper',
  suiker: 'Suiker',
  'bruine-suiker': 'Bruine basterdsuiker',

  // dry pantry
  bloem: 'Bloem',
  maizena: 'Maizena',
  paneermeel: 'Paneermeel',
  panko: 'Panko',

  // condiments & sauces
  sojasaus: 'Sojasaus',
  vissaus: 'Vissaus',
  oestersaus: 'Oestersaus',
  honing: 'Honing',
  dijonmosterd: 'Dijonmosterd',
  tomatenpuree: 'Tomatenpuree',

  // vinegars
  'witte-wijnazijn': 'Witte wijnazijn',
  'rode-wijnazijn': 'Rode wijnazijn',
  rijstazijn: 'Rijstazijn',
  balsamicoazijn: 'Balsamicoazijn',

  // ground spices
  paprikapoeder: 'Paprikapoeder',
  'gerookt-paprikapoeder': 'Gerookt paprikapoeder',
  komijn: 'Komijn (gemalen)',
  korianderzaad: 'Korianderzaad (gemalen)',
  kurkuma: 'Kurkuma',
  chilivlokken: 'Chilivlokken',
  cayennepeper: 'Cayennepeper',
  kaneel: 'Kaneel (gemalen)',
  nootmuskaat: 'Nootmuskaat',
  knoflookpoeder: 'Knoflookpoeder',
  uienpoeder: 'Uienpoeder',
  'garam-masala': 'Garam masala',
  currykruiden: 'Kerriepoeder',

  // dried herbs
  'gedroogde-oregano': 'Gedroogde oregano',
  'gedroogde-tijm': 'Gedroogde tijm',
  'gedroogde-rozemarijn': 'Gedroogde rozemarijn',

  // stock & cooking wine
  groentebouillon: 'Groentebouillon (blokje of poeder)',
  'droge-witte-wijn': 'Droge witte wijn (voor koken)',

  // seeds & misc
  sesamzaad: 'Sesamzaad',
};

export const DEFAULT_PANTRY_KEYS = Object.keys(DEFAULT_PANTRY);
