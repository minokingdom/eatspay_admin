const assert = require('node:assert/strict');
const test = require('node:test');

const { createRepository } = require('../db/repository');

function createFakePool({ rowsBySql = [], clientRowsBySql = [] } = {}) {
  const poolCalls = [];
  const clientCalls = [];
  const client = {
    query: async (sql, params = []) => {
      clientCalls.push({ sql, params });
      const match = clientRowsBySql.find(item => sql.includes(item.includes));
      return { rows: match ? match.rows : [], rowCount: match ? match.rows.length : 0 };
    },
    release: () => {
      client.released = true;
    },
    released: false
  };

  return {
    pool: {
      query: async (sql, params = []) => {
        poolCalls.push({ sql, params });
        const match = rowsBySql.find(item => sql.includes(item.includes));
        return { rows: match ? match.rows : [], rowCount: match ? match.rows.length : 0 };
      },
      connect: async () => client
    },
    poolCalls,
    clientCalls,
    client
  };
}

test('createUser stores only a password hash field', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [{
      includes: 'INSERT INTO users',
      rows: [{
        id: 10,
        email: 'owner@example.com',
        name: 'Kim',
        franchise_name: 'Store',
        franchise_id: 100,
        role: 'OWNER',
        balance: 0
      }]
    }]
  });
  const repo = createRepository(pool);

  const user = await repo.createUser({
    email: 'owner@example.com',
    passwordHash: 'hash-value',
    name: 'Kim',
    franchiseName: 'Store',
    phone: '010-0000-0000',
    address: 'Seoul',
    tel: '02-000-0000',
    businessNumber: '120-00-12345'
  });

  assert.equal(user.id, 10);
  assert.match(poolCalls[0].sql, /password_hash/);
  assert.doesNotMatch(poolCalls[0].sql, /password[,)]/);
  assert.deepEqual(poolCalls[0].params.slice(0, 2), ['owner@example.com', 'hash-value']);
});

test('recordCharge runs in a transaction and returns the updated balance', async () => {
  const { pool, clientCalls, client } = createFakePool({
    clientRowsBySql: [
      { includes: 'UPDATE users', rows: [{ balance: 245398 }] },
      { includes: 'INSERT INTO transactions', rows: [{ transaction_id: 'TXN-1' }] }
    ]
  });
  const repo = createRepository(pool);

  const result = await repo.recordCharge({
    userId: 4820,
    franchiseId: 1052,
    transactionId: 'TXN-1',
    amount: 100000,
    fee: 4602,
    totalAmount: 104602,
    method: 'CARD',
    cardDetails: 'Card (****-1234)'
  });

  assert.equal(result.updatedBalance, 245398);
  assert.equal(clientCalls[0].sql, 'BEGIN');
  assert.match(clientCalls[1].sql, /UPDATE users/);
  assert.match(clientCalls[2].sql, /INSERT INTO transactions/);
  assert.equal(clientCalls.at(-1).sql, 'COMMIT');
  assert.equal(client.released, true);
});

test('upsertAdminUser creates or updates an ADMIN account', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [
      {
        includes: 'ON CONFLICT',
        rows: [{
          id: 1,
          email: 'admin@example.com',
          password_hash: 'hash-value',
          name: 'Admin',
          franchise_name: 'Admin',
          franchise_id: 1,
          role: 'ADMIN',
          balance: 0
        }]
      },
      {
        includes: 'SET franchise_id = id',
        rows: [{
          id: 1,
          email: 'admin@example.com',
          password_hash: 'hash-value',
          name: 'Admin',
          franchise_name: 'Admin',
          franchise_id: 1,
          role: 'ADMIN',
          balance: 0
        }]
      }
    ]
  });
  const repo = createRepository(pool);

  const user = await repo.upsertAdminUser({
    email: 'admin@example.com',
    passwordHash: 'hash-value',
    name: 'Admin'
  });

  assert.equal(user.role, 'ADMIN');
  assert.equal(user.franchiseName, 'Admin');
  assert.equal(user.franchiseId, 1);
  assert.match(poolCalls[0].sql, /ON CONFLICT \(email\)/);
  assert.deepEqual(poolCalls[0].params, ['admin@example.com', 'hash-value', 'Admin']);
  assert.match(poolCalls[1].sql, /franchise_id = id/);
});

