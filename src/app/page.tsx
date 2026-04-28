import Link from 'next/link';

const features = [
  {
    icon: '🤖',
    title: 'LLM genereert recepten',
    description: 'Claude bedenkt elke keer verse, gezonde vega- en visrecepten op basis van jouw wensen.',
  },
  {
    icon: '🏷️',
    title: 'Picnic-aanbiedingen',
    description: 'De app haalt automatisch de aanbiedingen op en verwerkt ze in je weekplan.',
  },
  {
    icon: '♻️',
    title: 'Slim ingrediënten-hergebruik',
    description: 'Verse tijm of koriander in twee recepten, aardappelen slim verdeeld — zo gooi je nooit wat weg.',
  },
  {
    icon: '🛒',
    title: 'Direct naar Picnic',
    description: 'De boodschappenlijst gaat in één klik naar je Picnic-mandje.',
  },
];

export default function Home() {
  return (
    <div className="flex flex-col items-center gap-16 py-12 text-center">
      {/* Hero */}
      <div className="flex flex-col items-center gap-6">
        <div className="text-8xl">🛒</div>
        <h1 className="text-5xl font-extrabold tracking-tight text-stone-900">
          Hello <span className="text-orange-500">Picnic</span>
        </h1>
        <p className="max-w-xl text-xl text-stone-500">
          Jouw slimme maaltijdplanner. Gezonde vega- en visrecepten, gegenereerd door AI,
          afgestemd op jouw wensen én de Picnic-aanbiedingen van deze week.
        </p>
        <Link href="/plan" className="btn-primary text-lg px-8 py-4">
          Maak mijn weekplan ✨
        </Link>
        <p className="text-sm text-stone-400">
          Eerst instellen?{' '}
          <Link href="/instellingen" className="text-orange-500 underline underline-offset-2">
            Voeg je API-sleutel en Picnic-inlog toe →
          </Link>
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 w-full max-w-3xl text-left">
        {features.map((f) => (
          <div key={f.title} className="card p-6 flex gap-4">
            <div className="text-3xl shrink-0">{f.icon}</div>
            <div>
              <h3 className="font-bold text-stone-900 mb-1">{f.title}</h3>
              <p className="text-sm text-stone-500">{f.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
