const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

test('kakao notification emits transfer success only and suppresses settlement confirmation', () => {
  assert.match(server, /pn\.provider = 'GH Payments'[\s\S]*pn\.query->>'transResult' LIKE '%\uc131\uacf5%'/);
  assert.doesNotMatch(server, /\u2611 \uc774\uce20\ud398\uc774 \uc815\uc0b0 \ud655\uc778/);
});

test('transfer success notification contains agency and elapsed settlement-to-transfer time', () => {
  assert.match(server, /\uc0c1\uc704\ub300\ub9ac\uc810:/);
  assert.match(server, /\uc774\uccb4 \uc18c\uc694\uc2dc\uac04:/);
  assert.match(server, /settlement_confirmed_at/);
  assert.match(server, /extract\(epoch from \(pn\.received_at - cn\.received_at\)\)/);
});

test('transfer event returns a separate all-franchise daily sales summary', () => {
  assert.match(server, /texts:\s*\[formatKakaoPgNotificationEvent\(row\),\s*formatKakaoDailySalesNotification/);
  assert.match(server, /SUM\(total_amount\)/i);
  assert.match(server, /COUNT\(\*\)/i);
  assert.match(server, /type = 'CHARGE'/);
  assert.match(server, /status = 'SUCCESS'/);
  assert.match(server, /AT TIME ZONE 'Asia\/Seoul'/);
  assert.match(server, /\uc774\uce20\ud398\uc774 \uc624\ub298 \ub204\uc801 \ub9e4\ucd9c/);
  assert.match(server, /formatKakaoDailySalesNotification\(dailySalesResult\.rows\[0\], new Date\(\)\)/);
  assert.doesNotMatch(server, /formatKakaoDailySalesNotification\(dailySalesResult\.rows\[0\], row\.received_at\)/);
});
