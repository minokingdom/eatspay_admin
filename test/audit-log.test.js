const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAuditChangeSet,
  sanitizeAuditData
} = require('../lib/audit-log');

test('buildAuditChangeSet records only changed fields', () => {
  const changeSet = buildAuditChangeSet(
    {
      franchiseName: 'Old Store',
      ownerName: 'Kim',
      phone: '010-1111-2222',
      agencyId: 130
    },
    {
      franchiseName: 'New Store',
      ownerName: 'Kim',
      phone: '010-3333-4444',
      agencyId: 130
    }
  );

  assert.deepEqual(changeSet.changedFields, ['franchiseName', 'phone']);
  assert.deepEqual(changeSet.beforeData, {
    franchiseName: 'Old Store',
    phone: '010-1111-2222'
  });
  assert.deepEqual(changeSet.afterData, {
    franchiseName: 'New Store',
    phone: '010-3333-4444'
  });
});

test('buildAuditChangeSet redacts sensitive changed values', () => {
  const changeSet = buildAuditChangeSet(
    { passwordHash: 'scrypt$old', loginId: 'store01' },
    { passwordHash: 'scrypt$new', loginId: 'store01' }
  );

  assert.deepEqual(changeSet.changedFields, ['passwordHash']);
  assert.deepEqual(changeSet.beforeData, { passwordHash: '[REDACTED]' });
  assert.deepEqual(changeSet.afterData, { passwordHash: '[REDACTED]' });
});

test('sanitizeAuditData redacts nested secret fields', () => {
  assert.deepEqual(sanitizeAuditData({
    safe: 'visible',
    nested: {
      token: 'abc',
      apiSecret: 'hidden'
    }
  }), {
    safe: 'visible',
    nested: {
      token: '[REDACTED]',
      apiSecret: '[REDACTED]'
    }
  });
});
