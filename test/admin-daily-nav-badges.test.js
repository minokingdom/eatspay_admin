const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(
  path.resolve(__dirname, '..', '이츠페이_관리자_시스템_10.html'),
  'utf8'
);

test('admin sidebar badges count only records created today in Korea', () => {
  assert.match(html, /function koreaDateKey\(value=new Date\(\)\)/);
  assert.match(html, /timeZone:'Asia\/Seoul'/);
  assert.match(html, /return koreaDateKey\(f\?\.createdAt\|\|f\?\.joinDate\)===koreaDateKey\(\);/);
  assert.match(html, /return koreaDateKey\(p\?\.createdAt\|\|p\?\.paidAt\|\|p\?\.date\)===koreaDateKey\(\);/);
  assert.doesNotMatch(html, /diff>=0&&diff<7/);
});
