const { createPool } = require('../db/pool');

const BASE_URL = process.env.EATSPAY_BASE_URL || 'https://eatspay.kr';
const ADMIN_ID = process.env.EATSPAY_ADMIN_ID || 'admin@eatspay.kr';
const ADMIN_PASSWORD = process.env.EATSPAY_ADMIN_PASSWORD || '12345678';

const messages = [
  {
    title: '이츠톡 새 문의',
    body: '새 채팅 문의가 도착했습니다. 확인해 주세요.',
    targetScreen: 'talk-chats'
  },
  {
    title: '결제 승인 알림',
    body: '배달대행비 카드결제가 정상 승인되었습니다.',
    targetScreen: 'payment-history'
  },
  {
    title: '정산 상태 안내',
    body: '가상계좌 정산 상태가 업데이트되었습니다.',
    targetScreen: 'agency'
  },
  {
    title: '혜택찾기 업데이트',
    body: '오늘 카드 혜택 정보가 새로 반영되었습니다.',
    targetScreen: 'benefit-cards'
  },
  {
    title: '고객센터 안내',
    body: '공지사항과 이용가이드를 확인해 주세요.',
    targetScreen: 'cs-main'
  }
];

async function getLatestPushUserLoginId() {
  const pool = createPool();
  try {
    const result = await pool.query(
      `SELECT u.login_id, u.email, u.franchise_name, u.name, pt.updated_at
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

async function sendPush(token, targetLoginId, item, index) {
  const response = await fetch(`${BASE_URL}/api/admin/push/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      email: targetLoginId,
      title: `${item.title} (${index}/5)`,
      body: item.body,
      targetScreen: item.targetScreen
    })
  });
  const text = await response.text();
  console.log(new Date().toISOString(), `push ${index}/5`, response.status, text.slice(0, 500));
}

async function main() {
  const targetLoginId = process.env.EATSPAY_PUSH_TARGET || await getLatestPushUserLoginId();
  console.log('targetLoginId=', targetLoginId);
  const token = await loginAdmin();

  for (let i = 0; i < messages.length; i += 1) {
    await sendPush(token, targetLoginId, messages[i], i + 1);
    if (i < messages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
