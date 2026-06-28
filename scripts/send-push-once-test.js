const { createPool } = require('../db/pool');

const BASE_URL = process.env.EATSPAY_BASE_URL || 'https://eatspay.kr';
const ADMIN_ID = process.env.EATSPAY_ADMIN_ID || 'admin@eatspay.kr';
const ADMIN_PASSWORD = process.env.EATSPAY_ADMIN_PASSWORD || '12345678';

async function getLatestPushUserLoginId() {
  const pool = createPool();
  try {
    const result = await pool.query(
      `SELECT u.login_id, u.email, pt.updated_at
       FROM push_tokens pt
       JOIN users u ON u.id = pt.user_id
       WHERE pt.enabled = true
         AND COALESCE(pt.platform, '') <> 'web'
       ORDER BY pt.updated_at DESC
       LIMIT 1`
    );
    const row = result.rows[0];
    if (!row) throw new Error('No enabled native push token found.');
    return row.login_id || row.email;
  } finally {
    await pool.end();
  }
}

async function loginAdmin() {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: ADMIN_ID,
      loginId: ADMIN_ID,
      password: ADMIN_PASSWORD
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Admin login failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  const token = payload.token || payload.data?.token || payload.accessToken || payload.data?.accessToken;
  if (!token) throw new Error('Admin token not found in login response.');
  return token;
}

async function main() {
  const targetLoginId = process.env.EATSPAY_PUSH_TARGET || await getLatestPushUserLoginId();
  const token = await loginAdmin();
  const response = await fetch(`${BASE_URL}/api/admin/push/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      email: targetLoginId,
      title: process.env.EATSPAY_PUSH_TITLE || '이츠톡 알림음 테스트',
      body: process.env.EATSPAY_PUSH_BODY || '이 알림은 새 이츠톡 알림음 채널 테스트입니다.',
      targetScreen: process.env.EATSPAY_PUSH_SCREEN || 'talk-chats'
    })
  });
  const text = await response.text();
  console.log('targetLoginId=', targetLoginId);
  console.log(response.status, text.slice(0, 500));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
