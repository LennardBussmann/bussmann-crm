#!/usr/bin/env bash
# Wird alle 10 Minuten per Cron aufgerufen: spielt neue Versionen von GitHub automatisch ein.
# Ausschalten:  rm /etc/cron.d/bussmann-crm-update
set -uo pipefail
cd "$(dirname "$0")/.."
exec 9>/tmp/bussmann-crm-update.lock
flock -n 9 || exit 0   # läuft schon

git fetch -q origin main || exit 0
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "[$(date '+%d.%m.%Y %H:%M')] Neue Version gefunden – aktualisiere …"
  bash deploy/update.sh
fi
