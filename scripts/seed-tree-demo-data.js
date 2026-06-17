const crypto = require('crypto');

const { createPool } = require('../db/pool');

const PREFIX = 'TREEDEMO';
const PASSWORD = 'tree1234!';
const AGENCY_COUNT = 120;
const USER_COUNT = 600;
const TRANSACTION_COUNT = 1280;
const TOTAL_EXPECTED = AGENCY_COUNT + USER_COUNT + TRANSACTION_COUNT;

const AREAS = [
  '서울 강남', '서울 마포', '서울 성동', '경기 수원', '경기 판교',
  '인천 송도', '부산 해운대', '대구 달서', '광주 상무', '대전 둔산',
  '울산 삼산', '제주 노형', '충북 청주', '충남 천안', '전북 전주'
];
const FOODS = ['도시락', '치킨', '피자', '분식', '국수', '족발', '카페', '샐러드', '초밥', '김밥'];
const OWNERS = ['김민준', '이서연', '박도윤', '최하준', '정지우', '강서준', '조하린', '윤지호', '장수아', '임도현'];
const METHODS = ['CARD', 'EATSPAY', 'GH Payments'];

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
    await seedTransactions(pool, users);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function cleanup(pool) {
  await pool.query("DELETE FROM pg_settlements WHERE pg_tx_id LIKE $1", [`PG-${PREFIX}-%`]);
  await pool.query("DELETE FROM transactions WHERE transaction_id LIKE $1", [`${PREFIX}-TX-%`]);
  await pool.query("DELETE FROM delivery_accounts WHERE account_no LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM cards WHERE id LIKE $1", [`${PREFIX}-CARD-%`]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`${PREFIX.toLowerCase()}-%@eatspay.local`]);
  await pool.query("DELETE FROM agencies WHERE join_code LIKE $1", [`${PREFIX}-%`]);
}

async function seedAgencies(pool, passwordHash) {
  const agencies = [];
  for (let i = 0; i < AGENCY_COUNT; i += 1) {
    const level = i === 0 ? 1 : i <= 5 ? 2 : i <= 35 ? 3 : 4;
    let parentId = null;
    if (level === 2) parentId = agencies[0].id;
    if (level === 3) parentId = agencies[1 + ((i - 6) % 5)].id;
    if (level === 4) parentId = agencies[6 + ((i - 36) % 30)].id;
    const area = AREAS[i % AREAS.length];
    const name = i === 0 ? '트리데모 본사' : `${area} ${level}단계 대리점 ${String(i).padStart(3, '0')}`;
    const loginId = `${PREFIX.toLowerCase()}-agency-${String(i + 1).padStart(3, '0')}`;
    const result = await pool.query(
      `INSERT INTO agencies (
        type, parent_id, name, address, login_id, password_hash, owner, phone, fee_rate, join_code, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $11::timestamptz)
      RETURNING id, name, login_id, parent_id`,
      [
        level <= 2 ? 'HQ' : 'AGENCY',
        parentId,
        name,
        area,
        loginId,
        passwordHash,
        `${OWNERS[i % OWNERS.length]} 대리`,
        `010-${String(7200 + i).padStart(4, '0')}-${String(1000 + i).padStart(4, '0')}`,
        Number((0.25 + (i % 8) * 0.05).toFixed(2)),
        `${PREFIX}-AG-${String(i + 1).padStart(4, '0')}`,
        dateTime(1 + (i % 15), 8 + (i % 9), (i * 3) % 60)
      ]
    );
    agencies.push({ id: result.rows[0].id, name, loginId, parentId, level });
  }
  return agencies;
}

