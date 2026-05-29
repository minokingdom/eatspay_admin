const http = require('http');

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', (e) => reject(e));
    if (body) req.write(body);
    req.end();
  });
}

async function runE2ETests() {
  console.log('=== E2E REGISTER, CARD & VACCOUNT TESTS ===\n');

  let testUserEmail = `owner_test_${Math.floor(1000 + Math.random() * 9000)}@eatspay.com`;

  // 1. 회원가입 테스트
  try {
    const regData = JSON.stringify({
      email: testUserEmail,
      password: 'Password123!',
      phone: '010-9999-8888',
      storeName: '착한치킨 구로점',
      ceoName: '이갑남',
      address: '서울시 구로구 구로동 11',
      tel: '02-999-8888',
      businessNumber: '120-00-99999'
    });

    const res = await makeRequest({
      hostname: 'localhost', port: 3000,
      path: '/api/auth/register',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(regData)
      }
    }, regData);

    console.log('TEST 1: 가맹점 회원가입 (POST /api/auth/register)');
    console.log('  HTTP Status:', res.status, res.status === 201 ? '(PASS)' : '(FAIL)');
    console.log('  Response:', JSON.stringify(res.body));
    console.log('');
  } catch (e) {
    console.log('TEST 1 FAIL:', e.message);
  }

  // 2. 가맹점 목록 전체 조회 및 대기 중인 회원 확인
  try {
    const res = await makeRequest({
      hostname: 'localhost', port: 3000,
      path: '/api/admin/franchises',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer mocked_admin_token'
      }
    });

    const pendingFr = res.body.data.find(f => f.email === testUserEmail);
    const pass = pendingFr && pendingFr.status === '승인 대기';

    console.log('TEST 2: 관리자 가맹점 목록 조회 및 대기 상태 확인');
    console.log('  Pending Franchise Found:', !!pendingFr);
    console.log('  Status is "승인 대기":', pendingFr ? pendingFr.status : 'N/A');
    console.log('  RESULT:', pass ? 'PASS' : 'FAIL');
    console.log('');
  } catch (e) {
    console.log('TEST 2 FAIL:', e.message);
  }

  // 3. 가맹점 승인 완료
  try {
    const approveData = JSON.stringify({
      email: testUserEmail,
      action: 'APPROVED'
    });

    const res = await makeRequest({
      hostname: 'localhost', port: 3000,
      path: '/api/admin/franchise/approve',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mocked_admin_token',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(approveData)
      }
    }, approveData);

    console.log('TEST 3: 가맹점 가입 승인 (POST /api/admin/franchise/approve)');
    console.log('  HTTP Status:', res.status, res.status === 200 ? '(PASS)' : '(FAIL)');
    console.log('  Response Role is OWNER:', res.body.data?.role === 'OWNER' ? 'PASS' : 'FAIL');
    console.log('');
  } catch (e) {
    console.log('TEST 3 FAIL:', e.message);
  }

  // 4. 승인된 가맹점으로 로그인 및 토큰 발급
  let token = '';
  try {
    const loginData = JSON.stringify({
      email: testUserEmail,
      password: 'Password123!'
    });

    const res = await makeRequest({
      hostname: 'localhost', port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginData)
      }
    }, loginData);

    token = res.body.data?.accessToken;
    console.log('TEST 4: 가입 승인된 회원 로그인 (POST /api/auth/login)');
    console.log('  HTTP Status:', res.status, res.status === 200 ? '(PASS)' : '(FAIL)');
    console.log('  Access Token Issued:', !!token);
    console.log('');
  } catch (e) {
    console.log('TEST 4 FAIL:', e.message);
  }

  // 5. 카드 등록 테스트
  try {
    const cardData = JSON.stringify({
      cardNumber: '8888-7777-6666-5555',
      cardPw: '99',
      expiryMonth: '11',
      expiryYear: '29',
      identity: '881122',
      alias: '내 테스트 현대카드'
    });

    const res = await makeRequest({
      hostname: 'localhost', port: 3000,
      path: '/api/card/register',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(cardData)
      }
    }, cardData);

    console.log('TEST 5: 결제 카드 등록 (POST /api/card/register)');
    console.log('  HTTP Status:', res.status, res.status === 200 ? '(PASS)' : '(FAIL)');
    console.log('  Masked Number:', res.body.data?.maskedNumber);
    console.log('  RESULT:', res.body.data?.maskedNumber ? 'PASS' : 'FAIL');
    console.log('');
  } catch (e) {
    console.log('TEST 5 FAIL:', e.message);
  }

  console.log('=== E2E TESTS COMPLETE ===');
}

runE2ETests();
