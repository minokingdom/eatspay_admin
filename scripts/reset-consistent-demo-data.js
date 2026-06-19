const crypto = require('crypto');

const { createPool } = require('../db/pool');

const PREFIX = 'CONSISTDEMO';
const PASSWORD = 'demo1234!';
const BASE_DATE = '2026-06';
const AGENCY_COUNT = 80;
const USER_COUNT = 420;
const TRANSACTION_COUNT = 900;

const CLEANUP = {
  prefixes: ['CONSISTDEMO', 'JUNEDEMO', 'TREEDEMO'],
  demoEmailPatterns: [
    'consistdemo-%@eatspay.local',
    'junedemo-%@eatspay.local',
    'treedemo-%@eatspay.local',
    'demo-owner-%@eatspay.local'
  ],
  transactionPatterns: ['CONSISTDEMO-TX-%', 'JUNEDEMO-TX-%', 'TREEDEMO-TX-%', 'DEMO-TX-%'],
  requestPatterns: ['CONSISTDEMO-REQ-%', 'JUNEDEMO-REQ-%', 'DEMO-REQ-%'],
  cardPatterns: ['CONSISTDEMO-CARD-%', 'JUNEDEMO-CARD-%', 'TREEDEMO-CARD-%'],
  settlementPatterns: ['PG-CONSISTDEMO-%', 'PG-JUNEDEMO-%', 'PG-TREEDEMO-%', 'PG-DEMO-%'],
  agencyJoinCodePatterns: ['CONSISTDEMO-%', 'JUNEDEMO-%', 'TREEDEMO-%', 'JOIN-%']
};

const AREAS = [
  '서울 강남', '서울 마포', '서울 성동', '경기 수원', '경기 판교',
  '인천 송도', '부산 해운대', '대구 달서', '광주 상무', '대전 둔산',
  '울산 삼산', '제주 노형', '전북 전주', '충남 천안', '강원 춘천'
];
const FOODS = ['도시락', '김밥', '분식', '족발', '냉면', '돈카츠', '초밥', '샐러드', '카페', '치킨'];
const OWNERS = ['김민호', '이소정', '박준영', '최지훈', '정수빈', '강하늘', '오지안', '권지우', '임도현', '서윤아'];
const DELIVERY_AGENCIES = ['생각대로', '바로고', '부릉', '만나플러스', '딜버', '모아라인', '슈퍼히어로', '제트콜', '쿠팡이츠', '런(RUN)'];
const BANKS = [
  { code: '088', name: '신한은행' },
  { code: '004', name: '국민은행' },
  { code: '081', name: '하나은행' },
  { code: '020', name: '우리은행' },
  { code: '011', name: '농협은행' },
  { code: '003', name: '기업은행' }
];
const CARD_COMPANIES = ['현대카드', '신한카드', '삼성카드', '롯데카드', 'KB국민카드', '우리카드', 'NH농협카드', 'BC카드'];

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
    const agencies = await seedAgencies(pool, passwordHash);
    const users = await seedUsers(pool, passwordHash, agencies);
    const approvedUsers = users.filter(user => user.role === 'OWNER');
    await seedCards(pool, approvedUsers);
    await seedAccounts(pool, users, agencies);
    const transactions = await seedTransactions(pool, approvedUsers);
    await seedSettlements(pool, transactions, users);
    await seedNotifications(pool, users);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function cleanup(pool) {
  await pool.query("DELETE FROM notifications WHERE data->>'seed' = ANY($1::text[])", [[...CLEANUP.prefixes, PREFIX]]);
  await pool.query("DELETE FROM pg_settlements WHERE pg_tx_id LIKE ANY($1::text[])", [CLEANUP.settlementPatterns]);
  await pool.query("DELETE FROM transactions WHERE transaction_id LIKE ANY($1::text[])", [CLEANUP.transactionPatterns]);
  await pool.query("DELETE FROM account_requests WHERE request_id LIKE ANY($1::text[])", [CLEANUP.requestPatterns]);
  await pool.query("DELETE FROM delivery_accounts WHERE account_no LIKE ANY($1::text[])", [[`${PREFIX}-%`, 'JUNEDEMO-%', 'TREEDEMO-%']]);
  await pool.query("DELETE FROM cards WHERE id LIKE ANY($1::text[])", [CLEANUP.cardPatterns]);
  await pool.query("DELETE FROM users WHERE email LIKE ANY($1::text[])", [CLEANUP.demoEmailPatterns]);
  await pool.query("DELETE FROM agencies WHERE join_code LIKE ANY($1::text[])", [CLEANUP.agencyJoinCodePatterns]);
}