async function seedUsers(pool, passwordHash, agencies) {
  const leafAgencies = agencies.filter(agency => agency.level === 4);
  const users = [];
  for (let i = 0; i < USER_COUNT; i += 1) {
    const agency = leafAgencies[i % leafAgencies.length];
    const franchiseId = 950000 + i;
    const area = AREAS[i % AREAS.length];
    const food = FOODS[i % FOODS.length];
    const role = i % 40 === 7 ? 'OWNER_REJECTED' : i % 25 === 3 ? 'OWNER_PENDING' : 'OWNER';
    const result = await pool.query(
      `INSERT INTO users (
        email, password_hash, name, franchise_name, franchise_id, role, balance, phone, address, tel,
        business_number, customer_id, agency_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $14::timestamptz)
      RETURNING id`,
      [
        `${PREFIX.toLowerCase()}-${String(i + 1).padStart(4, '0')}@eatspay.local`,
        passwordHash,
        OWNERS[i % OWNERS.length],
        `${area} ${food} 가맹점 ${String(i + 1).padStart(4, '0')}`,
        franchiseId,
        role,
        role === 'OWNER' ? 50000 + (i % 20) * 10000 : 0,
        `010-${String(6400 + (i % 500)).padStart(4, '0')}-${String(1000 + i).padStart(4, '0')}`,
        `${area} 트리로 ${i + 1}`,
        `02-${String(3000 + (i % 700)).padStart(4, '0')}-${String(1000 + i).padStart(4, '0')}`,
        `730-${String(10 + (i % 90)).padStart(2, '0')}-${String(10000 + i).padStart(5, '0')}`,
        `${PREFIX}-CUST-${String(i + 1).padStart(5, '0')}`,
        agency.id,
        dateTime(1 + (i % 15), 9 + (i % 8), (i * 5) % 60)
      ]
    );
    users.push({ id: result.rows[0].id, franchiseId, agencyId: agency.id, franchiseName: `${area} ${food} 가맹점 ${String(i + 1).padStart(4, '0')}` });
  }
  return users;
}

async function seedTransactions(pool, users) {
  const approvedUsers = users.filter((_, index) => index % 25 !== 3 && index % 40 !== 7);
  for (let i = 0; i < TRANSACTION_COUNT; i += 1) {
    const user = approvedUsers[i % approvedUsers.length];
    const day = 1 + (i % 15);
    const depositAmount = 30000 + (i % 25) * 7000;
    const fee = Math.floor(depositAmount * 0.04602);
    const totalAmount = depositAmount + fee;
    await pool.query(
      `INSERT INTO transactions (
        transaction_id, franchise_id, type, amount, fee, total_amount, method, card_details, status, created_at, updated_at
      ) VALUES ($1, $2, 'CHARGE', $3, $4, $5, $6, $7, $8, $9::timestamptz, $9::timestamptz)`,
      [
        `${PREFIX}-TX-${String(i + 1).padStart(6, '0')}`,
        user.franchiseId,
        depositAmount,
        fee,
        totalAmount,
        METHODS[i % METHODS.length],
        `테스트카드 ****-${String(2000 + (i % 8000)).padStart(4, '0')}`,
        i % 37 === 11 ? 'ROLLED_BACK' : 'SUCCESS',
        dateTime(day, 10 + (i % 12), (i * 7) % 60)
      ]
    );
  }
}

async function verify(pool) {
  const result = await pool.query(
    `SELECT
      (SELECT count(*)::int FROM agencies WHERE join_code LIKE $1) AS agencies,
      (SELECT count(*)::int FROM users WHERE email LIKE $2) AS users,
      (SELECT count(*)::int FROM transactions WHERE transaction_id LIKE $3) AS transactions`,
    [`${PREFIX}-%`, `${PREFIX.toLowerCase()}-%@eatspay.local`, `${PREFIX}-TX-%`]
  );
  const counts = result.rows[0];
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  console.log('Tree demo seed verification:', { ...counts, total });
  if (total !== TOTAL_EXPECTED) {
    throw new Error(`Expected ${TOTAL_EXPECTED} TREEDEMO records, found ${total}.`);
  }
  const tree = await pool.query(
    `SELECT
      count(*) FILTER (WHERE parent_id IS NULL)::int AS roots,
      count(*) FILTER (WHERE parent_id IS NOT NULL)::int AS children
     FROM agencies
     WHERE join_code LIKE $1`,
    [`${PREFIX}-%`]
  );
  console.log('Tree demo agency tree:', tree.rows[0]);
  console.log('Tree demo agency login sample:', { id: `${PREFIX.toLowerCase()}-agency-001`, password: PASSWORD });
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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
