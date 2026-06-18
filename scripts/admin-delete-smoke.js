function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

function normalizeBaseUrl(value) {
  return String(value || 'https://www.eatspay.co.kr').replace(/\/$/, '');
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    cache: 'no-store'
  });
  const json = await readJson(response);
  if (!response.ok || !json?.success) {
    const message = json?.error?.message || json?.message || json?.raw || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.json = json;
    throw error;
  }
  return json;
}

async function login(baseUrl, args) {
  const token = args.adminToken || process.env.ADMIN_ACCESS_TOKEN || process.env.PUSH_SMOKE_ADMIN_TOKEN || '';
  if (token) return token;

  const email = args.adminEmail || process.env.ADMIN_EMAIL || 'admin@eatspay.co.kr';
  const password = args.adminPassword || process.env.ADMIN_PASSWORD || '';
  if (!password) {
    throw new Error('ADMIN_PASSWORD 또는 --adminPassword가 필요합니다. 토큰이 있으면 --adminToken을 쓰세요.');
  }

  const json = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  return json.data.accessToken;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function assertDeletedBootstrap(bootstrap, { franchiseId, agencyId, deliveryAgencyId }) {
  const data = bootstrap.data || {};
  if (franchiseId && (data.franchises || []).some(item => String(item.id) === String(franchiseId))) {
    throw new Error(`가맹점 삭제 검증 실패: franchiseId=${franchiseId}가 bootstrap에 남아 있습니다.`);
  }
  if (agencyId && (data.agencies || []).some(item => String(item.id) === String(agencyId))) {
    throw new Error(`대리점 삭제 검증 실패: agencyId=${agencyId}가 bootstrap에 남아 있습니다.`);
  }
  if (deliveryAgencyId && (data.deliveryAgencies || []).some(item => String(item.id) === String(deliveryAgencyId))) {
    throw new Error(`배달대행사 삭제 검증 실패: deliveryAgencyId=${deliveryAgencyId}가 bootstrap에 남아 있습니다.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.baseUrl || process.env.ADMIN_DELETE_SMOKE_BASE_URL);
  const token = await login(baseUrl, args);
  const headers = authHeaders(token);
  const stamp = Date.now();
  const created = {};

  console.log(`[admin-delete-smoke] baseUrl=${baseUrl}`);

  try {
    const agency = await requestJson(`${baseUrl}/api/admin/agencies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `삭제테스트 대리점 ${stamp}`,
        loginId: `delete-smoke-${stamp}`,
        password: `Smoke${stamp}!`,
        level: 2,
        region: '테스트',
        owner: '삭제테스트',
        phone: '010-0000-0000',
        feeRate: 4.4
      })
    });
    created.agencyId = agency.data.id;
    console.log(`[OK] 임시 대리점 생성 id=${created.agencyId}`);

    const franchise = await requestJson(`${baseUrl}/api/admin/franchises`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: `delete-smoke-${stamp}@eatspay.local`,
        password: '1234',
        name: `삭제테스트 가맹점 ${stamp}`,
        owner: '삭제테스트',
        phone: '010-0000-0000',
        bizNo: String(stamp).slice(-10).padStart(10, '1'),
        address: '테스트 주소',
        tel: '02-0000-0000',
        agencyId: created.agencyId,
        deliveryAccounts: [{
          agencyName: '삭제테스트 배달대행',
          bankName: '테스트은행',
          accountHolder: '삭제테스트',
          accountNo: `12345678${String(stamp).slice(-6)}`
        }]
      })
    });
    created.franchiseId = franchise.data.id;
    console.log(`[OK] 임시 가맹점 생성 id=${created.franchiseId}`);

    const deliveryAgency = await requestJson(`${baseUrl}/api/admin/delivery-agencies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `삭제테스트 배달대행 ${stamp}`,
        status: 'active',
        sortOrder: 9999
      })
    });
    created.deliveryAgencyId = deliveryAgency.data.id;
    console.log(`[OK] 임시 배달대행사 생성 id=${created.deliveryAgencyId}`);

    const bootstrapBefore = await requestJson(`${baseUrl}/api/admin/bootstrap?_=${Date.now()}`, { headers });
    const account = (bootstrapBefore.data.franchises || [])
      .find(item => String(item.id) === String(created.franchiseId))
      ?.deliveryAgencies?.[0];
    if (!account?.id && !account?.requestId) {
      throw new Error('임시 출금계좌를 bootstrap에서 찾지 못했습니다.');
    }
    const accountId = account.source === 'delivery_account' ? account.id : account.requestId;
    const accountSource = account.source || 'delivery_account';
    await requestJson(`${baseUrl}/api/admin/accounts/${encodeURIComponent(accountId)}?source=${encodeURIComponent(accountSource)}`, {
      method: 'DELETE',
      headers
    });
    console.log(`[OK] 출금계좌 삭제 source=${accountSource} id=${accountId}`);

    await requestJson(`${baseUrl}/api/admin/franchises/${encodeURIComponent(created.franchiseId)}`, {
      method: 'DELETE',
      headers
    });
    console.log(`[OK] 가맹점 삭제 id=${created.franchiseId}`);
    created.franchiseId = null;

    await requestJson(`${baseUrl}/api/admin/agencies/${encodeURIComponent(created.agencyId)}`, {
      method: 'DELETE',
      headers
    });
    console.log(`[OK] 대리점 삭제 id=${created.agencyId}`);
    created.agencyId = null;

    await requestJson(`${baseUrl}/api/admin/delivery-agencies/${encodeURIComponent(created.deliveryAgencyId)}`, {
      method: 'DELETE',
      headers
    });
    console.log(`[OK] 배달대행사 삭제 id=${created.deliveryAgencyId}`);

    const bootstrapAfter = await requestJson(`${baseUrl}/api/admin/bootstrap?_=${Date.now()}`, { headers });
    assertDeletedBootstrap(bootstrapAfter, { deliveryAgencyId: created.deliveryAgencyId });
    created.deliveryAgencyId = null;

    console.log('[OK] 관리자 삭제 스모크 테스트 통과');
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    if (err.json) console.error(JSON.stringify(err.json, null, 2));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(`[FAIL] ${err.message}`);
  process.exit(1);
});
