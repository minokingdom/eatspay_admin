const crypto = require('crypto');

const { createPool } = require('../db/pool');

const PREFIX = 'JUNEDEMO';
const PASSWORD = 'demo1234!';
const START_DATE = '2026-06-01';
const END_DATE = '2026-06-15';

const STORE_NAMES = [
  '강남 도시락 본점',
  '홍대 분식 연구소',
  '부산 해운대 치킨',
  '대구 달서 피자',
  '광주 상무 김밥',
  '인천 송도 돈까스',
  '수원 영통 떡볶이',
  '대전 둔산 족발',
  '울산 삼산 햄버거',
  '제주 노형 초밥',
  '마포 국수집',
  '성수 샐러드',
  '판교 카페온',
  '천안 불고기',
  '전주 비빔밥',
  '청주 파스타',
  '춘천 닭갈비',
  '포항 회덮밥',
  '안양 라멘',
  '김해 보쌈'
];

const OWNERS = [
  '김민준', '이서연', '박도윤', '최하준', '정지우',
  '강서준', '조하린', '윤지호', '장수아', '임도현',
  '한예준', '오시은', '신유찬', '서아린', '권지안',
  '황태오', '송하윤', '배준서', '문채원', '노유진'
];

const CARD_COMPANIES = ['현대카드', '신한카드', '삼성카드', '롯데카드', '국민카드', '우리카드', 'NH농협카드', 'BC카드'];
const DELIVERY_AGENCIES = ['생각대로', '바로고', '부릉', '만나플러스', '딜버', '모아라인', '슈퍼히어로', '제트콜'];
const BANKS = [
  { code: '088', name: '신한은행' },
  { code: '020', name: '우리은행' },
  { code: '004', name: '국민은행' },
  { code: '011', name: '농협은행' },
  { code: '081', name: '하나은행' }
];

async function main() {
  const pool = createPool();
  try {
    await seed(pool);
    await verify(pool);
  } finally {
    await pool.end();
  }
}

