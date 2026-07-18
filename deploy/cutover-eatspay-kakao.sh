#!/bin/bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
LEGACY=/home/mino/iris_kakao_bot.py
LEGACY_BACKUP="${LEGACY}.bak-eatspay-split-${STAMP}"
ENV_FILE=/home/mino/eatspay-kakao.env

rollback() {
  code=$?
  echo "cutover failed; rolling back (exit=${code})" >&2
  sed -i 's/^EATSPAY_POLLERS_ENABLED=.*/EATSPAY_POLLERS_ENABLED=0/' "$ENV_FILE" || true
  if [ -f "$LEGACY_BACKUP" ]; then cp "$LEGACY_BACKUP" "$LEGACY" || true; fi
  sudo systemctl restart eatspay-kakao-bot.service || true
  sudo systemctl restart iris-kakao-bot.service || true
  exit "$code"
}
trap rollback ERR

cp "$LEGACY" "$LEGACY_BACKUP"
for state in /home/mino/eatspay_tid_event_state.json /home/mino/eatspay_notification_event_state.json; do
  if [ -f "$state" ]; then cp "$state" "${state}.bak-eatspay-split-${STAMP}"; fi
done

sudo systemctl stop iris-kakao-bot.service
install -m 0644 /tmp/iris_kakao_bot.py "$LEGACY"
python3 -m py_compile "$LEGACY" /home/mino/eatspay-kakao/eatspay_kakao_bot.py
sed -i 's/^EATSPAY_POLLERS_ENABLED=.*/EATSPAY_POLLERS_ENABLED=1/' "$ENV_FILE"
sudo systemctl restart eatspay-kakao-bot.service

for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:5010/health | grep -q '"pollersEnabled":true'; then break; fi
  sleep 0.5
done
curl -fsS http://127.0.0.1:5010/health | grep -q '"pollersEnabled":true'

sudo systemctl restart iris-kakao-bot.service
systemctl is-active --quiet eatspay-kakao-bot.service
systemctl is-active --quiet iris-kakao-bot.service
systemctl is-active --quiet iris-bridge.service
trap - ERR
echo "cutover complete backup=${LEGACY_BACKUP}"
