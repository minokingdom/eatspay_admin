const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('admin proof images expose zoom controls and reusable viewer behavior', () => {
  const html = read('이츠페이_관리자_시스템_10.html');
  const accountUtils = read('admin-assets/js/admin-account-utils.js');
  const accounts = read('admin-assets/js/admin-accounts.js');
  const css = read('admin-assets/css/admin-main.css');
  const combined = [html, accountUtils, accounts, css].join('\n');

  assert.match(combined, /data-proof-zoom-open/);
  assert.match(combined, /data-proof-zoom-in/);
  assert.match(combined, /data-proof-zoom-out/);
  assert.match(combined, /data-proof-zoom-reset/);
  assert.match(combined, /data-proof-zoom-close/);
  assert.match(combined, /function openProofImageZoom/);
  assert.match(combined, /function setProofImageZoom/);
  assert.match(combined, /function startProofImagePan/);
  assert.match(combined, /function moveProofImagePan/);
  assert.match(combined, /function endProofImagePan/);
  assert.match(combined, /data-proof-zoom-pan/);
  assert.match(combined, /\.proof-zoom-stage\.is-panning/);
  assert.match(combined, /\.proof-zoom-overlay/);
  assert.match(combined, /\.proof-zoom-stage/);
  assert.match(combined, /\.proof-zoom-image/);
  assert.match(combined, /data-da-logo-crop-pan/);
  assert.match(combined, /data-da-logo-crop-reset/);
  assert.match(combined, /function startDeliveryAgencyLogoCropPan/);
  assert.match(combined, /function moveDeliveryAgencyLogoCropPan/);
  assert.match(combined, /function endDeliveryAgencyLogoCropPan/);
  assert.match(combined, /\.delivery-agency-logo-crop-stage\.is-panning/);
  assert.match(combined, /admin-main\.css\?v=20260629-da-logo-pan/);
});
