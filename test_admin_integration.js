const http = require('http');

const results = [];

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

async function runTests() {
  console.log('=== ADMIN DASHBOARD INTEGRATION TESTS ===\n');

  // ---- TEST 1: GET /api/payment/history - Response structure ----
  try {
    const res1 = await makeRequest({
      hostname: 'localhost', port: 3000,
      path: '/api/payment/history?startDate=2026-05-01&endDate=2026-05-30&type=ALL',
      method: 'GET',
      headers: { 'Authorization': 'Bearer mocked_admin_token', 'Content-Type': 'application/json' }
    });

    const hasSuccess = res1.body && res1.body.success === true;
    const hasData = res1.body && res1.body.data && typeof res1.body.data === 'object';
    const hasItems = hasData && Array.isArray(res1.body.data.items);
    const structOk = hasSuccess && hasData && hasItems;

    console.log('TEST 1: Response Structure { success: true, data: { items: [...] } }');
    console.log('  HTTP Status:', res1.status);
    console.log('  success === true:', hasSuccess);
    console.log('  data exists:', hasData);
    console.log('  data.items is array:', hasItems);
    console.log('  Items count:', hasItems ? res1.body.data.items.length : 'N/A');
    console.log('  RESULT:', structOk ? 'PASS' : 'FAIL');
    console.log('');

    // ---- TEST 2: Required fields on each transaction item ----
    const requiredFields = ['transactionId', 'franchiseId', 'amount', 'fee', 'totalAmount', 'status', 'createdAt'];
    let allFieldsOk = true;
    let fieldDetails = [];

    if (hasItems && res1.body.data.items.length > 0) {
      for (let i = 0; i < res1.body.data.items.length; i++) {
        const item = res1.body.data.items[i];
        const missing = requiredFields.filter(f => !(f in item));
        if (missing.length > 0) {
          allFieldsOk = false;
          fieldDetails.push(`  Item[${i}] missing: ${missing.join(', ')}`);
        }
      }
    } else {
      allFieldsOk = false;
      fieldDetails.push('  No items to validate');
    }

    console.log('TEST 2: Required Fields on Each Transaction Item');
    console.log('  Required:', requiredFields.join(', '));
    if (hasItems && res1.body.data.items.length > 0) {
      console.log('  Sample item:', JSON.stringify(res1.body.data.items[0], null, 4));
    }
    if (fieldDetails.length > 0) fieldDetails.forEach(d => console.log(d));
    else console.log('  All', res1.body.data.items.length, 'items have all required fields');
    console.log('  RESULT:', allFieldsOk ? 'PASS' : 'FAIL');
    console.log('');

    // ---- TEST 3: Fee calculation verification (Math.floor(amount * 0.04602)) ----
    let feeOk = true;
    let feeDetails = [];

    if (hasItems && res1.body.data.items.length > 0) {
      for (let i = 0; i < res1.body.data.items.length; i++) {
        const item = res1.body.data.items[i];
        const expectedFee = Math.floor(item.amount * 0.04602);
        if (item.fee !== expectedFee) {
          feeOk = false;
          feeDetails.push(`  Item[${i}] (txId=${item.transactionId}): amount=${item.amount}, fee=${item.fee}, expected=${expectedFee} -- MISMATCH`);
        }
      }
    } else {
      feeOk = false;
      feeDetails.push('  No items to validate');
    }

    console.log('TEST 3: Fee Calculation (Math.floor(amount * 0.04602))');
    if (feeDetails.length > 0) feeDetails.forEach(d => console.log(d));
    else console.log('  All', res1.body.data.items.length, 'items have correct fee calculations');
    console.log('  RESULT:', feeOk ? 'PASS' : 'FAIL');
    console.log('');

  } catch(e) {
    console.log('TEST 1: FAIL - Connection error:', e.message);
    console.log('TEST 2: FAIL - Skipped (no data)');
    console.log('TEST 3: FAIL - Skipped (no data)');
    console.log('');
  }

  // ---- TEST 4: POST /api/admin/accounts/approve ----
  try {
    const approveBody = JSON.stringify({
      requestId: 'REQ-20260528-0912',
      action: 'APPROVED',
      assignedVirtualAccount: {
        bankCode: '088',
        bankName: '신한은행',
        accountNumber: '562-901-209384',
        accountHolder: '(주)이츠페이_강남점'
      }
    });

    const res4 = await makeRequest({
      hostname: 'localhost', port: 3000,
      path: '/api/admin/accounts/approve',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mocked_admin_token',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(approveBody)
      }
    }, approveBody);

    const is200 = res4.status === 200;
    const isSuccess = res4.body && res4.body.success === true;
    const test4Pass = is200 && isSuccess;

    console.log('TEST 4: POST /api/admin/accounts/approve');
    console.log('  HTTP Status:', res4.status, is200 ? '(OK)' : '(UNEXPECTED)');
    console.log('  Response:', JSON.stringify(res4.body, null, 4));
    console.log('  success === true:', isSuccess);
    console.log('  RESULT:', test4Pass ? 'PASS' : 'FAIL');
    console.log('');

  } catch(e) {
    console.log('TEST 4: FAIL - Connection error:', e.message);
    console.log('');
  }

  console.log('=== TESTS COMPLETE ===');
}

runTests();
