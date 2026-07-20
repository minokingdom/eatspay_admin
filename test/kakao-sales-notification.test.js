const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

test('kakao notification emits transfer success only and suppresses settlement confirmation', () => {
  assert.match(server, /pn\.provider = 'GH Payments'[\s\S]*pn\.query->>'transResult' LIKE '%\uc131\uacf5%'/);
  assert.doesNotMatch(server, /\u2611 \uc774\uce20\ud398\uc774 \uc815\uc0b0 \ud655\uc778/);
});

test('transfer success notification uses the same payment and settlement times as admin', () => {
  assert.match(server, /\uc0c1\uc704\ub300\ub9ac\uc810:/);
  assert.match(server, /\uc774\uccb4 \uc18c\uc694\uc2dc\uac04:/);
  assert.match(server, /btrim\(ps\.franchise_name\) = btrim\(pn\.query->>'compNm'\)/);
  assert.match(server, /t\.created_at AS payment_approved_at/);
  assert.match(server, /ps\.settled_at AS deposit_completed_at/);
  assert.match(server, /extract\(epoch from \(ps\.settled_at - t\.created_at\)\)/);
});

test('missing transfer elapsed time is never rendered as zero seconds', () => {
  assert.match(server, /if \(!Number\.isFinite\(seconds\) \|\| seconds < 0\) return '\uc2dc\uac04 \ud655\uc778 \ubd88\uac00';/);
  assert.doesNotMatch(server, /Math\.round\(Number\(value\) \|\| 0\)/);
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
