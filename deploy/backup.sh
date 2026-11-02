#!/usr/bin/env bash
# Tägliche Sicherung nach /var/backups/bussmann-crm (30 Tage aufbewahrt)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p /var/backups/bussmann-crm
docker compose -f deploy/compose.prod.yml --env-file deploy/.env exec -T crm node --disable-warning=ExperimentalWarning deploy/backup.js
tar czf "/var/backups/bussmann-crm/crm-$(date +%F).tar.gz" -C data backup.sqlite files
rm -f data/backup.sqlite
find /var/backups/bussmann-crm -name '*.tar.gz' -mtime +30 -delete