async function seedAgencies(pool, passwordHash) {
  const agencies = [];
  for (let i = 0; i < AGENCY_COUNT; i += 1) {
    const level = i === 0 ? 1 : i <= 4 ? 2 : i <= 20 ? 3 : 4;
    let parentId = null;
    if (level === 2) parentId = agencies[0].id;
    if (level === 3) parentId = agencies[1 + ((i - 5) % 4)].id;
    if (level === 4) parentId = agencies[5 + ((i - 21) % 16)].id;
    const area = AREAS[i % AREAS.length];
    const type = level === 1 ? 'HQ' : level === 2 ? 'BRANCH' : 'AGENCY';
    const name = level === 1 ? '이츠페이 본사' : `${area} ${level}단계 대리점 ${String(i).padStart(3, '0')}`;
    const loginId = `${PREFIX.toLowerCase()}-agency-${String(i + 1).padStart(3, '0')}`;
    const result = await pool.query(
      `INSERT INTO agencies (
        type, parent_id, name, address, login_id, password_hash, owner, phone, fee_rate, join_code,
        settle_bank_name, settle_account_no, settle_account_holder, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $14::timestamptz)
      RETURNING id`,
      [
        type,
        parentId,
        name,
        `${area} 운영센터 ${i + 1}`,
        loginId,
        passwordHash,
        OWNERS[i % OWNERS.length],
        phone(i),
        Number((0.25 + (i % 8) * 0.05).toFixed(2)),
        `${PREFIX}-AG-${String(i + 1).padStart(4, '0')}`,
        BANKS[i % BANKS.length].name,
        `${PREFIX}-AG-SETTLE-${String(700000 + i)}`,
        OWNERS[i % OWNERS.length],
        dateTime(1 + (i % 15), 8 + (i % 9), (i * 3) % 60)
      ]
    );
    agencies.push({ id: result.rows[0].id, name, type, level, feeRate: Number((0.25 + (i % 8) * 0.05).toFixed(2)) });
  }
  return agencies;
}

async function seedUsers(pool, passwordHash, agencies) {
  const leafAgencies = agencies.filter(agency => agency.level === 4);
  const users = [];
  for (let i = 0; i < USER_COUNT; i += 1) {
    const agency = leafAgencies[i % leafAgencies.length];
    const area = AREAS[i % AREAS.length];
    const food = FOODS[i % FOODS.length];
    const role = statusRole(i);
    const createdDay = 1 + (i % 15);
    const franchiseId = 970000 + i;
    const franchiseName = `${area} ${food} 가맹점 ${String(i + 1).padStart(4, '0')}`;
    const result = await pool.query(
      `INSERT INTO users (
        email, login_id, password_hash, name, franchise_name, franchise_id, role, balance, phone, address, tel,
        business_number, customer_id, agency_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz, $15::timestamptz)
      RETURNING id`,
      [
        `${PREFIX.toLowerCase()}-${String(i + 1).padStart(4, '0')}@eatspay.local`,
        `${PREFIX.toLowerCase()}-${String(i + 1).padStart(4, '0')}`,
        passwordHash,
        OWNERS[i % OWNERS.length],
        franchiseName,
        franchiseId,
        role,
        role === 'OWNER' ? 50000 + (i % 20) * 10000 : 0,
        phone(1000 + i),
        `${area} 이츠로 ${i + 1}`,
        `02-${String(3000 + (i % 700)).padStart(4, '0')}-${String(1000 + i).padStart(4, '0')}`,
        `730${String(10 + (i % 90)).padStart(2, '0')}${String(10000 + i).padStart(5, '0')}`,
        `${PREFIX}-CUST-${String(i + 1).padStart(5, '0')}`,
        agency.id,
        dateTime(createdDay, 9 + (i % 8), (i * 5) % 60)
      ]
    );
    users.push({
      id: result.rows[0].id,
      franchiseId,
      agencyId: agency.id,
      agencyName: agency.name,
      role,
      franchiseName,
      ownerName: OWNERS[i % OWNERS.length],
      businessNumber: `730${String(10 + (i % 90)).padStart(2, '0')}${String(10000 + i).padStart(5, '0')}`,
      createdDay
    });
  }
  return users;
}

