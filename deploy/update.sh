#!/usr/bin/env bash
# Neue Version einspielen:  bash deploy/update.sh
# (läuft normalerweise automatisch alle 10 Minuten über deploy/auto-update.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
echo "==> Neue Version holen"
git fetch origin main
git reset --hard origin/main   # lokale Programmänderungen verwerfen (Daten in data/ bleiben unberührt)

# Versionsinfo für die App (Einstellungen + Hinweis "Neue Version" im Browser)
mkdir -p data
printf '{"commit":"%s","subject":%s,"date":"%s","installed":"%s"}\n' \
  "$(git rev-parse --short HEAD)" \
  "$(git log -1 --format=%s | sed 's/\\/\\\\/g; s/"/\\"/g; s/.*/"&"/')" \
  "$(git log -1 --format=%cd --date=format:'%d.%m.%Y %H:%M')" \
  "$(date '+%d.%m.%Y %H:%M')" > data/version.json

echo "==> Neu bauen und starten"
docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d --build
docker image prune -f >/dev/null 2>&1 || true

# Automatische Updates einrichten (einmalig)
if [ -d /etc/cron.d ] && [ ! -f /etc/cron.d/bussmann-crm-update ] && [ "$(id -u)" = "0" ]; then
  echo "*/10 * * * * root bash ${APP_DIR}/deploy/auto-update.sh >> /var/log/bussmann-crm-update.log 2>&1" > /etc/cron.d/bussmann-crm-update
  echo "==> Automatische Updates eingerichtet (Prüfung alle 10 Minuten)"
fi

echo
echo "Aktualisiert auf Version: $(git log -1 --format='%h – %s (%cd)' --date=format:'%d.%m.%Y %H:%M')"
