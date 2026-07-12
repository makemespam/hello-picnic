#!/usr/bin/env bash
# Hello Picnic — eenmalige VPS-installatie (Ubuntu/Debian met Docker).
# Draai als: bash deploy/vps-setup.sh   (vanuit een checkout van de repo op de VPS)
#
# Wat dit script doet (idempotent — nogmaals draaien is veilig):
#  1. checkt docker + compose
#  2. maakt het shared_infra netwerk en (zo nodig) een gedeelde Postgres 16
#  3. maakt de hellopicnic-rol + database aan (least privilege)
#  4. genereert APP_SECRET/AUTH_SECRET en schrijft deploy/.env (vraagt om domein;
#     AI-keys mag je overslaan — die kun je ook later versleuteld via de app-instellingen zetten)
#  5. detecteert of poort 80/443 al bezet is (bijv. door je boekhoudapp):
#     - vrij  -> start app + meegeleverde Caddy (automatische HTTPS)
#     - bezet -> start alleen de app op 127.0.0.1:3001 en print de site-snippet
#                die je aan je bestaande proxy toevoegt
#  6. haalt het app-image op (of bouwt lokaal met --build), draait migraties
#     en maakt de gezinsaccounts aan
set -euo pipefail
cd "$(dirname "$0")"

BUILD_LOCAL=false
[ "${1:-}" = "--build" ] && BUILD_LOCAL=true
IMAGE="ghcr.io/makemespam/hello-picnic:latest"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mFOUT: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker ontbreekt — installeer eerst Docker (https://docs.docker.com/engine/install/)"
docker compose version >/dev/null 2>&1 || die "docker compose plugin ontbreekt"

say "Netwerk shared_infra"
docker network inspect shared_infra >/dev/null 2>&1 || docker network create shared_infra

say "Gedeelde Postgres 16"
if ! docker ps --format '{{.Names}}' | grep -qx postgres; then
  if docker ps -a --format '{{.Names}}' | grep -qx postgres; then
    docker start postgres
  else
    read -r -s -p "Nieuw Postgres-superuser-wachtwoord (wordt alleen hier gebruikt): " PG_SUPER; echo
    docker run -d --name postgres --restart unless-stopped --network shared_infra \
      -e POSTGRES_PASSWORD="$PG_SUPER" -v pg_data:/var/lib/postgresql/data postgres:16
    sleep 5
  fi
fi

say "Database + rol hellopicnic"
DB_PASS=$(openssl rand -hex 16)
docker exec postgres psql -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='hellopicnic'" | grep -q 1 \
  && echo "rol bestaat al (wachtwoord blijft ongewijzigd)" \
  || { docker exec postgres psql -U postgres -c "CREATE ROLE hellopicnic LOGIN PASSWORD '$DB_PASS';"; NEW_ROLE=1; }
docker exec postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='hellopicnic'" | grep -q 1 \
  || docker exec postgres psql -U postgres -c "CREATE DATABASE hellopicnic OWNER hellopicnic;"

say "Configuratie (deploy/.env)"
if [ -f .env ]; then
  echo ".env bestaat al — laat ik staan"
else
  read -r -p "Publieke hostnaam [eten.eenshop.nl]: " DOMAIN; DOMAIN=${DOMAIN:-eten.eenshop.nl}
  [ "${NEW_ROLE:-}" = "1" ] || { read -r -s -p "Bestaand hellopicnic-DB-wachtwoord: " DB_PASS; echo; }
  read -r -p "ANTHROPIC_API_KEY (Enter = later via app-instellingen): " K_ANT || true
  read -r -p "GEMINI_API_KEY (Enter = overslaan): " K_GEM || true
  read -r -p "OPENAI_API_KEY (Enter = overslaan): " K_OAI || true
  read -r -p "DEEPSEEK_API_KEY (Enter = overslaan): " K_DS || true
  cat > .env <<ENV
DATABASE_URL=postgres://hellopicnic:${DB_PASS}@postgres:5432/hellopicnic
APP_SECRET=$(openssl rand -base64 32)
AUTH_SECRET=$(openssl rand -base64 32)
APP_BASE_URL=https://${DOMAIN}
TZ=Europe/Amsterdam
DATA_DIR=/data
STORAGE_DRIVER=fs
PICNIC_API_BASE=https://storefront-prod.nl.picnicinternational.com/api
PICNIC_API_VERSION=17
ANTHROPIC_API_KEY=${K_ANT:-}
GEMINI_API_KEY=${K_GEM:-}
OPENAI_API_KEY=${K_OAI:-}
DEEPSEEK_API_KEY=${K_DS:-}
ENV
  chmod 600 .env
  sed -i "s/eten\.example\.nl/${DOMAIN}/" Caddyfile 2>/dev/null || true
fi
DOMAIN=$(grep '^APP_BASE_URL=' .env | sed 's|.*https://||')

say "App-image"
if $BUILD_LOCAL; then
  docker build -t "$IMAGE" .. || die "lokale build mislukt"
elif ! docker pull "$IMAGE" 2>/dev/null; then
  echo "Pull van $IMAGE mislukt (privé-package?). Opties:"
  echo "  a) docker login ghcr.io -u <github-gebruiker>  (PAT met read:packages) en opnieuw draaien"
  echo "  b) dit script draaien met --build (bouwt lokaal uit deze checkout)"
  die "geen image beschikbaar"
fi

say "Poort 80/443-detectie"
if ss -tln 2>/dev/null | grep -qE ':(80|443)\s'; then
  echo "Poort 80/443 is al bezet (waarschijnlijk je boekhoud-proxy) — app start op 127.0.0.1:3001."
  cat > docker-compose.override.yml <<'OVR'
# Auto-gegenereerd door vps-setup.sh: bestaande reverse proxy op deze VPS gedetecteerd.
# De meegeleverde caddy-service wordt niet gestart; de app luistert lokaal op :3001.
services:
  app:
    ports:
      - '127.0.0.1:3001:3000'
OVR
  docker compose up -d app
  echo
  echo "── Voeg dit toe aan je bestaande proxy ─────────────────────────"
  echo "Caddy:   ${DOMAIN} { reverse_proxy 127.0.0.1:3001 }"
  echo "Nginx:   server { server_name ${DOMAIN}; listen 443 ssl; ... location / { proxy_pass http://127.0.0.1:3001; proxy_set_header Host \$host; } }"
  echo "         (nginx: vergeet certbot --nginx -d ${DOMAIN} niet)"
  echo "────────────────────────────────────────────────────────────────"
else
  echo "Poort 80/443 vrij — meegeleverde Caddy regelt HTTPS voor ${DOMAIN}."
  docker compose up -d
fi

say "Migraties"
docker compose --profile tools run --rm tools npm run db:migrate

say "Gezinsaccounts"
for WIE in "jouw account" "account van je partner"; do
  read -r -p "E-mail voor ${WIE} (Enter = overslaan): " EMAIL || true
  [ -z "${EMAIL:-}" ] && continue
  read -r -p "Naam: " NAAM
  read -r -s -p "Wachtwoord: " WW; echo
  docker compose --profile tools run --rm tools npx tsx scripts/create-user.ts "$EMAIL" "$NAAM" "$WW"
done

say "Gezondheidscheck"
sleep 2
docker compose exec app node -e "fetch('http://localhost:3000/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))" \
  && echo && echo "✅ Klaar! Open https://${DOMAIN} — en vergeet de backup-cron niet (deploy/README.md)."
