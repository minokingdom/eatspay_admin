#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/eatspay}"
REPO_URL="${REPO_URL:-https://github.com/minokingdom/eatspay_admin.git}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-www.eatspay.co.kr}"
ALT_DOMAIN="${ALT_DOMAIN:-eatspay.co.kr}"
APP_USER="${APP_USER:-www-data}"
DB_NAME="${DB_NAME:-eatspay}"
DB_USER="${DB_USER:-eatspay_user}"
DB_PASSWORD="${DB_PASSWORD:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@eatspay.co.kr}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ADMIN_NAME="${ADMIN_NAME:-Eats Pay Admin}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
ISSUE_SSL="${ISSUE_SSL:-false}"
GH_PAYMENTS_PAY_KEY="${GH_PAYMENTS_PAY_KEY:-replace-with-gh-pay-key}"
NTS_SERVICE_KEY="${NTS_SERVICE_KEY:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo -E bash deploy/bootstrap-ubuntu.sh"
  exit 1
fi

rand_hex() {
  openssl rand -hex 32
}

if [[ -z "${DB_PASSWORD}" ]]; then
  DB_PASSWORD="$(rand_hex)"
fi

if [[ -z "${ADMIN_PASSWORD}" ]]; then
  ADMIN_PASSWORD="$(rand_hex)"
fi

JWT_SECRET="${JWT_SECRET:-$(rand_hex)}"
EATSPAY_HMAC_SECRET="${EATSPAY_HMAC_SECRET:-$(rand_hex)}"
ADMIN_ROLLBACK_TOKEN="${ADMIN_ROLLBACK_TOKEN:-$(rand_hex)}"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg git nginx postgresql postgresql-contrib certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p "Number(process.versions.node.split('.')[0])")" -lt 20 ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -v db_user="${DB_USER}" -v db_password="${DB_PASSWORD}" -v db_name="${DB_NAME}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_user')\gexec
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'db_user', :'db_password')\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db_name')\gexec
SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'db_name', :'db_user')\gexec
SQL

if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
else
  rm -rf "${APP_DIR}"
  git clone --branch "${BRANCH}" --single-branch "${REPO_URL}" "${APP_DIR}"
fi

cat > "${APP_DIR}/.env" <<ENV
NODE_ENV=production
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
EATSPAY_HMAC_SECRET=${EATSPAY_HMAC_SECRET}
ADMIN_ROLLBACK_TOKEN=${ADMIN_ROLLBACK_TOKEN}
PORT=3000
PGSSL=false
CORS_ORIGIN=https://${DOMAIN},https://${ALT_DOMAIN}
GH_PAYMENTS_BASE_URL=https://api.ghpayments.kr
GH_PAYMENTS_PAY_KEY=${GH_PAYMENTS_PAY_KEY}
NTS_SERVICE_KEY=${NTS_SERVICE_KEY}
ENV

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chmod 600 "${APP_DIR}/.env"

cd "${APP_DIR}"
npm ci --omit=dev
npm run db:init

ADMIN_EMAIL="${ADMIN_EMAIL}" ADMIN_PASSWORD="${ADMIN_PASSWORD}" ADMIN_NAME="${ADMIN_NAME}" npm run db:create-admin

install -m 0644 "${APP_DIR}/deploy/systemd/eatspay.service" /etc/systemd/system/eatspay.service
systemctl daemon-reload
systemctl enable eatspay
systemctl restart eatspay

install -m 0644 "${APP_DIR}/deploy/nginx/eatspay.conf" /etc/nginx/sites-available/eatspay.conf
ln -sf /etc/nginx/sites-available/eatspay.conf /etc/nginx/sites-enabled/eatspay.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [[ "${ISSUE_SSL}" == "true" ]]; then
  if [[ -z "${LETSENCRYPT_EMAIL}" ]]; then
    echo "Set LETSENCRYPT_EMAIL before ISSUE_SSL=true."
    exit 1
  fi
  certbot --nginx -d "${DOMAIN}" -d "${ALT_DOMAIN}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" --redirect
fi

echo
echo "Eats Pay deployment complete."
echo "App dir: ${APP_DIR}"
echo "Admin email: ${ADMIN_EMAIL}"
echo "Admin password: ${ADMIN_PASSWORD}"
echo "Service status: systemctl status eatspay --no-pager"
echo "Logs: journalctl -u eatspay -f"