async function seed(pool) {
  await pool.query('BEGIN');
  try {
    await cleanup(pool);
    const passwordHash = await hashPassword(PASSWORD);
    const agencyIds = await seedAgencies(pool);
    const users = await seedUsers(pool, passwordHash, agencyIds);
    await seedCards(pool, users);
    await seedAccountRequests(pool, users);
    await seedDeliveryAccounts(pool, users, agencyIds);
    const transactions = await seedTransactions(pool, users);
    await seedSettlements(pool, transactions, users, agencyIds);
    await seedNotifications(pool, users);
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

async function cleanup(pool) {
  await pool.query("DELETE FROM notifications WHERE data->>'seed' = $1", [PREFIX]);
  await pool.query("DELETE FROM pg_settlements WHERE pg_tx_id LIKE $1", [`PG-${PREFIX}-%`]);
  await pool.query("DELETE FROM transactions WHERE transaction_id LIKE $1", [`${PREFIX}-TX-%`]);
  await pool.query("DELETE FROM account_requests WHERE request_id LIKE $1", [`${PREFIX}-REQ-%`]);
  await pool.query("DELETE FROM delivery_accounts WHERE account_no LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM cards WHERE id LIKE $1", [`${PREFIX}-CARD-%`]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`${PREFIX.toLowerCase()}-%@eatspay.local`]);
  await pool.query("DELETE FROM agencies WHERE join_code LIKE $1", [`${PREFIX}-%`]);
}

async function seedAgencies(pool) {
  const agencies = [
    {
      type: 'HQ',
      parentId: null,
      name: '이츠페이 본사',
      address: '서울특별시 중구 세종대로 1',
      loginId: `${PREFIX.toLowerCase()}-hq`,
      owner: '본사 관리자',
      phone: '010-7000-0000',
      feeRate: 4.4,
      joinCode: `${PREFIX}-HQ`
    },
    {
      type: 'AGENCY',
      parentId: null,
      name: '강남 영업대리점',
      address: '서울특별시 강남구 테헤란로 10',
      loginId: `${PREFIX.toLowerCase()}-agency-gangnam`,
      owner: '강대리',
      phone: '010-7000-0001',
      feeRate: 4.2,
      joinCode: `${PREFIX}-AG-01`
    },
    {
      type: 'AGENCY',
      parentId: null,
      name: '부산 영업대리점',
      address: '부산광역시 해운대구 센텀로 20',
      loginId: `${PREFIX.toLowerCase()}-agency-busan`,
      owner: '부대리',
      phone: '010-7000-0002',
      feeRate: 4.1,
      joinCode: `${PREFIX}-AG-02`
    },
    {
      type: 'AGENCY',
      parentId: null,
      name: '대구 영업대리점',
      address: '대구광역시 달서구 월배로 30',
      loginId: `${PREFIX.toLowerCase()}-agency-daegu`,
      owner: '대대리',
      phone: '010-7000-0003',
      feeRate: 4.0,
      joinCode: `${PREFIX}-AG-03`
    }
  ];

  const ids = [];
  for (const agency of agencies) {
    const result = await pool.query(
      `INSERT INTO agencies (
        type, parent_id, name, address, login_id, owner, phone, fee_rate, join_code, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $10::timestamptz)
      RETURNING id`,
      [
        agency.type,
        agency.parentId,
        agency.name,
        agency.address,
        agency.loginId,
        agency.owner,
        agency.phone,
        agency.feeRate,
        agency.joinCode,
        `${START_DATE} 09:00:00+09`
      ]
    );
    ids.push(result.rows[0].id);
  }
  await pool.query('UPDATE agencies SET parent_id = $1 WHERE join_code LIKE $2 AND type = $3', [ids[0], `${PREFIX}-AG-%`, 'AGENCY']);
  return ids;
}

async function seedUsers(pool, passwordHash, agencyIds) {
  const users = [];
  for (let i = 0; i < STORE_NAMES.length; i += 1) {
    const day = 1 + (i % 15);
    const role = i === 3 ? 'OWNER_REJECTED' : i === 1 ? 'OWNER_PENDING' : 'OWNER';
    const franchiseId = 906010 + i;
    const createdAt = dateTime(day, 9 + (i % 8), (i * 7) % 60);
    const agencyId = agencyIds[i % agencyIds.length];
    const user = {
      email: `${PREFIX.toLowerCase()}-${String(i + 1).padStart(2, '0')}@eatspay.local`,
      passwordHash,
      name: OWNERS[i],
      franchiseName: STORE_NAMES[i],
      franchiseId,
      role,
      balance: role === 'OWNER' ? 100000 + i * 25000 : 0,
      phone: `010-${String(6100 + i).padStart(4, '0')}-${String(1000 + i).padStart(4, '0')}`,
      address: `서울시 테스트구 ${i + 1}번길 ${10 + i}`,
      tel: `02-55${String(i).padStart(2, '0')}-${String(1200 + i).padStart(4, '0')}`,
      businessNumber: `620-${String(10 + i).padStart(2, '0')}-${String(10000 + i).padStart(5, '0')}`,
      customerId: `${PREFIX}-CUST-${String(i + 1).padStart(3, '0')}`,
      agencyId,
      createdAt
    };
    const result = await pool.query(
      `INSERT INTO users (
        email, password_hash, name, franchise_name, franchise_id, role, balance, phone, address, tel,
        business_number, customer_id, agency_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $14::timestamptz)
      RETURNING id`,
      [
        user.email,
        user.passwordHash,
        user.name,
        user.franchiseName,
        user.franchiseId,
        user.role,
        user.balance,
        user.phone,
        user.address,
        user.tel,
        user.businessNumber,
        user.customerId,
        user.agencyId,
        user.createdAt
      ]
    );
    users.push({ ...user, id: result.rows[0].id });
  }
  return users;
}

async function seedCards(pool, users) {
  const approvedUsers = users.filter(user => user.role === 'OWNER').slice(0, 18);
  for (let i = 0; i < approvedUsers.length; i += 1) {
    const user = approvedUsers[i];
    const company = CARD_COMPANIES[i % CARD_COMPANIES.length];
    const last4 = String(3211 + i).padStart(4, '0');
    await pool.query(
      `INSERT INTO cards (id, user_id, masked_number, card_name, card_company, alias, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
      [
        `${PREFIX}-CARD-${String(i + 1).padStart(3, '0')}`,
        user.id,
        `****-****-****-${last4}`,
        company,
        company,
        i % 5 === 0 ? '대표카드' : '카드',
        user.createdAt
      ]
    );
  }
}

async function seedAccountRequests(pool, users) {
  for (let i = 0; i < 18; i += 1) {
    const user = users[i];
    const status = i % 6 === 2 ? 'REJECTED' : i % 5 === 1 ? 'PENDING' : 'APPROVED';
    const bank = BANKS[i % BANKS.length];
    const submittedAt = dateTime(1 + (i % 15), 10 + (i % 7), (i * 11) % 60);
    const processedAt = status === 'PENDING' ? null : dateTime(1 + (i % 15), 14 + (i % 6), (i * 13) % 60);
    await pool.query(
      `INSERT INTO account_requests (
        request_id, franchise_id, franchise_name, business_number, bank_code, bank_name, delivery_agency_name,
        account_no, representative_name, status, document_url, assigned_virtual_account, rejection_reason,
        submitted_at, processed_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::timestamptz, $15::timestamptz, COALESCE($15::timestamptz, $14::timestamptz))`,
      [
        `${PREFIX}-REQ-${String(i + 1).padStart(3, '0')}`,
        user.franchiseId,
        user.franchiseName,
        user.businessNumber,
        bank.code,
        bank.name,
        DELIVERY_AGENCIES[i % DELIVERY_AGENCIES.length],
        `${PREFIX}-${String(900000 + i).padStart(6, '0')}`,
        user.name,
        status,
        `/files/${PREFIX.toLowerCase()}-pos-${String(i + 1).padStart(3, '0')}.jpg`,
        status === 'APPROVED'
          ? JSON.stringify({ bankCode: bank.code, bankName: bank.name, accountNumber: `${bank.code}-${PREFIX}-${String(1000 + i)}`, accountHolder: user.franchiseName })
          : null,
        status === 'REJECTED' ? '증빙 사진의 계좌번호 식별이 어렵습니다.' : null,
        submittedAt,
        processedAt
      ]
    );
  }
}

async function seedDeliveryAccounts(pool, users, agencyIds) {
  for (let i = 0; i < 12; i += 1) {
    const user = users[(i * 2) % users.length];
    const bank = BANKS[(i + 2) % BANKS.length];
    const status = i % 5 === 2 ? 'REJECTED' : i % 4 === 1 ? 'PENDING' : 'APPROVED';
    await pool.query(
      `INSERT INTO delivery_accounts (
        franchise_id, agency_id, agency_name, bank_name, account_holder, account_no, account_status,
        rejection_reason, req_date, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $9::timestamptz)`,
      [
        user.franchiseId,
        agencyIds[i % agencyIds.length],
        DELIVERY_AGENCIES[(i + 3) % DELIVERY_AGENCIES.length],
        bank.name,
        user.franchiseName,
        `${PREFIX}-DA-${String(8000 + i)}`,
        status,
        status === 'REJECTED' ? '예금주명이 사업자 정보와 일치하지 않습니다.' : null,
        dateTime(1 + (i % 15), 11 + (i % 6), (i * 17) % 60)
      ]
    );
  }
}

async function seedTransactions(pool, users) {
  const approvedUsers = users.filter(user => user.role === 'OWNER');
  const transactions = [];
  for (let i = 0; i < 18; i += 1) {
    const user = approvedUsers[i % approvedUsers.length];
    const joinDay = Number(String(user.createdAt || '').slice(8, 10)) || 1;
    const day = Math.max(1 + (i % 15), joinDay);
    const depositAmount = 50000 + (i % 9) * 25000 + Math.floor(i / 9) * 10000;
    const fee = Math.floor(depositAmount * 0.04602);
    const totalAmount = depositAmount + fee;
    const tx = {
      transactionId: `${PREFIX}-TX-${String(i + 1).padStart(3, '0')}`,
      franchiseId: user.franchiseId,
      type: 'CHARGE',
      amount: depositAmount,
      fee,
      totalAmount,
      method: 'CARD',
      cardDetails: `${CARD_COMPANIES[i % CARD_COMPANIES.length]} ****-${String(3211 + i).padStart(4, '0')}`,
      status: i % 11 === 7 ? 'ROLLED_BACK' : 'SUCCESS',
      createdAt: dateTime(day, 12 + (i % 8), (i * 9) % 60)
    };
    await pool.query(
      `INSERT INTO transactions (
        transaction_id, franchise_id, type, amount, fee, total_amount, method, card_details, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $10::timestamptz)`,
      [
        tx.transactionId,
        tx.franchiseId,
        tx.type,
        tx.amount,
        tx.fee,
        tx.totalAmount,
        tx.method,
        tx.cardDetails,
        tx.status,
        tx.createdAt
      ]
    );
    transactions.push(tx);
  }
  return transactions;
}

async function seedSettlements(pool, transactions, users, agencyIds) {
  for (let i = 0; i < 9; i += 1) {
    const tx = transactions[i];
    const user = users.find(item => item.franchiseId === tx.franchiseId);
    const netAmount = tx.amount;
    const paymentAmount = tx.totalAmount;
    const svcFee = tx.fee;
    await pool.query(
      `INSERT INTO pg_settlements (
        settled_at, approval_no, pg, pg_tx_id, franchise_id, franchise_name, payment_amt, svc_fee, net_amt,
        agency_id, agency_name, customer_id, bank_code, account_no, delivery_agency, status, created_at, updated_at
      ) VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $1::timestamptz, $1::timestamptz)`,
      [
        dateTime(1 + (i % 15), 16 + (i % 5), (i * 8) % 60),
        tx.transactionId,
        'GH Payments',
        `PG-${PREFIX}-${String(i + 1).padStart(3, '0')}`,
        tx.franchiseId,
        user?.franchiseName || `가맹점 ${tx.franchiseId}`,
        paymentAmount,
        svcFee,
        netAmount,
        agencyIds[i % agencyIds.length],
        ['이츠페이 본사', '강남 영업대리점', '부산 영업대리점', '대구 영업대리점'][i % agencyIds.length],
        user?.customerId || `${PREFIX}-CUST-UNKNOWN`,
        BANKS[i % BANKS.length].code,
        `${PREFIX}-SETTLE-${String(7000 + i)}`,
        DELIVERY_AGENCIES[i % DELIVERY_AGENCIES.length],
        i % 7 === 3 ? 'ROLLED_BACK' : 'SETTLED'
      ]
    );
  }
}

async function seedNotifications(pool, users) {
  const targets = users.slice(0, 5);
  for (let i = 0; i < targets.length; i += 1) {
    const user = targets[i];
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data, read_at, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)`,
      [
        user.id,
        i % 2 === 0 ? 'ACCOUNT_APPROVED' : 'ACCOUNT_REJECTED',
        i % 2 === 0 ? '가상계좌가 승인되었습니다.' : '가상계좌가 반려되었습니다.',
        i % 2 === 0 ? '요청하신 가상계좌가 승인되었습니다.' : '증빙 자료를 확인한 뒤 다시 요청해 주세요.',
        JSON.stringify({ seed: PREFIX, franchiseId: user.franchiseId }),
        i === 4 ? dateTime(15, 18, 30) : null,
        dateTime(1 + i, 15, i * 10)
      ]
    );
  }
}

