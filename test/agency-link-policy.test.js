const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isProtectedAgencyJoinCode
} = require('../lib/agency-link-policy');

test('isProtectedAgencyJoinCode protects HQ join links', () => {
  assert.equal(isProtectedAgencyJoinCode({
    type: 'HQ',
    level: 1,
    parentId: null,
    joinCode: 'avicx'
  }), true);
});

test('isProtectedAgencyJoinCode allows non-HQ agency links', () => {
  assert.equal(isProtectedAgencyJoinCode({
    type: 'BRANCH',
    level: 2,
    parentId: 130,
    joinCode: 'JOIN-210'
  }), false);
});
