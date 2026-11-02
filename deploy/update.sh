#!/usr/bin/env bash
# Neue Version einspielen:  bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> Neue Version holen"
git fetch origin main
git reset --hard origin/main   # lokale Programmänderungen verwerfen (Daten in data/ bleiben unberührt)
echo "==> Neu bauen und starten"
docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d --build
echo
echo "Aktualisiert auf Version: $(git log -1 --format='%h – %s (%cd)' --date=format:'%d.%m.%Y %H:%M')"
echo "Bitte die Seite im Browser mit Strg+F5 neu laden."
