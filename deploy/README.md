# Deploy — Leaseweb VPS

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
4. **Hostnaam**: pas `deploy/Caddyfile` aan (DNS A-record naar de VPS).
5. **Start**: `cd deploy && docker compose up -d`
6. **Migraties + gebruikers** (vanaf WP-03):
   ```bash
   docker compose exec app npm run db:migrate
   docker compose exec app npx tsx scripts/create-user.ts
   ```

## Updaten

```bash
cd deploy && docker compose pull && docker compose up -d
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
