const crypto = require('crypto');

const { createPool } = require('../db/pool');

async function main() {
  const pool = createPool();
  try {
    await seed(pool);
    console.log('Demo data seeded.');
  } finally {
    await pool.end();
  }
}

async function seed(pool) {
  const chargeTotal = amount => Math.round(Number(amount) / 0.956);
  const chargeFee = amount => chargeTotal(amount) - Number(amount);
  const users = [
    {
      email: 'demo-owner-1@eatspay.local',
      password: 'demo1234!',
      name: '수수불곱창',
      franchiseName: '수수불곱창',
      franchiseId: 1001,
      role: 'OWNER',
      balance: 200000,
      phone: '010-1111-1001',
      businessNumber: '701-68-00933'
    },
    {
      email: 'demo-owner-2@eatspay.local',
      password: 'demo1234!',
      name: '지코바합안점',
      franchiseName: '지코바합안점',
      franchiseId: 1002,
      role: 'OWNER_PENDING',
      balance: 0,
      phone: '010-2222-1002',
      businessNumber: '119-68-83610'
    },
    {
      email: 'demo-owner-3@eatspay.local',
      password: 'demo1234!',
      name: '치암상회',
      franchiseName: '치암상회',
      franchiseId: 1003,
      role: 'OWNER',
      balance: 850000,
      phone: '010-3333-1003',
      businessNumber: '523-31-02000'
    }
  ];

  const agencies = [
    { id: 1, type: 'HQ', parentId: null, name: '이츠페이 본사', address: '서울시 중구 세종대로 1', loginId: 'agency-01', owner: '김영희', phone: '010-1111-1111', feeRate: 3.8, joinCode: 'JOIN-001' },
    { id: 2, type: 'AGENCY', parentId: 1, name: '강남영업소', address: '서울시 강남구 테헤란로 10', loginId: 'agency-02', owner: '이민수', phone: '010-2222-2222', feeRate: 4.2, joinCode: 'JOIN-002' },
    { id: 3, type: 'AGENCY', parentId: 1, name: '서부영업소', address: '경기도 수원시 영통구 20', loginId: 'agency-03', owner: '박준호', phone: '010-3333-3333', feeRate: 4.2, joinCode: 'JOIN-003' },
    { id: 4, type: 'AGENCY', parentId: 1, name: '부산영업소', address: '부산시 해운대구 30', loginId: 'agency-04', owner: '최혜진', phone: '010-4444-4444', feeRate: 4.2, joinCode: 'JOIN-004' }
  ];

  const deliveryAccounts = [
    {
      franchiseId: 1001,
      agencyId: 1,
      agencyName: '신한은행',
      bankName: '신한은행',
      accountHolder: '수수불곱창',
      accountNo: '790230190530',
      fileKey: null,
      accountStatus: 'APPROVED',
      reqDate: '2026-05-16 09:00:00+09'
    },
    {
      franchiseId: 1002,
      agencyId: 2,
      agencyName: '우리은행',
      bankName: '우리은행',
      accountHolder: '지코바합안점',
      accountNo: '066431542737',
      fileKey: null,
      accountStatus: 'PENDING',
      reqDate: '2026-05-17 10:15:00+09'
    },
    {
      franchiseId: 1003,
      agencyId: 3,
      agencyName: '농협은행',
      bankName: '농협은행',
      accountHolder: '치암상회',
      accountNo: '119868836100',
      fileKey: null,
      accountStatus: 'REJECTED',
      rejectionReason: '계좌 정보가 불일치합니다.',
      reqDate: '2026-05-18 11:20:00+09'
    }
  ];

  const accountRequests = [
    {
      requestId: 'DEMO-REQ-1001',
      franchiseId: 1001,
      franchiseName: '수수불곱창',
      businessNumber: '701-68-00933',
      bankCode: '088',
      representativeName: '김성호',
      status: 'APPROVED',
      documentUrl: '/files/demo-shinhan-1001.jpg',
      assignedVirtualAccount: {
        bankCode: '088',
        bankName: '신한은행',
        accountNumber: '562-901-1001',
        accountHolder: '수수불곱창'
      },
      submittedAt: '2026-05-14 10:00:00+09'
    },
    {
      requestId: 'DEMO-REQ-1002',
      franchiseId: 1002,
      franchiseName: '지코바합안점',
      businessNumber: '119-68-83610',
      bankCode: '020',
      representativeName: '이민수',
      status: 'PENDING',
      documentUrl: '/files/demo-woori-1002.jpg',
      submittedAt: '2026-05-15 11:00:00+09'
    },
    {
      requestId: 'DEMO-REQ-1003',
      franchiseId: 1003,
      franchiseName: '치암상회',
      businessNumber: '523-31-02000',
      bankCode: '011',
      representativeName: '박준호',
      status: 'REJECTED',
      documentUrl: '/files/demo-nh-1003.jpg',
      rejectionReason: '재심사 필요',
      submittedAt: '2026-05-16 12:00:00+09'
    }
  ];

  const transactions = [
    {
      transactionId: 'DEMO-TX-1001',
      franchiseId: 1001,
      type: 'CHARGE',
      amount: 300000,
      fee: chargeFee(300000),
      totalAmount: chargeTotal(300000),
      method: '카드',
      cardDetails: '신한 1111-****-2222',
      status: 'SUCCESS',
      createdAt: '2026-05-18 12:53:00+09'
    },
    {
      transactionId: 'DEMO-TX-1002',
      franchiseId: 1001,
      type: 'CHARGE',
      amount: 500000,
      fee: chargeFee(500000),
      totalAmount: chargeTotal(500000),
      method: '카드',
      cardDetails: '신한 1111-****-2222',
      status: 'SUCCESS',
      createdAt: '2026-05-18 12:27:00+09'
    },
    {
      transactionId: 'DEMO-TX-1003',
      franchiseId: 1002,
      type: 'CHARGE',
      amount: 200000,
      fee: chargeFee(200000),
      totalAmount: chargeTotal(200000),
      method: '카드',
      cardDetails: '삼성 3333-****-4444',
      status: 'SUCCESS',
      createdAt: '2026-05-18 12:09:00+09'
    },
    {
      transactionId: 'DEMO-TX-1004',
      franchiseId: 1003,
      type: 'CHARGE',
      amount: 1000000,
      fee: chargeFee(1000000),
      totalAmount: chargeTotal(1000000),
      method: '카드',
      cardDetails: '롯데 5555-****-6666',
      status: 'SUCCESS',
      createdAt: '2026-05-18 11:27:00+09'
    }
  ];

  const settlements = [
    {
      settledAt: '2026-05-18 13:01:00+09',
      approvalNo: 'DEMO-TX-1001',
      pg: 'GH Payments',
      pgTxId: 'PG-DEMO-1001',
      franchiseId: 1001,
      franchiseName: '수수불곱창',
      paymentAmt: chargeTotal(300000),
      svcFee: chargeFee(300000),
      netAmt: 300000,
      agencyId: 1,
      agencyName: '이츠페이 본사',
      customerId: 'CUST-1001',
      bankCode: '088',
      accountNo: '5629011001',
      deliveryAgency: '신한은행',
      status: 'SETTLED'
    },
    {
      settledAt: '2026-05-18 12:34:00+09',
      approvalNo: 'DEMO-TX-1002',
      pg: 'GH Payments',
      pgTxId: 'PG-DEMO-1002',
      franchiseId: 1002,
      franchiseName: '지코바합안점',
      paymentAmt: chargeTotal(500000),
      svcFee: chargeFee(500000),
      netAmt: 500000,
      agencyId: 2,
      agencyName: '강남영업소',
      customerId: 'CUST-1002',
      bankCode: '020',
      accountNo: '066431542737',
      deliveryAgency: '우리은행',
      status: 'SETTLED'
    },
    {
      settledAt: '2026-05-18 12:16:00+09',
      approvalNo: 'DEMO-TX-1003',
      pg: 'GH Payments',
      pgTxId: 'PG-DEMO-1003',
      franchiseId: 1003,
      franchiseName: '치암상회',
      paymentAmt: chargeTotal(200000),
      svcFee: chargeFee(200000),
      netAmt: 200000,
      agencyId: 3,
      agencyName: '서부영업소',
      customerId: 'CUST-1003',
      bankCode: '011',
      accountNo: '119868836100',
      deliveryAgency: '농협은행',
      status: 'SETTLED'
    },
    {
      settledAt: '2026-05-18 11:33:00+09',
      approvalNo: 'DEMO-TX-1004',
      pg: 'GH Payments',
      pgTxId: 'PG-DEMO-1004',
      franchiseId: 1001,
      franchiseName: '수수불곱창',
      paymentAmt: chargeTotal(1000000),
      svcFee: chargeFee(1000000),
      netAmt: 1000000,
      agencyId: 1,
      agencyName: '이츠페이 본사',
      customerId: 'CUST-1004',
      bankCode: '088',
      accountNo: '790230190530',
      deliveryAgency: '신한은행',
      status: 'SETTLED'
    }
  ];

  await pool.query('BEGIN');
  try {
    for (const user of users) {
      await upsertUser(pool, user);
    }

    for (const agency of agencies) {
      await upsertAgency(pool, agency);
    }

    await pool.query('DELETE FROM delivery_accounts WHERE franchise_id = ANY($1::bigint[])', [[1001, 1002, 1003]]);
    await pool.query("DELETE FROM account_requests WHERE request_id LIKE 'DEMO-REQ-%'");

    await pool.query("DELETE FROM transactions WHERE transaction_id LIKE 'DEMO-TX-%'");
    await pool.query("DELETE FROM pg_settlements WHERE pg_tx_id LIKE 'PG-DEMO-%'");

    for (const request of accountRequests) {
      await upsertAccountRequest(pool, request);
    }

    for (const tx of transactions) {
      await upsertTransaction(pool, tx);
    }

    for (const settlement of settlements) {
      await upsertSettlement(pool, settlement);
    }

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

async function upsertUser(pool, user) {
  const passwordHash = await hashPassword(user.password);
  await pool.query(
    `INSERT INTO users (
      email, password_hash, name, franchise_name, franchise_id, role, balance, phone, business_number
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      name = EXCLUDED.name,
      franchise_name = EXCLUDED.franchise_name,
      franchise_id = EXCLUDED.franchise_id,
      role = EXCLUDED.role,
      balance = EXCLUDED.balance,
      phone = EXCLUDED.phone,
      business_number = EXCLUDED.business_number,
      updated_at = now()`,
    [user.email, passwordHash, user.name, user.franchiseName, user.franchiseId, user.role, user.balance, user.phone, user.businessNumber]
  );
}

async function upsertAgency(pool, agency) {
  await pool.query(
    `INSERT INTO agencies (
      id, type, parent_id, name, address, login_id, owner, phone, fee_rate, join_code
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (id) DO UPDATE SET
      type = EXCLUDED.type,
      parent_id = EXCLUDED.parent_id,
      name = EXCLUDED.name,
      address = EXCLUDED.address,
      login_id = EXCLUDED.login_id,
      owner = EXCLUDED.owner,
      phone = EXCLUDED.phone,
      fee_rate = EXCLUDED.fee_rate,
      join_code = EXCLUDED.join_code,
      updated_at = now()`,
    [agency.id, agency.type, agency.parentId, agency.name, agency.address, agency.loginId, agency.owner, agency.phone, agency.feeRate, agency.joinCode]
  );
}

async function upsertAccountRequest(pool, request) {
  await pool.query(
    `INSERT INTO account_requests (
      request_id, franchise_id, franchise_name, business_number, bank_code, representative_name, status, document_url, assigned_virtual_account, rejection_reason, submitted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::timestamptz)
    ON CONFLICT (request_id) DO UPDATE SET
      franchise_id = EXCLUDED.franchise_id,
      franchise_name = EXCLUDED.franchise_name,
      business_number = EXCLUDED.business_number,
      bank_code = EXCLUDED.bank_code,
      representative_name = EXCLUDED.representative_name,
      status = EXCLUDED.status,
      document_url = EXCLUDED.document_url,
      assigned_virtual_account = EXCLUDED.assigned_virtual_account,
      rejection_reason = EXCLUDED.rejection_reason,
      submitted_at = EXCLUDED.submitted_at,
      updated_at = now()`,
    [
      request.requestId,
      request.franchiseId,
      request.franchiseName,
      request.businessNumber,
      request.bankCode,
      request.representativeName,
      request.status,
      request.documentUrl,
      request.assignedVirtualAccount ? JSON.stringify(request.assignedVirtualAccount) : null,
      request.rejectionReason || null,
      request.submittedAt
    ]
  );
}

async function upsertTransaction(pool, tx) {
  await pool.query(
    `INSERT INTO transactions (
      transaction_id, franchise_id, type, amount, fee, total_amount, method, card_details, status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
    ON CONFLICT (transaction_id) DO UPDATE SET
      franchise_id = EXCLUDED.franchise_id,
      type = EXCLUDED.type,
      amount = EXCLUDED.amount,
      fee = EXCLUDED.fee,
      total_amount = EXCLUDED.total_amount,
      method = EXCLUDED.method,
      card_details = EXCLUDED.card_details,
      status = EXCLUDED.status,
      created_at = EXCLUDED.created_at,
      updated_at = now()`,
    [tx.transactionId, tx.franchiseId, tx.type, tx.amount, tx.fee, tx.totalAmount, tx.method, tx.cardDetails, tx.status, tx.createdAt]
  );
}

async function upsertSettlement(pool, settlement) {
  await pool.query(
    `INSERT INTO pg_settlements (
      settled_at, approval_no, pg, pg_tx_id, franchise_id, franchise_name, payment_amt, svc_fee, net_amt,
      agency_id, agency_name, customer_id, bank_code, account_no, delivery_agency, status
    ) VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (approval_no) DO UPDATE SET
      settled_at = EXCLUDED.settled_at,
      pg = EXCLUDED.pg,
      pg_tx_id = EXCLUDED.pg_tx_id,
      franchise_id = EXCLUDED.franchise_id,
      franchise_name = EXCLUDED.franchise_name,
      payment_amt = EXCLUDED.payment_amt,
      svc_fee = EXCLUDED.svc_fee,
      net_amt = EXCLUDED.net_amt,
      agency_id = EXCLUDED.agency_id,
      agency_name = EXCLUDED.agency_name,
      customer_id = EXCLUDED.customer_id,
      bank_code = EXCLUDED.bank_code,
      account_no = EXCLUDED.account_no,
      delivery_agency = EXCLUDED.delivery_agency,
      status = EXCLUDED.status,
      updated_at = now()`,
    [
      settlement.settledAt,
      settlement.approvalNo,
      settlement.pg,
      settlement.pgTxId,
      settlement.franchiseId,
      settlement.franchiseName,
      settlement.paymentAmt,
      settlement.svcFee,
      settlement.netAmt,
      settlement.agencyId,
      settlement.agencyName,
      settlement.customerId,
      settlement.bankCode,
      settlement.accountNo,
      settlement.deliveryAgency,
      settlement.status
    ]
  );
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
  return `scrypt$${salt}$${hash}`;
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