async function seedCards(pool, approvedUsers) {
  for (let i = 0; i < approvedUsers.length; i += 1) {
    const user = approvedUsers[i];
    const company = CARD_COMPANIES[i % CARD_COMPANIES.length];
    const last4 = String(2000 + (i % 8000)).padStart(4, '0');
    await pool.query(
      `INSERT INTO cards (id, user_id, masked_number, card_name, card_company, alias, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
      [
        `${PREFIX}-CARD-${String(i + 1).padStart(5, '0')}`,
        user.id,
        `****-****-****-${last4}`,
        company,
        company,
        `${company} 기본카드`,
        dateTime(user.createdDay, 10, i % 60)
      ]
    );
  }
}

async function seedAccounts(pool, users, agencies) {
  const activeDeliveryAgencies = DELIVERY_AGENCIES;
  for (let i = 0; i < users.length; i += 1) {
    const user = users[i];
    const bank = BANKS[i % BANKS.length];
    const deliveryAgency = activeDeliveryAgencies[i % activeDeliveryAgencies.length];
    const status = accountStatusForUser(user, i);
    await pool.query(
      `INSERT INTO account_requests (
        request_id, franchise_id, franchise_name, business_number, bank_code, bank_name, delivery_agency_name,
        account_no, representative_name, status, document_url, assigned_virtual_account, rejection_reason,
        submitted_at, processed_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::timestamptz, $15::timestamptz, COALESCE($15::timestamptz, $14::timestamptz))`,
      [
        `${PREFIX}-REQ-${String(i + 1).padStart(5, '0')}`,
        user.franchiseId,
        user.franchiseName,
        user.businessNumber,
        bank.code,
        bank.name,
        deliveryAgency,
        `${PREFIX}-REQ-${String(800000 + i)}`,
        user.ownerName,
        status,
        `/files/${PREFIX.toLowerCase()}-account-${String(i + 1).padStart(5, '0')}.jpg`,
        status === 'APPROVED' ? JSON.stringify({ bankCode: bank.code, bankName: bank.name, accountNumber: `${PREFIX}-VA-${String(900000 + i)}`, accountHolder: user.franchiseName }) : null,
        status === 'REJECTED' ? '증빙 이미지와 계좌 정보가 일치하지 않습니다.' : null,
        dateTime(user.createdDay, 11, (i * 7) % 60),
        status === 'PENDING' ? null : dateTime(Math.min(15, user.createdDay + 1), 13, (i * 11) % 60)
      ]
    );
    if (status === 'APPROVED') {
      const accountCount = i % 9 === 0 ? 2 : 1;
      for (let j = 0; j < accountCount; j += 1) {
        const accountBank = BANKS[(i + j) % BANKS.length];
        await pool.query(
          `INSERT INTO delivery_accounts (
            franchise_id, agency_id, agency_name, bank_name, account_holder, account_no, account_status,
            rejection_reason, req_date, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', NULL, $7::timestamptz, $7::timestamptz)`,
          [
            user.franchiseId,
            agencies[(i + j) % agencies.length].id,
            activeDeliveryAgencies[(i + j) % activeDeliveryAgencies.length],
            accountBank.name,
            user.franchiseName,
            `${PREFIX}-DA-${String(900000 + i)}-${j + 1}`,
            dateTime(Math.min(15, user.createdDay + 1), 14 + j, (i * 13) % 60)
          ]
        );
      }
    }
  }
}

