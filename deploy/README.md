# Deploy — Leaseweb VPS

> **Snelste route:** clone de repo op de VPS en draai `bash deploy/vps-setup.sh` —
> het script doet alle stappen hieronder interactief, detecteert een al-draaiende
> reverse proxy (boekhoudapp) op poort 80/443, en print dan de proxy-snippet die je
> nodig hebt. De handmatige stappen hieronder blijven staan als referentie.

## Eerste keer

1. **Gedeelde Postgres** (eenmalig, als die er nog niet staat):
   ```bash
   docker network create shared_infra
   # eigen compose-project voor postgres, aangesloten op shared_infra, bijv.:
   docker run -d --name postgres --network shared_infra \
     -e POSTGRES_PASSWORD=<superwachtwoord> -v pg_data:/var/lib/postgresql/data postgres:16
   ```
2. **Database + rol voor deze app** (least privilege):
   ```sql
   CREATE ROLE hellopicnic LOGIN PASSWORD '<sterk-wachtwoord>';
   CREATE DATABASE hellopicnic OWNER hellopicnic;
   ```
3. **App-configuratie**: kopieer `.env.example` → `deploy/.env`, vul `DATABASE_URL`
   (host `postgres` op het `shared_infra`-netwerk), `APP_SECRET`, `AUTH_SECRET`, LLM-keys.
   Optioneel: `BRING_API_KEY` (alleen bij Bring i.p.v. Picnic) en
   `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (Google Agenda — zie `deploy/GOOGLE_OAUTH.md`).
4. **Hostnaam**: pas `deploy/Caddyfile` aan (DNS A-record naar de VPS).
5. **Start**: `cd deploy && docker compose up -d`
6. **Migraties + gebruikers** (vanaf WP-03):
   ```bash
   docker compose exec app npm run db:migrate
   docker compose exec app npx tsx scripts/create-user.ts
   ```

## Updaten

**Migraties horen bij elke update** — een nieuwe app-versie kan kolommen verwachten
die de database nog niet heeft (dan crashen pagina's met "er ging iets mis"). De
veiligste route is gewoon het setup-script opnieuw draaien (idempotent, doet ook de
migraties):

```bash
cd ~/hello-picnic && git pull
bash deploy/vps-setup.sh --build     # of zonder --build als je het GHCR-image pullt
```

Handmatig kan ook, maar dan altijd mét de migratie-stap:

```bash
cd deploy
docker compose pull && docker compose up -d          # of: docker build -t ghcr.io/makemespam/hello-picnic:latest .. && docker compose up -d
docker compose --profile tools build tools           # verplicht: anders draait een OUD tools-image de migraties van toen
docker compose --profile tools run --rm tools npm run db:migrate
```

## Backups (nachtelijke cron)

```cron
15 3 * * * docker exec postgres pg_dump -U hellopicnic -Fc hellopicnic > /backup/hellopicnic-$(date +\%F).dump
30 3 * * * docker run --rm -v deploy_hp_data:/data -v /backup:/backup alpine tar czf /backup/hp-images-$(date +\%F).tgz /data/images
45 3 * * * find /backup -mtime +14 -delete
```
Sync `/backup` off-box met rsync/rclone. **Restore testen** (eenmalig gedaan bij oplevering WP-01, herhaal na grote schemawijzigingen):
`pg_restore -U hellopicnic -d hellopicnic_test <dump>` + tarball uitpakken in een verse volume.

## Lokaal ontwikkelen

```bash
docker compose -f deploy/docker-compose.dev.yml up -d   # lokale Postgres
cp .env.example .env                                    # DATABASE_URL → localhost
npm install && npm run dev
```