async function verify(pool) {
  const result = await pool.query(
    `SELECT
      (SELECT count(*)::int FROM users WHERE email LIKE $1) AS users,
      (SELECT count(*)::int FROM cards WHERE id LIKE $2) AS cards,
      (SELECT count(*)::int FROM account_requests WHERE request_id LIKE $3) AS account_requests,
      (SELECT count(*)::int FROM delivery_accounts WHERE account_no LIKE $4) AS delivery_accounts,
      (SELECT count(*)::int FROM transactions WHERE transaction_id LIKE $5) AS transactions,
      (SELECT count(*)::int FROM pg_settlements WHERE pg_tx_id LIKE $6) AS pg_settlements,
      (SELECT count(*)::int FROM notifications WHERE data->>'seed' = $7) AS notifications`,
    [
      `${PREFIX.toLowerCase()}-%@eatspay.local`,
      `${PREFIX}-CARD-%`,
      `${PREFIX}-REQ-%`,
      `${PREFIX}-%`,
      `${PREFIX}-TX-%`,
      `PG-${PREFIX}-%`,
      PREFIX
    ]
  );
  const counts = result.rows[0];
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  console.log('June demo seed verification:', { ...counts, total });
  if (total !== 100) {
    throw new Error(`Expected 100 seeded records, found ${total}.`);
  }
  const range = await pool.query(
    `SELECT min(created_at)::date AS min_date, max(created_at)::date AS max_date
     FROM transactions
     WHERE transaction_id LIKE $1`,
    [`${PREFIX}-TX-%`]
  );
  console.log('June demo transaction date range:', range.rows[0]);
}

function dateTime(day, hour, minute) {
  return `2026-06-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09`;
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
  console.error(err);
  process.exit(1);
});