async function seedTransactions(pool, approvedUsers) {
  const paymentUsers = approvedUsers.filter((_, index) => index % 5 !== 4);
  const transactions = [];
  for (let i = 0; i < TRANSACTION_COUNT; i += 1) {
    const user = paymentUsers[i % paymentUsers.length];
    const day = Math.max(user.createdDay, 1 + (i % 15));
    const amount = 30000 + (i % 35) * 7000;
    const fee = Math.floor(amount * 0.04602);
    const totalAmount = amount + fee;
    const status = i % 53 === 17 ? 'ROLLED_BACK' : 'SUCCESS';
    const tx = {
      transactionId: `${PREFIX}-TX-${String(i + 1).padStart(6, '0')}`,
      franchiseId: user.franchiseId,
      amount,
      fee,
      totalAmount,
      status,
      createdAt: dateTime(day, 10 + (i % 12), (i * 7) % 60),
      cardDetails: `${CARD_COMPANIES[i % CARD_COMPANIES.length]} ****-${String(2000 + (i % 8000)).padStart(4, '0')}`
    };
    await pool.query(
      `INSERT INTO transactions (
        transaction_id, franchise_id, type, amount, fee, total_amount, method, card_details, status, created_at, updated_at
      ) VALUES ($1, $2, 'CHARGE', $3, $4, $5, 'CARD', $6, $7, $8::timestamptz, $8::timestamptz)`,
      [tx.transactionId, tx.franchiseId, tx.amount, tx.fee, tx.totalAmount, tx.cardDetails, tx.status, tx.createdAt]
    );
    transactions.push(tx);
  }
  return transactions;
}

async function seedSettlements(pool, transactions, users) {
  const successTransactions = transactions.filter(tx => tx.status === 'SUCCESS').slice(0, 320);
  for (let i = 0; i < successTransactions.length; i += 1) {
    const tx = successTransactions[i];
    const user = users.find(item => item.franchiseId === tx.franchiseId);
    const bank = BANKS[i % BANKS.length];
    await pool.query(
      `INSERT INTO pg_settlements (
        settled_at, approval_no, pg, pg_tx_id, franchise_id, franchise_name, payment_amt, svc_fee, net_amt,
        agency_id, agency_name, customer_id, bank_code, account_no, delivery_agency, status, created_at, updated_at
      ) VALUES ($1::timestamptz, $2, 'GH Payments', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'SETTLED', $1::timestamptz, $1::timestamptz)`,
      [
        tx.createdAt,
        tx.transactionId,
        `PG-${PREFIX}-${String(i + 1).padStart(6, '0')}`,
        tx.franchiseId,
        user.franchiseName,
        tx.totalAmount,
        tx.fee,
        tx.amount,
        user.agencyId,
        user.agencyName,
        `${PREFIX}-CUST-${String((user.franchiseId - 970000) + 1).padStart(5, '0')}`,
        bank.code,
        `${PREFIX}-SETTLE-${String(700000 + i)}`,
        DELIVERY_AGENCIES[i % DELIVERY_AGENCIES.length]
      ]
    );
  }
}

