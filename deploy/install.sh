#!/usr/bin/env bash
# Bussmann CRM – Einrichtung auf einem frischen Ubuntu-Server (22.04/24.04)
# Aufruf im Projektordner:  sudo bash deploy/install.sh crm.landtechnik-bussmann.de
set -euo pipefail
DOMAIN="${1:?Bitte Domain angeben, z. B.: sudo bash deploy/install.sh crm.landtechnik-bussmann.de}"
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"

echo "==> Docker installieren"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Firewall (SSH, HTTP, HTTPS)"
if command -v ufw >/dev/null; then ufw allow OpenSSH; ufw allow 80; ufw allow 443; ufw --force enable; fi

echo "==> Konfiguration schreiben"
cat > deploy/Caddyfile <<CADDY
${DOMAIN} {
  encode gzip
  reverse_proxy crm:3000
}
CADDY
cat > deploy/.env <<ENV
DOMAIN=${DOMAIN}
ENV

echo "==> Starten"
docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d --build

echo "==> Tägliche Datensicherung (03:00, 30 Tage aufbewahrt)"
echo "0 3 * * * root bash ${APP_DIR}/deploy/backup.sh >> /var/log/bussmann-crm-backup.log 2>&1" > /etc/cron.d/bussmann-crm-backup

echo
echo "Fertig! In 1–2 Minuten erreichbar unter: https://${DOMAIN}"
echo "Beim ersten Aufruf den Administrator-Zugang anlegen."