test('recordFile stores upload metadata for preview lookup', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [{
      includes: 'INSERT INTO stored_files',
      rows: [{
        file_key: 'biz-doc.pdf',
        original_name: '사업자등록증.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1200,
        storage_path: 'uploads/biz-doc.pdf',
        public_url: null,
        created_at: '2026-06-09T00:00:00.000Z'
      }]
    }]
  });
  const repo = createRepository(pool);

  const file = await repo.recordFile({
    fileKey: 'biz-doc.pdf',
    originalName: '사업자등록증.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1200,
    storagePath: 'uploads/biz-doc.pdf',
    uploadedBy: 1
  });

  assert.equal(file.fileKey, 'biz-doc.pdf');
  assert.match(poolCalls[0].sql, /INSERT INTO stored_files/);
  assert.deepEqual(poolCalls[0].params.slice(0, 4), ['biz-doc.pdf', '사업자등록증.pdf', 'application/pdf', 1200]);
});

test('addDeliveryAccount creates a pending delivery agency account', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [{
      includes: 'INSERT INTO delivery_accounts',
      rows: [{
        id: 7,
        franchise_id: 1052,
        agency_id: 1,
        agency_name: '생각대로',
        bank_name: '신한은행',
        account_holder: '홍길동',
        account_no: '110123456789',
        file_key: 'account-proof.jpg',
        account_status: 'PENDING',
        req_date: '2026-06-09T00:00:00.000Z'
      }]
    }]
  });
  const repo = createRepository(pool);

  const account = await repo.addDeliveryAccount({
    franchiseId: 1052,
    agencyId: 1,
    agencyName: '생각대로',
    bankName: '신한은행',
    accountHolder: '홍길동',
    accountNo: '110123456789',
    fileKey: 'account-proof.jpg'
  });

  assert.equal(account.accountStatus, 'PENDING');
  assert.match(poolCalls[0].sql, /INSERT INTO delivery_accounts/);
  assert.equal(poolCalls[0].params[0], 1052);
});

test('createAccountRequest stores app-submitted virtual account details', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [{
      includes: 'INSERT INTO account_requests',
      rows: [{
        request_id: 'REQ-20260617-0001',
        franchise_id: 1,
        franchise_name: '착한치킨 송도점',
        business_number: '120-00-12345',
        bank_code: '011',
        bank_name: '농협은행',
        delivery_agency_name: '딜버',
        account_no: '1234567898765432',
        representative_name: '대표자',
        status: 'PENDING',
        document_url: 'pending-object-storage://proof.jpg',
        assigned_virtual_account: null,
        rejection_reason: null,
        submitted_at: '2026-06-17T02:00:00.000Z'
      }]
    }]
  });
  const repo = createRepository(pool);

  const request = await repo.createAccountRequest({
    requestId: 'REQ-20260617-0001',
    franchiseId: 1,
    franchiseName: '착한치킨 송도점',
    businessNumber: '120-00-12345',
    bankCode: '011',
    bankName: '농협은행',
    deliveryAgencyName: '딜버',
    accountNo: '1234567898765432',
    representativeName: '대표자',
    documentUrl: 'pending-object-storage://proof.jpg'
  });

  assert.equal(request.deliveryAgencyName, '딜버');
  assert.equal(request.bankName, '농협은행');
  assert.equal(request.accountNo, '1234567898765432');
  assert.match(poolCalls[0].sql, /delivery_agency_name/);
  assert.deepEqual(poolCalls[0].params.slice(5, 8), ['농협은행', '딜버', '1234567898765432']);
});

test('lists app account requests by franchise from database', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [{
      includes: 'WHERE franchise_id = $1',
      rows: [{
        request_id: 'REQ-20260617-0002',
        franchise_id: 1001,
        franchise_name: '수수불곱창',
        business_number: '701-68-00933',
        bank_code: '011',
        bank_name: '농협은행',
        delivery_agency_name: '딜버',
        account_no: '1234567898114001',
        representative_name: '대표자',
        status: 'PENDING',
        document_url: null,
        assigned_virtual_account: null,
        rejection_reason: null,
        submitted_at: '2026-06-17T02:00:00.000Z'
      }]
    }]
  });
  const repo = createRepository(pool);

  const requests = await repo.listAccountRequestsByFranchise(1001);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].franchiseName, '수수불곱창');
  assert.equal(requests[0].deliveryAgencyName, '딜버');
  assert.deepEqual(poolCalls[0].params, [1001]);
});

