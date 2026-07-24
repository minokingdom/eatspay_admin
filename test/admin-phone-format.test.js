const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const adminFile = fs.readdirSync(root).find((name) => name.endsWith('_10.html'));
assert.ok(adminFile, 'administrator HTML should exist');
const adminHtml = fs.readFileSync(path.join(root, adminFile), 'utf8');
const inquiryModule = fs.readFileSync(path.join(root, 'admin-assets/js/admin-inquiries.js'), 'utf8');
const franchiseModule = fs.readFileSync(path.join(root, 'admin-assets/js/admin-franchise-list-utils.js'), 'utf8');

test('administrator phone formatter renders Korean mobile numbers consistently', () => {
  const { formatAdminPhone, phoneDigits } = require('../admin-assets/js/admin-phone-format');

  assert.equal(formatAdminPhone('01022694869'), '010-2269-4869');
  assert.equal(formatAdminPhone('010-8142-6022'), '010-8142-6022');
  assert.equal(formatAdminPhone('0212345678'), '02-1234-5678');
  assert.equal(formatAdminPhone('01058'), '010-58');
  assert.equal(phoneDigits('010-2269-4869'), '01022694869');
});

test('administrator phone displays and inputs use the shared formatter', () => {
  assert.match(adminHtml, /admin-phone-format\.js\?v=20260725-admin-phone-format1/);
  assert.match(adminHtml, /admin-inquiries\.js\?v=20260725-admin-phone-format1/);
  assert.match(adminHtml, /admin-franchise-list-utils\.js\?v=20260725-admin-phone-format1/);
  assert.match(adminHtml, /formatAdminPhone\(i\.phone\|\|'-'\)/);
  assert.match(adminHtml, /formatAdminPhone\(f\.phone\|\|'-'\)/);
  assert.match(adminHtml, /formatAdminPhone\(a\.phone\|\|'-'\)/);
  assert.match(adminHtml, /data-admin-phone-input="1"/);
  assert.match(adminHtml, /inputmode="numeric"/);
  assert.doesNotMatch(adminHtml, /<td>\$\{esc\([afi]\.phone\|\|'-'\)\}<\/td>/);
  assert.match(inquiryModule, /formatPhone\(inquiry\.phone\s*\|\|\s*'-'\)/);
  assert.match(franchiseModule, /formatAdminPhone\(franchise\.phone\s*\|\|\s*'-'\)/);
});
