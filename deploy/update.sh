#!/usr/bin/env bash
# Neue Version einspielen:  sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull
docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d --build
echo "Aktualisiert."
