const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateAgencySettlementRows } = require('../admin-assets/js/admin-agency-settlement-calculator');

test('splits agency settlement by hierarchy rate differences and adds HQ transaction fee', () => {
  const agencies = [
    { id: 1, name: '이츠페이 본사', parentId: '', type: 'hq', feeRate: 1.98 },
    { id: 2, name: 'test', parentId: 1, type: 'jisa', feeRate: 0.5 },
    { id: 3, name: 'test1', parentId: 2, type: 'jijum', feeRate: 0.1 }
  ];
  const franchises = [
    { id: 10, name: '비이씨', agencyId: 3 },
    { id: 11, name: '직가맹점', agencyId: 2 },
    { id: 12, name: '본사직영', agencyId: 1 }
  ];
  const payments = [
    { id: 'P1', date: '2026-06-28 10:00', approvalNo: 'A1', franchiseId: 10, franchise: '비이씨', amount: 100000 },
    { id: 'P2', date: '2026-06-28 10:10', approvalNo: 'A2', franchiseId: 11, franchise: '직가맹점', amount: 100000 },
    { id: 'P3', date: '2026-06-28 10:20', approvalNo: 'A3', franchiseId: 12, franchise: '본사직영', amount: 100000 }
  ];

  const rows = calculateAgencySettlementRows({
    agencies,
    franchises,
    payments,
    defaultFeeRate: 4.4,
    hqTransactionFee: 300,
    getEffRate: agency => agency.feeRate || 0,
    sortKey: agency => String(agency.id).padStart(3, '0')
  });

  const byName = new Map(rows.map(row => [row.agency.name, row]));

  assert.equal(byName.get('test1').agencyFee, 100);
  assert.equal(byName.get('test1').transactionFee, 0);
  assert.equal(byName.get('test1').settlementTotal, 100);
  assert.equal(byName.get('test1').count, 1);

  assert.equal(byName.get('test').agencyFee, 900);
  assert.equal(byName.get('test').transactionFee, 0);
  assert.equal(byName.get('test').settlementTotal, 900);
  assert.equal(byName.get('test').count, 2);

  assert.equal(byName.get('이츠페이 본사').agencyFee, 4940);
  assert.equal(byName.get('이츠페이 본사').transactionFee, 900);
  assert.equal(byName.get('이츠페이 본사').settlementTotal, 5840);
  assert.equal(byName.get('이츠페이 본사').count, 3);
});

test('calculates net payout from the row total fee instead of per-payment rounded fees', () => {
  const agencies = [
    { id: 1, name: '이츠페이 본사', parentId: '', type: 'hq', feeRate: 1.98 },
    { id: 2, name: 'test', parentId: 1, type: 'jisa', feeRate: 0.5 }
  ];
  const franchises = [
    { id: 10, name: '테슽', agencyId: 2 }
  ];
  const payments = [
    { id: 'P1', date: '2026-06-24 15:32', approvalNo: 'A1', franchiseId: 10, franchise: '테슽', amount: 2200 },
    { id: 'P2', date: '2026-06-24 15:23', approvalNo: 'A2', franchiseId: 10, franchise: '테슽', amount: 2200 }
  ];

  const rows = calculateAgencySettlementRows({
    agencies,
    franchises,
    payments,
    defaultFeeRate: 4.4,
    hqTransactionFee: 300,
    getEffRate: agency => agency.feeRate || 0,
    sortKey: agency => String(agency.id).padStart(3, '0')
  });

  const testAgency = rows.find(row => row.agency.name === 'test');
  assert.equal(testAgency.agencyFee, 22);
  assert.equal(testAgency.agencyNet, 21);
});
