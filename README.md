# hello-picnic

Slimme maaltijdplanner met Picnic-integratie.

## Starten op een nieuwe pc

Gebruik een terminal in de projectmap en draai:

```bash
npm install
npm run dev
```

Open daarna:

```text
http://localhost:3000
```

Als je wel het menu ziet maar de pagina zelf `404` toont:

1. Controleer dat je in de map `hello-picnic` draait, dus dezelfde map waar `package.json` staat.
2. Stop andere servers op poort 3000.
3. Verwijder eventueel de lokale build-cache `.next`.
4. Start opnieuw met `npm run dev`.

Handige routes:

- `http://localhost:3000/`
- `http://localhost:3000/plan`
- `http://localhost:3000/instellingen`
- `http://localhost:3000/bibliotheek`

Maak lokaal een `.env.local` aan voor API-keys en Picnic-inlog. Commit dat bestand niet.