test('listPgSettlements returns paginated PG settlement rows', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [
      {
        includes: 'ORDER BY settled_at DESC',
        rows: [{
          id: 1,
          settled_at: '2026-05-18T05:35:00.000Z',
          approval_no: 'NP260518001',
          pg: '넥스트페이',
          pg_tx_id: 'PGNP202605181430',
          franchise_name: '맛있는치킨 홍대점',
          payment_amt: 523013,
          svc_fee: 23013,
          net_amt: 500000,
          agency_id: 1,
          agency_name: '강남지사',
          customer_id: 'MBR20240001',
          bank_code: '088',
          account_no: '123-456-789012',
          delivery_agency: '생각대로',
          status: 'SETTLED'
        }]
      },
      { includes: 'count(*)::int', rows: [{ count: 1 }] }
    ]
  });
  const repo = createRepository(pool);

  const result = await repo.listPgSettlements({ limit: 10, offset: 0 });

  assert.equal(result.totalItems, 1);
  assert.equal(result.items[0].pgTxId, 'PGNP202605181430');
  assert.match(poolCalls[0].sql, /ORDER BY settled_at DESC/);
});

test('deleteCardByUserId deletes only cards owned by the user', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [{
      includes: 'DELETE FROM cards',
      rows: [{ id: 'card_ref_1' }]
    }]
  });
  const repo = createRepository(pool);

  const deleted = await repo.deleteCardByUserId('card_ref_1', 10);

  assert.equal(deleted.id, 'card_ref_1');
  assert.match(poolCalls[0].sql, /DELETE FROM cards/);
  assert.match(poolCalls[0].sql, /user_id = \$2/);
  assert.deepEqual(poolCalls[0].params, ['card_ref_1', 10]);
});

test('deleteAccountRequestByFranchise deletes only account requests owned by the franchise', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [{
      includes: 'DELETE FROM account_requests',
      rows: [{
        request_id: 'REQ-1',
        franchise_id: 77,
        franchise_name: 'Store',
        business_number: '120-00-12345',
        bank_code: '011',
        bank_name: 'Nonghyup',
        delivery_agency_name: 'Agency',
        account_no: '1234567890',
        representative_name: 'Owner',
        status: 'PENDING',
        document_url: null,
        assigned_virtual_account: null,
        rejection_reason: null,
        submitted_at: '2026-06-17T00:00:00.000Z'
      }]
    }]
  });
  const repo = createRepository(pool);

  const deleted = await repo.deleteAccountRequestByFranchise('REQ-1', 77);

  assert.equal(deleted.requestId, 'REQ-1');
  assert.match(poolCalls[0].sql, /DELETE FROM account_requests/);
  assert.match(poolCalls[0].sql, /franchise_id = \$2/);
  assert.deepEqual(poolCalls[0].params, ['REQ-1', 77]);
});

test('deleteDeliveryAccountByFranchise deletes only delivery accounts owned by the franchise', async () => {
  const { pool, poolCalls } = createFakePool({
    rowsBySql: [{
      includes: 'DELETE FROM delivery_accounts',
      rows: [{
        id: 9,
        franchise_id: 77,
        agency_id: null,
        agency_name: 'Agency',
        bank_name: 'Nonghyup',
        account_holder: 'Owner',
        account_no: '1234567890',
        file_key: null,
        account_status: 'PENDING',
        req_date: '2026-06-17T00:00:00.000Z'
      }]
    }]
  });
  const repo = createRepository(pool);

  const deleted = await repo.deleteDeliveryAccountByFranchise(9, 77);

  assert.equal(deleted.id, 9);
  assert.match(poolCalls[0].sql, /DELETE FROM delivery_accounts/);
  assert.match(poolCalls[0].sql, /franchise_id = \$2/);
  assert.deepEqual(poolCalls[0].params, [9, 77]);
});
