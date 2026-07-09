hello-picnic - Handleiding (Nederlands)
=======================================

Dit project is een Next.js-app.

Vereisten
---------
- Node.js 18 of hoger (Node 20+ aanbevolen)
- npm (wordt standaard met Node.js meegeleverd)

1) Project dependencies installeren
-----------------------------------
Open een terminal in deze map:

    C:\Users\makem\Projects\hello-picnic

Voer uit:

    npm install

2) .env.local aanmaken
----------------------
Maak in de root van het project een bestand:

    .env.local

Gebruik dit voorbeeld (pas de waarden aan naar je eigen keys/account):

    ANTHROPIC_API_KEY=your_anthropic_api_key_here
    OPENAI_API_KEY=your_openai_api_key_here
    GEMINI_API_KEY=your_gemini_api_key_here

    PICNIC_EMAIL=your_picnic_email_here
    PICNIC_PASSWORD=your_picnic_password_here

    NEXT_PUBLIC_APP_URL=http://localhost:3000

Belangrijk:
- Zet hier nooit echte secrets in die je deelt.
- Commit .env.local niet naar git.

3) Development starten
----------------------
Voor lokaal ontwikkelen:

    npm run dev

Open daarna:

    http://localhost:3000

4) Production draaien
---------------------
Production build en server starten:

    npm run build
    npm run start

Standaard draait de app op:

    http://localhost:3000

Tip: Je kunt ook start.bat gebruiken om production automatisch te starten.
