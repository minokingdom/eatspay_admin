# Eats Pay Web Deployment

This project is ready to run as a real web service on a VPS.

## Target layout

- App service: `https://eatspay.kr`
- Homepage space: `https://eatspay.co.kr`
- Backend/API: same Node process on the VPS
- Database: PostgreSQL on the VPS or a managed PostgreSQL service
- Reverse proxy: Nginx
- TLS: Let's Encrypt

## Files you need on the server

- `server.js`
- `index.html`
- `admin` HTML file
- `css/`
- `js/`
- `uploads/`
- `homepage/` copied to `/var/www/eatspay-home` for homepage static files
- `.env`

## Server environment

Use `deploy/production.env.example` as the base.

Required values:

```text
DATABASE_URL
JWT_SECRET
EATSPAY_HMAC_SECRET
ADMIN_ROLLBACK_TOKEN
PORT
CORS_ORIGIN
GH_PAYMENTS_BASE_URL
GH_PAYMENTS_PAY_KEY
```

## Nginx

Use `deploy/nginx/eatspay.conf` as the first reverse proxy template.

The initial config routes:

- `eatspay.kr` to the app/API Node server on `127.0.0.1:3000`
- `eatspay.co.kr` and `www.eatspay.co.kr` to static homepage files in `/var/www/eatspay-home`

Homepage files live in `homepage/`. The bootstrap script copies this folder to `/var/www/eatspay-home`. For a manual sync, run:

```bash
npm run homepage:sync -- --target /var/www/eatspay-home
```

If the repository has no `homepage/index.html`, the bootstrap script creates a simple placeholder `index.html` only when the folder has no index yet.

After DNS points to the VPS, run Certbot. Certbot will add the HTTPS server block and redirect rules.

## systemd

Use `deploy/systemd/eatspay.service` to run the app on boot.

## One-command Ubuntu bootstrap

On a fresh Ubuntu 22.04 or 24.04 server, clone the repo and run:

```bash
sudo -E bash deploy/bootstrap-ubuntu.sh
```

Useful environment variables:

```bash
export REPO_URL=https://github.com/minokingdom/eatspay_admin.git
export BRANCH=main
export DOMAIN=eatspay.kr
export ALT_DOMAIN=
export HOME_DOMAIN=eatspay.co.kr
export HOME_ALT_DOMAIN=www.eatspay.co.kr
export ADMIN_EMAIL=admin@eatspay.kr
export ADMIN_PASSWORD='change-this-before-production'
export GH_PAYMENTS_PAY_KEY='real-payment-key'
```

After DNS `A` records point at the VPS IP, issue SSL:

```bash
export ISSUE_SSL=true
export LETSENCRYPT_EMAIL=admin@eatspay.kr
sudo -E bash deploy/bootstrap-ubuntu.sh
```

## Bootstrap order

1. Provision Ubuntu VPS.
2. Install Node.js, Nginx, PostgreSQL, and Certbot.
3. Create the `eatspay` database and user.
4. Copy this repo to `/opt/eatspay`.
5. Create `/opt/eatspay/.env`.
6. Run `npm install`.
7. Run `npm run db:init`.
8. Run `npm run db:create-admin`.
9. Enable the systemd service.
10. Point DNS `A` records for `eatspay.kr`, `eatspay.co.kr`, and `www.eatspay.co.kr` to the VPS public IP.
11. Issue the SSL certificate with Certbot.

## Frontend API base

`js/config.js` now defaults to:

```js
https://eatspay.kr
```

That lets the same build work on the web and inside the Android app without a tunnel URL.

## Billing integration

When a real `GH_PAYMENTS_PAY_KEY` is present, the server proxies:

- `POST /api/card/register` -> `POST /api/billing/reg`
- `POST /api/payment/charge` -> `POST /api/billing/pay` when the card id starts with `rb_`
- admin-only proxy endpoints under `/api/ghpayments/*`

If the key is missing or still set to a placeholder such as `replace-with-gh-pay-key`, card registration skips the PG call and stores the card metadata in PostgreSQL only. Add the real PG key later and restart the server to enable GH Payments billing registration.