async function seedNotifications(pool, users) {
  const targets = users.slice(0, 20);
  for (let i = 0; i < targets.length; i += 1) {
    const user = targets[i];
    const approved = user.role === 'OWNER';
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data, read_at, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)`,
      [
        user.id,
        approved ? 'ACCOUNT_APPROVED' : 'FRANCHISE_STATUS_CHANGED',
        approved ? '가상계좌가 승인되었습니다.' : '가맹점 상태가 변경되었습니다.',
        approved ? '요청하신 출금계좌가 승인되었습니다.' : `현재 상태: ${user.role}`,
        JSON.stringify({ seed: PREFIX, franchiseId: user.franchiseId }),
        i % 3 === 0 ? dateTime(15, 18, i) : null,
        dateTime(Math.min(15, user.createdDay + 1), 15, i)
      ]
    );
  }
}

async function verify(pool) {
  const counts = await pool.query(
    `SELECT
      (SELECT count(*)::int FROM agencies WHERE join_code LIKE $1) AS agencies,
      (SELECT count(*)::int FROM users WHERE email LIKE $2) AS users,
      (SELECT count(*)::int FROM cards WHERE id LIKE $3) AS cards,
      (SELECT count(*)::int FROM account_requests WHERE request_id LIKE $4) AS account_requests,
      (SELECT count(*)::int FROM delivery_accounts WHERE account_no LIKE $5) AS delivery_accounts,
      (SELECT count(*)::int FROM transactions WHERE transaction_id LIKE $6) AS transactions,
      (SELECT count(*)::int FROM pg_settlements WHERE pg_tx_id LIKE $7) AS pg_settlements,
      (SELECT count(*)::int FROM notifications WHERE data->>'seed' = $8) AS notifications`,
    [`${PREFIX}-%`, `${PREFIX.toLowerCase()}-%@eatspay.local`, `${PREFIX}-CARD-%`, `${PREFIX}-REQ-%`, `${PREFIX}-DA-%`, `${PREFIX}-TX-%`, `PG-${PREFIX}-%`, PREFIX]
  );
  const integrity = await pool.query(
    `SELECT
      (SELECT count(*)::int
       FROM transactions tx
       JOIN users u ON u.franchise_id = tx.franchise_id
       WHERE tx.transaction_id LIKE $1
         AND (u.role <> 'OWNER' OR u.agency_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM delivery_accounts da
           WHERE da.franchise_id = tx.franchise_id AND da.account_status = 'APPROVED'
         ) OR NOT EXISTS (
           SELECT 1 FROM cards c
           WHERE c.user_id = u.id
         ))) AS invalid_transactions,
      (SELECT count(*)::int
       FROM users u
       JOIN transactions tx ON tx.franchise_id = u.franchise_id
       WHERE tx.transaction_id LIKE $1 AND tx.created_at::date < u.created_at::date) AS pre_join_transactions,
      (SELECT COALESCE(max(account_count), 0)::int
       FROM (
         SELECT franchise_id, count(*) AS account_count
         FROM delivery_accounts
         WHERE account_no LIKE $2
         GROUP BY franchise_id
       ) grouped) AS max_accounts_per_franchise`,
    [`${PREFIX}-TX-%`, `${PREFIX}-DA-%`]
  );
  console.log('Consistent demo seed verification:', counts.rows[0]);
  console.log('Consistent demo integrity:', integrity.rows[0]);
  if (Number(integrity.rows[0].invalid_transactions) !== 0) {
    throw new Error('Invalid demo transaction found: every transaction must have OWNER + agency + approved account + card.');
  }
  if (Number(integrity.rows[0].pre_join_transactions) !== 0) {
    throw new Error('Invalid demo transaction found: transaction date is earlier than join date.');
  }
  if (Number(integrity.rows[0].max_accounts_per_franchise) > 2) {
    throw new Error('Invalid demo account count: franchise has more than 2 accounts.');
  }
}

function statusRole(index) {
  if (index % 47 === 11) return 'OWNER_WITHDRAWN';
  if (index % 31 === 5) return 'OWNER_REJECTED';
  if (index % 19 === 3) return 'OWNER_PENDING';
  return 'OWNER';
}

function accountStatusForUser(user, index) {
  if (user.role === 'OWNER') return 'APPROVED';
  if (user.role === 'OWNER_REJECTED') return 'REJECTED';
  if (user.role === 'OWNER_PENDING') return 'PENDING';
  return 'REJECTED';
}

function phone(index) {
  return `010-${String(6100 + (index % 900)).padStart(4, '0')}-${String(1000 + index).padStart(4, '0')}`;
}

function dateTime(day, hour, minute) {
  return `${BASE_DATE}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09`;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey.toString('hex'));
    });
  });
  return `scrypt$${salt}$${hash}`;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
